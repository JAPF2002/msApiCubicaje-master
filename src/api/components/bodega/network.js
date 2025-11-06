const express = require('express');
const ctrl = require('./controller');
const response = require('../../../utils/response');
const pool = require('../../../utils/connection');

const router = express.Router();

// Helper de consulta con promesa
const q = (sql, p = []) =>
  new Promise((resolve, reject) =>
    pool.query(sql, p, (err, rows) => (err ? reject(err) : resolve(rows)))
  );

/* -------------------- Rutas CRUD básicas -------------------- */
router.get('/', async (req, res) => {
  try {
    const data = await ctrl.list();
    // Si usas soft delete, puedes filtrar aquí
    const onlyActive = Array.isArray(data)
      ? data.filter(b => (b.is_active ?? 1) === 1)
      : data;
    response.success(req, res, 200, onlyActive);
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
    const result = await ctrl.insert(req.body);
    const id = result?.insertId || result?.id;
    const data = id ? await ctrl.get(id) : (result || req.body);
    response.success(req, res, 201, data);
  } catch (err) {
    response.error(req, res, 400, err.message || err);
  }
});

router.put('/', async (req, res) => {
  try {
    const data = await ctrl.update(req.body); // { id, ...campos }
    response.success(req, res, 200, data);
  } catch (err) {
    response.error(req, res, 400, err.message || err);
  }
});

/* -------------------- DELETE con “sin asignar” --------------------
   Flujo:
   - Si la bodega tiene ítems → 409 para que la UI muestre advertencia.
   - Si confirman: DELETE /api/bodegas/:id?mode=unassign
       * Pasa sus ítems a status='unassigned', bodega_id=NULL
       * Soft delete de la bodega
------------------------------------------------------------------- */
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id);
    const mode = String(req.query.mode || '').toLowerCase();

    // 1) ¿Cuántos ítems activos tiene esta bodega?
    const row = await q(
      `SELECT COUNT(*) AS c
         FROM items
        WHERE bodega_id = ?
          AND (is_active IS NULL OR is_active = 1)`,
      [id]
    );
    const count = Number(row[0].c || 0);

    // 2) Si tiene ítems y no confirmaron todavía → 409
    if (count > 0 && mode !== 'unassign') {
      return response.error(req, res, 409, {
        message: `La bodega tiene ${count} ítem(s). Si confirmas, los pondré como "sin asignar".`,
        hasItems: true,
        count,
        canForce: true,
        nextMode: 'unassign',
      });
    }

    // 3) Si confirmaron, pasar ítems a “sin asignar”
    if (count > 0 && mode === 'unassign') {
      await q(
        `UPDATE items
            SET bodega_id = NULL,
                status = 'unassigned'
          WHERE bodega_id = ?
            AND (is_active IS NULL OR is_active = 1)`,
        [id]
      );
    }

    // 4) Soft delete de la bodega (no se borra físicamente)
    await q(
      `UPDATE bodegas
          SET is_active = 0,
              deleted_at = NOW()
        WHERE id = ?`,
      [id]
    );

    return response.success(req, res, 200, {
      ok: true,
      bodegaId: id,
      unassigned: count,
    });
  } catch (err) {
    return response.error(req, res, 500, err.message || err);
  }
});

module.exports = router;
