// src/api/components/category/network.js
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
 * GET /api/categorias
 */
router.get('/', async (req, res) => {
  try {
    const rows = await q(
      `SELECT
         id_categoria,
         nombre,
         descripcion,
         activo,
         fecha_creacion,
         fecha_actualizacion
       FROM categorias
       WHERE activo = 1
       ORDER BY id_categoria ASC`
    );

    console.log('[GET /api/categorias] ->', rows.length, 'registros');
    res.json({ error: false, status: 200, body: rows });
  } catch (err) {
    console.log('[GET /api/categorias] ERROR:', err);
    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error obteniendo categorías',
    });
  }
});

module.exports = router;
