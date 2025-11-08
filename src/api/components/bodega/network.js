// src/api/components/bodega/network.js
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
 * GET /api/bodegas
 * Lista todas las bodegas.
 */
router.get('/', async (req, res) => {
  try {
    const rows = await q(
      `SELECT
         id_bodega,
         nombre,
         ciudad,
         direccion,
         ancho,
         largo,
         alto,
         id_usuario,
         activo           AS is_active,
         fecha_eliminacion AS deleted_at,
         fecha_creacion    AS created_at,
         fecha_actualizacion AS updated_at
       FROM bodegas
       ORDER BY id_bodega ASC`
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
 * POST /api/bodegas
 * Crea una nueva bodega.
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
    } = req.body;

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

    res.json({
      error: false,
      status: 201,
      body: { id_bodega: result.insertId },
    });
  } catch (err) {
    console.log('[POST /api/bodegas] ERROR:', err);
    res.status(400).json({
      error: true,
      status: 400,
      message: 'Error creando bodega',
    });
  }
});

/**
 * PUT /api/bodegas/:id
 * Actualiza bodega existente.
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
    } = req.body;

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

    res.json({
      error: false,
      status: 200,
      body: { id_bodega: id },
    });
  } catch (err) {
    console.log('[PUT /api/bodegas/:id] ERROR:', err);
    res.status(400).json({
      error: true,
      status: 400,
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
    res.status(400).json({
      error: true,
      status: 400,
      message: 'Error eliminando bodega',
    });
  }
});

module.exports = router;
