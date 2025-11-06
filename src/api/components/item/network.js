const express = require('express');
const ctrl = require('./controller');
const response = require('../../../utils/response');
const pool = require('../../../utils/connection');

const router = express.Router();

/* -------------------- Helpers -------------------- */
const q = (sql, p = []) =>
  new Promise((resolve, reject) =>
    pool.query(sql, p, (err, rows) => (err ? reject(err) : resolve(rows)))
  );

async function getCapacity(bodegaId) {
  const r = await q(`SELECT ancho, largo, alto FROM bodegas WHERE id = ?`, [bodegaId]);
  if (!r.length) throw new Error('Bodega destino no existe');
  const { ancho, largo, alto } = r[0];
  return Number(ancho) * Number(largo) * Number(alto);
}

async function getOccupied(bodegaId) {
  const r = await q(
    `SELECT COALESCE(SUM(ancho*largo*alto*cantidad),0) AS ocupado
       FROM items
      WHERE bodega_id = ?
        AND (is_active IS NULL OR is_active = 1)`,
    [bodegaId]
  );
  return Number(r[0].ocupado || 0);
}

/* ------------------------------------------------------------------
   RUTAS ESPECÍFICAS (deben ir ANTES de "/:id" para no colisionar)
-------------------------------------------------------------------*/

/** Listar todos los ítems no asignados */
router.get('/unassigned', async (req, res) => {
  try {
    const rows = await q(`
      SELECT i.*,
             (i.ancho*i.largo*i.alto)            AS volumen_unitario,
             (i.ancho*i.largo*i.alto*i.cantidad) AS volumen_total
        FROM items i
       WHERE i.status = 'unassigned'
         AND (i.is_active IS NULL OR i.is_active = 1)
    `);
    response.success(req, res, 200, rows);
  } catch (e) {
    response.error(req, res, 500, e.message || e);
  }
});

/** Asignar desde “sin asignar” a una bodega (valida capacidad; mueve parcial si hace falta) */
router.post('/assign', async (req, res) => {
  try {
    const { item_id, to_bodega_id, quantity } = req.body;
    if (!item_id || !to_bodega_id || !quantity) {
      throw new Error('Faltan campos: item_id, to_bodega_id, quantity');
    }

    // 1) Item sin asignar
    const itRows = await q(
      `SELECT * FROM items
        WHERE id=? AND status='unassigned' AND (is_active IS NULL OR is_active=1)`,
      [item_id]
    );
    if (!itRows.length) throw new Error('Item no asignado no existe o está inactivo');
    const it = itRows[0];

    // 2) Bodega destino
    const bRows = await q(
      `SELECT * FROM bodegas WHERE id=? AND (is_active IS NULL OR is_active=1)`,
      [to_bodega_id]
    );
    if (!bRows.length) throw new Error('Bodega destino no existe o está inactiva');

    // 3) Capacidad / ocupación / cuánto cabe
    const unitVol = Number(it.ancho) * Number(it.largo) * Number(it.alto);
    if (!(unitVol > 0)) throw new Error('Volumen unitario del item inválido (ancho*largo*alto debe ser > 0)');

    const capacidad = await getCapacity(to_bodega_id);
    const ocupado   = await getOccupied(to_bodega_id);
    const libre     = Math.max(capacidad - ocupado, 0);

    const reqMove   = Math.min(Number(quantity), Number(it.cantidad));
    const cabe      = Math.max(Math.floor(libre / unitVol), 0);
    const willMove  = Math.min(reqMove, cabe);
    const remainder = reqMove - willMove;

    if (willMove <= 0) {
      return response.success(req, res, 200, {
        requested_to_assign: reqMove,
        assigned_to_destination: 0,
        remainder_due_to_capacity: reqMove,
        to_bodega_id: Number(to_bodega_id),
        unit_volume: unitVol,
        capacity: capacidad,
        occupied: ocupado,
        free: libre
      });
    }

    // 4) TRANSACCIÓN: descontar del unassigned + insertar asignado
    await q('START TRANSACTION');

    // descontar del unassigned
    const upd = await q(
      `UPDATE items SET cantidad=cantidad-?
        WHERE id=? AND cantidad>=?`,
      [willMove, item_id, willMove]
    );
    if (upd.affectedRows === 0) {
      await q('ROLLBACK');
      throw new Error('No se pudo descontar cantidad del item sin asignar (¿cantidad insuficiente?)');
    }

    // insertar nuevo registro asignado (incluye 'status' como placeholder)
    const ins = await q(
      `INSERT INTO items
         (nombre, tipo, ancho, largo, alto, peso, cantidad, bodega_id, status, is_active, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,1,NOW(),NOW())`,
      [
        it.nombre,
        it.tipo,
        it.ancho,
        it.largo,
        it.alto,
        it.peso,
        willMove,
        Number(to_bodega_id),
        'assigned'
      ]
    );

    // Si quedó en 0, opcional: inactivarlo
    await q(
      `UPDATE items
          SET is_active = IF(cantidad=0,0,is_active),
              updated_at = NOW()
        WHERE id=?`,
      [item_id]
    );

    await q('COMMIT');

    return response.success(req, res, 200, {
      requested_to_assign: reqMove,
      assigned_to_destination: willMove,
      remainder_due_to_capacity: remainder,
      to_bodega_id: Number(to_bodega_id),
      unit_volume: unitVol,
      capacity: capacidad,
      occupied: ocupado,
      free: libre,
      created_item_id: ins.insertId || null
    });

  } catch (e) {
    try { await q('ROLLBACK'); } catch {}
    return response.error(req, res, 400, e.message || String(e));
  }
});

/** Alta MASIVA de items (ingreso en bloque)
 * Body: { items: [ { nombre, tipo, ancho, largo, alto, peso, cantidad, status?, bodega_id? }, ... ] }
 * Nota: este endpoint NO valida capacidad cuando status='assigned'.
 * Recomendación: ingresar como 'unassigned' y luego reubicar con /items/assign o /items/assign-batch.
 */
router.post('/bulk', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return response.error(req, res, 400, 'Debes enviar items[] con al menos un elemento');
    }

    const must = ['nombre','tipo','ancho','largo','alto','peso','cantidad'];
    const errors = [];
    const clean = [];

    for (let i = 0; i < items.length; i++) {
      const it = items[i] || {};
      const miss = must.filter(k => it[k] === undefined || it[k] === null);
      if (miss.length) {
        errors.push({ index: i, reason: `Faltan campos: ${miss.join(', ')}` });
        continue;
      }
      const w = Number(it.ancho), l = Number(it.largo), h = Number(it.alto), peso = Number(it.peso), cant = Number(it.cantidad);
      if (!(w>0 && l>0 && h>0 && cant>0)) {
        errors.push({ index: i, reason: 'Dimensiones y cantidad deben ser > 0' });
        continue;
      }

      // status por defecto
      let status = (it.status || '').toLowerCase();
      if (status !== 'assigned' && status !== 'unassigned') status = 'unassigned';

      let bodega_id = null;
      if (status === 'assigned') {
        if (!it.bodega_id) {
          errors.push({ index: i, reason: 'Si status="assigned", bodega_id es requerido' });
          continue;
        }
        bodega_id = Number(it.bodega_id);
        if (!(bodega_id > 0)) {
          errors.push({ index: i, reason: 'bodega_id inválido' });
          continue;
        }
      }

      clean.push({
        nombre: String(it.nombre).trim(),
        tipo: String(it.tipo).trim(),
        ancho: w, largo: l, alto: h, peso,
        cantidad: cant, status, bodega_id
      });
    }

    if (clean.length === 0) {
      return response.error(req, res, 400, 'Ningún item válido para insertar', errors);
    }

    await q('START TRANSACTION');
    const created = [];

    for (const it of clean) {
      const r = await q(
        `INSERT INTO items (nombre,tipo,ancho,largo,alto,peso,cantidad,bodega_id,status,is_active,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,1,NOW(),NOW())`,
        [
          it.nombre, it.tipo, it.ancho, it.largo, it.alto, it.peso,
          it.cantidad, it.bodega_id, it.status
        ]
      );
      created.push({ id: r.insertId, ...it });
    }

    await q('COMMIT');

    return response.success(req, res, 200, { created, invalid: errors });
  } catch (e) {
    try { await q('ROLLBACK'); } catch {}
    return response.error(req, res, 400, e.message || String(e));
  }
});

/* -------------------- CRUD base -------------------- */
// Nota: dejamos / y /:id DESPUÉS de las rutas específicas para evitar conflictos.

router.get('/', async (req, res) => {
  try {
    const data = await ctrl.list();
    response.success(req, res, 200, data);
  } catch (err) {
    response.error(req, res, 500, err.message || err);
  }
});

router.get('/:id', async (req, res) => {
  try {
    const data = await ctrl.get(req.params.id);
    response.success(req, res, 200, data);
  } catch (err) {
    response.error(req, res, 500, err.message || err);
  }
});

router.post('/', async (req, res) => {
  try {
    const r = await ctrl.insert(req.body);
    response.success(req, res, 201, r);
  } catch (err) {
    response.error(req, res, 400, err.message || err);
  }
});

router.put('/', async (req, res) => {
  try {
    const r = await ctrl.update(req.body); // { id, ...campos }
    response.success(req, res, 200, r);
  } catch (err) {
    response.error(req, res, 400, err.message || err);
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const r = await ctrl.remove(req.params.id);
    response.success(req, res, 200, r);
  } catch (err) {
    response.error(req, res, 500, err.message || err);
  }
});

module.exports = router;
