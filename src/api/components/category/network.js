// msApiCubicaje-master/src/api/components/category/network.js

const express = require('express');
const router = express.Router();
const {verificarToken} = require("../../../middleware/auth.middleware")

// Este store es el wrapper que habla con msMysqlCubicaje (src/store.js)
const store = require('../../../store');

router.use(verificarToken)

/**
 * GET /api/categorias
 * Devuelve todas las categorías tal cual vienen de la BD.
 * Formato de respuesta:
 * {
 *   "error": false,
 *   "status": 200,
 *   "body": [ { id_categoria, nombre, descripcion, activo, ... }, ... ]
 * }
 */
router.get('/', async (req, res) => {
  try {
    // Usamos la capa de datos normalizada
    const rows = await store.list('categorias');

    console.log('[GET /api/categorias] ->', rows.length, 'registros');
    return res.json({
      error: false,
      status: 200,
      body: rows,
    });
  } catch (err) {
    console.log('[GET /api/categorias] ERROR:', err);
    return res.status(500).json({
      error: true,
      status: 500,
      message: 'Error obteniendo categorías',
    });
  }
});

module.exports = router;
