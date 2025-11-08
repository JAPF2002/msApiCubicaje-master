// src/api/components/item/network.js
const express = require('express');
const router = express.Router();
const db = require('../../../store'); // 👈 ESTE

// Wrapper a Promesa usando db.query (callback-style adaptado)
function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}


/**
 * GET /api/items
 * Lista ítems activos.
 */
router.get('/', async (req, res) => {
  try {
    const rows = await q(
      `SELECT
         id_item,
         id_categoria,
         nombre,
         ancho,
         largo,
         alto,
         peso,
         estado,
         activo           AS is_active,
         fecha_eliminacion AS deleted_at,
         fecha_creacion    AS created_at,
         fecha_actualizacion AS updated_at
       FROM items
       WHERE activo = 1
       ORDER BY id_item ASC`
    );

    console.log('[GET /api/items] ->', rows.length, 'registros');
    res.json({ error: false, status: 200, body: rows });
  } catch (err) {
    console.log('[GET /api/items] ERROR:', err);
    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error obteniendo ítems',
    });
  }
});

/**
 * POST /api/items
 * Crea ítem.
 */
router.post('/', async (req, res) => {
  try {
    const {
      id_categoria,
      nombre,
      ancho,
      largo,
      alto,
      peso,
      estado,
    } = req.body;

    if (!nombre) {
      return res.status(400).json({
        error: true,
        status: 400,
        message: 'nombre es obligatorio',
      });
    }

    const result = await q(
      `INSERT INTO items
         (id_categoria, nombre, ancho, largo, alto, peso, estado, activo, fecha_creacion, fecha_actualizacion)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
      [
        id_categoria || null,
        nombre,
        ancho || 0,
        largo || 0,
        alto || 0,
        peso || 0,
        estado || 'ACTIVO',
      ]
    );

    res.json({
      error: false,
      status: 201,
      body: { id_item: result.insertId },
    });
  } catch (err) {
    console.log('[POST /api/items] ERROR:', err);
    res.status(400).json({
      error: true,
      status: 400,
      message: 'Error creando ítem',
    });
  }
});

/**
 * PUT /api/items
 * Actualiza ítem usando id en el body (id_item o id).
 * Compatible con tu frontend actual.
 */
router.put('/', async (req, res) => {
  try {
    const id =
      req.body.id_item ||
      req.body.id;

    if (!id) {
      return res.status(400).json({
        error: true,
        status: 400,
        message: 'ID de ítem requerido',
      });
    }

    const {
      id_categoria,
      nombre,
      ancho,
      largo,
      alto,
      peso,
      estado,
      is_active,
      activo,
    } = req.body;

    const fields = [];
    const params = [];

    if (id_categoria !== undefined) { fields.push('id_categoria = ?'); params.push(id_categoria); }
    if (nombre !== undefined) { fields.push('nombre = ?'); params.push(nombre); }
    if (ancho !== undefined) { fields.push('ancho = ?'); params.push(ancho); }
    if (largo !== undefined) { fields.push('largo = ?'); params.push(largo); }
    if (alto !== undefined) { fields.push('alto = ?'); params.push(alto); }
    if (peso !== undefined) { fields.push('peso = ?'); params.push(peso); }
    if (estado !== undefined) { fields.push('estado = ?'); params.push(estado); }

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
      UPDATE items
      SET ${fields.join(', ')}
      WHERE id_item = ?
    `;
    params.push(id);

    await q(sql, params);

    res.json({
      error: false,
      status: 200,
      body: { id_item: id },
    });
  } catch (err) {
    console.log('[PUT /api/items] ERROR:', err);
    res.status(400).json({
      error: true,
      status: 400,
      message: 'Error actualizando ítem',
    });
  }
});

/**
 * DELETE /api/items/:id
 * Soft delete.
 */
router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;

    await q(
      `UPDATE items
       SET activo = 0,
           fecha_eliminacion = NOW(),
           fecha_actualizacion = NOW()
       WHERE id_item = ?`,
      [id]
    );

    res.json({
      error: false,
      status: 200,
      body: { id_item: id },
    });
  } catch (err) {
    console.log('[DELETE /api/items/:id] ERROR:', err);
    res.status(400).json({
      error: true,
      status: 400,
      message: 'Error eliminando ítem',
    });
  }
});

module.exports = router;
