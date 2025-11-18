// msApiCubicaje-master/src/api/components/bodega/network.js
const express = require('express');
const router = express.Router();
const db = require('../../../store'); // 👈 tu módulo original

// Wrapper a Promesa usando db.query (callback-style adaptado)
function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/* =========================================================================
 *  HELPERS PARA LAYOUT + UBICACIONES
 * ========================================================================= */


/* =========================================================================
 *  HELPERS PARA LAYOUT + UBICACIONES
 * ========================================================================= */

// Guarda / actualiza el layout de una bodega y regenera ubicaciones
async function upsertLayoutForBodega(id_bodega, layout) {
  if (!layout || !layout.mapa_json) {
    console.log('[upsertLayoutForBodega] sin layout, no se guarda nada');
    return;
  }

  const anchoLayout = Number(layout.ancho) || 0;
  const largoLayout = Number(layout.largo) || 0;

  // Nos aseguramos de mandar un JSON válido a MySQL
  const mapaJsonString =
    typeof layout.mapa_json === 'string'
      ? layout.mapa_json
      : JSON.stringify(layout.mapa_json);

  const sql = `
    INSERT INTO bodega_layouts
      (id_bodega, ancho, largo, mapa_json, fecha_creacion, fecha_actualizacion)
    VALUES (?, ?, ?, ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      ancho = VALUES(ancho),
      largo = VALUES(largo),
      mapa_json = VALUES(mapa_json),
      fecha_actualizacion = NOW()
  `;

  try {
    await q(sql, [id_bodega, anchoLayout, largoLayout, mapaJsonString]);
    console.log('[upsertLayoutForBodega] layout guardado OK para bodega', id_bodega);
  } catch (err) {
    console.error('[upsertLayoutForBodega] ERROR SQL:', err);
    throw err; // esto hará que el POST/PUT devuelva 500 si algo falla
  }

  // Después de guardar el layout, regeneramos las ubicaciones disponibles
  try {
    await regenUbicacionesDesdeLayout(id_bodega, {
      ancho: anchoLayout,
      largo: largoLayout,
      mapa_json: layout.mapa_json,
    });
    console.log('[upsertLayoutForBodega] ubicaciones regeneradas para bodega', id_bodega);
  } catch (err) {
    console.error('[upsertLayoutForBodega] ERROR regenerando ubicaciones:', err);
    // si quieres que aunque falle esto igual se considere éxito, no relanzamos el error
  }
}


// Crea bodega_ubicaciones a partir de mapa_json (solo celdas "D")
async function regenUbicacionesDesdeLayout(id_bodega, layout) {
  const ancho = Number(layout.ancho) || 0;
  const largo = Number(layout.largo) || 0;

  if (!ancho || !largo) return;

  let mapa = layout.mapa_json;
  if (typeof mapa === 'string') {
    try {
      mapa = JSON.parse(mapa);
    } catch (e) {
      console.error('[regenUbicacionesDesdeLayout] error parse JSON', e);
      return;
    }
  }

  // 1) Borrar todas las ubicaciones previas de esa bodega
  await q('DELETE FROM bodega_ubicaciones WHERE id_bodega = ?', [id_bodega]);

  const totalCeldas = ancho * largo;

  // 2) Recorrer todas las celdas del grid y crear ubicaciones solo para "D"
  for (let index = 0; index < totalCeldas; index++) {
    const estado = mapa[index] ?? mapa[String(index)] ?? 'D';

    // Solo creamos ubicación si la celda es DISPONIBLE
    if (estado !== 'D') continue;

    const x = index % ancho;
    const y = Math.floor(index / ancho);

    await q(
      `
      INSERT INTO bodega_ubicaciones
        (id_bodega, nombre, descripcion, pos_x, pos_y, pos_z,
         ancho, largo, alto, activo, fecha_creacion, fecha_actualizacion)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())
    `,
      [
        id_bodega,
        `C-${x}-${y}`, // nombre
        `Celda (${x},${y})`,
        x, // pos_x
        y, // pos_y
        0, // pos_z
        1, // ancho celda
        1, // largo celda
        1, // alto celda
      ]
    );
  }
}

/* =========================================================================
 *  HELPER PARA ASIGNAR ITEMS SOLO A UBICACIONES LIBRES
 * ========================================================================= */

async function asignarItemAuto(id_bodega, id_item) {
  // 1) Buscar una ubicación activa SIN items
  const libres = await q(
    `
    SELECT u.id_ubicacion
    FROM bodega_ubicaciones u
    LEFT JOIN bodega_ubicacion_items ui
      ON ui.id_ubicacion = u.id_ubicacion
    WHERE u.id_bodega = ?
      AND u.activo = 1
      AND ui.id_ubicacion IS NULL
    ORDER BY u.id_ubicacion ASC
    LIMIT 1
  `,
    [id_bodega]
  );

  if (!libres.length) {
    const err = new Error('NO_FREE_LOCATION');
    err.code = 'NO_FREE_LOCATION';
    throw err;
  }

  const id_ubicacion = libres[0].id_ubicacion;

  // 2) Registrar el item en esa ubicación (1 unidad por defecto)
  await q(
    `
    INSERT INTO bodega_ubicacion_items
      (id_ubicacion, id_item, qty, movible, fecha_creacion, fecha_actualizacion)
    VALUES (?, ?, 1, 1, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      qty = qty + 1,
      fecha_actualizacion = NOW()
  `,
    [id_ubicacion, id_item]
  );

  // 3) (Opcional) mantener agregado por bodega en bodega_items
  await q(
    `
    INSERT INTO bodega_items
      (id_bodega, id_item, qty, fecha_creacion, fecha_actualizacion)
    VALUES (?, ?, 1, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      qty = qty + 1,
      fecha_actualizacion = NOW()
  `,
    [id_bodega, id_item]
  );

  return { id_ubicacion };
}

/* =========================================================================
 *  ENDPOINTS BÁSICOS DE BODEGAS
 * ========================================================================= */

/**
 * GET /api/bodegas
 * Lista todas las bodegas (incluye layout si existe).
 */
router.get('/', async (req, res) => {
  try {
    const rows = await q(
      `SELECT
         b.id_bodega,
         b.nombre,
         b.ciudad,
         b.direccion,
         b.ancho,
         b.largo,
         b.alto,
         b.id_usuario,
         b.activo             AS is_active,
         b.fecha_eliminacion  AS deleted_at,
         b.fecha_creacion     AS created_at,
         b.fecha_actualizacion AS updated_at,
         l.ancho              AS layout_ancho,
         l.largo              AS layout_largo,
         l.mapa_json          AS layout_mapa_json
       FROM bodegas b
       LEFT JOIN bodega_layouts l
         ON l.id_bodega = b.id_bodega
       WHERE b.fecha_eliminacion IS NULL
       ORDER BY b.id_bodega ASC`
    );

    console.log('[GET /api/bodegas] ->', rows.length, 'registros');
    res.json({ error: false, status: 200, body: rows });
  } catch (err) {
    console.log('[GET /api/bodegas] ERROR:', err);
    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error obteniendo bodegas',
    });
  }
});

/**
 * GET /api/bodegas/:id
 * Obtener una bodega específica (incluye layout si existe).
 */
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const rows = await q(
      `SELECT
         b.id_bodega,
         b.nombre,
         b.ciudad,
         b.direccion,
         b.ancho,
         b.largo,
         b.alto,
         b.id_usuario,
         b.activo             AS is_active,
         b.fecha_eliminacion  AS deleted_at,
         b.fecha_creacion     AS created_at,
         b.fecha_actualizacion AS updated_at,
         l.ancho              AS layout_ancho,
         l.largo              AS layout_largo,
         l.mapa_json          AS layout_mapa_json
       FROM bodegas b
       LEFT JOIN bodega_layouts l
         ON l.id_bodega = b.id_bodega
       WHERE b.id_bodega = ?
         AND b.fecha_eliminacion IS NULL
       LIMIT 1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: true,
        status: 404,
        message: 'Bodega no encontrada',
      });
    }

    res.json({ error: false, status: 200, body: rows[0] });
  } catch (err) {
    console.log('[GET /api/bodegas/:id] ERROR:', err);
    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error obteniendo bodega',
    });
  }
});

/**
 * POST /api/bodegas
 * Crea una nueva bodega (y opcionalmente su layout).
 */
router.post('/', async (req, res) => {
  try {
    const {
      nombre,
      ciudad,
      direccion,
      ancho,
      largo,
      alto,
      id_usuario,
      activo = 1,
      layout, // 👈 viene del frontend (layout: { ancho, largo, mapa_json })
    } = req.body || {};

    if (!nombre || !direccion) {
      return res.status(400).json({
        error: true,
        status: 400,
        message: 'nombre y direccion son obligatorios',
      });
    }

    const result = await q(
      `INSERT INTO bodegas
         (nombre, ciudad, direccion, ancho, largo, alto, id_usuario, activo, fecha_creacion, fecha_actualizacion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        nombre,
        ciudad || null,
        direccion,
        ancho || 0,
        largo || 0,
        alto || 0,
        id_usuario || null,
        activo ? 1 : 0,
      ]
    );

    const newId = result.insertId;

    // Guardar layout + generar ubicaciones (si viene)
    await upsertLayoutForBodega(newId, layout);

    res.status(201).json({
      error: false,
      status: 201,
      body: { id_bodega: newId },
    });
  } catch (err) {
    console.log('[POST /api/bodegas] ERROR:', err);
    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error creando bodega',
    });
  }
});

/**
 * PUT /api/bodegas/:id
 * Actualiza bodega existente (y opcionalmente su layout).
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nombre,
      ciudad,
      direccion,
      ancho,
      largo,
      alto,
      id_usuario,
      is_active,
      activo,
      layout, // 👈 puede venir actualizado desde el frontend
    } = req.body || {};

    const fields = [];
    const params = [];

    if (nombre !== undefined) { fields.push('nombre = ?'); params.push(nombre); }
    if (ciudad !== undefined) { fields.push('ciudad = ?'); params.push(ciudad); }
    if (direccion !== undefined) { fields.push('direccion = ?'); params.push(direccion); }
    if (ancho !== undefined) { fields.push('ancho = ?'); params.push(ancho); }
    if (largo !== undefined) { fields.push('largo = ?'); params.push(largo); }
    if (alto !== undefined) { fields.push('alto = ?'); params.push(alto); }
    if (id_usuario !== undefined) { fields.push('id_usuario = ?'); params.push(id_usuario); }

    const activeValue =
      typeof is_active === 'number' || typeof is_active === 'boolean'
        ? (is_active ? 1 : 0)
        : typeof activo === 'number' || typeof activo === 'boolean'
        ? (activo ? 1 : 0)
        : undefined;

    if (activeValue !== undefined) {
      fields.push('activo = ?');
      params.push(activeValue);
    }

    fields.push('fecha_actualizacion = NOW()');

    const sql = `
      UPDATE bodegas
      SET ${fields.join(', ')}
      WHERE id_bodega = ?
    `;
    params.push(id);

    await q(sql, params);

    // Actualizar/crear layout + regenerar ubicaciones (si viene)
    await upsertLayoutForBodega(Number(id), layout);

    res.json({
      error: false,
      status: 200,
      body: { id_bodega: id },
    });
  } catch (err) {
    console.log('[PUT /api/bodegas/:id] ERROR:', err);
    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error actualizando bodega',
    });
  }
});

/**
 * DELETE /api/bodegas/:id
 * Soft delete: activo=0 y fecha_eliminacion.
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await q(
      `UPDATE bodegas
       SET activo = 0,
           fecha_eliminacion = NOW(),
           fecha_actualizacion = NOW()
       WHERE id_bodega = ?`,
      [id]
    );

    res.json({
      error: false,
      status: 200,
      body: { id_bodega: id },
    });
  } catch (err) {
    console.log('[DELETE /api/bodegas/:id] ERROR:', err);
    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error eliminando bodega',
    });
  }
});

/* =========================================================================
 *  ENDPOINT PARA ASIGNAR ITEMS AUTOMÁTICAMENTE
 * ========================================================================= */

/**
 * POST /api/bodegas/:id/items/auto
 * Body: { id_item: number }
 * Asigna el item a una ubicación libre dentro de la bodega.
 */
router.post('/:id/items/auto', async (req, res) => {
  const id_bodega = Number(req.params.id);
  const { id_item } = req.body || {};

  if (!id_bodega || !id_item) {
    return res.status(400).json({
      error: true,
      status: 400,
      message: 'id_bodega o id_item faltante',
    });
  }

  try {
    const result = await asignarItemAuto(id_bodega, Number(id_item));

    res.status(201).json({
      error: false,
      status: 201,
      body: result, // { id_ubicacion }
    });
  } catch (err) {
    console.log('[POST /api/bodegas/:id/items/auto] ERROR:', err);

    if (err.code === 'NO_FREE_LOCATION') {
      return res.status(409).json({
        error: true,
        status: 409,
        message: 'No hay ubicaciones disponibles en esta bodega',
      });
    }

    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error asignando item a ubicación',
    });
  }
});

module.exports = router;
