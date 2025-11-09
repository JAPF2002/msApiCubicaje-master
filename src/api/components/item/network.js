// msApiCubicaje-master/src/api/components/item/network.js

const express = require('express');
const router = express.Router();

const controller = require('./controller/controller');
const response = require('../../../utils/response');

// GET /api/items
router.get('/', async (req, res) => {
  try {
    const data = await controller.list();
    response.success(req, res, 200, data);
  } catch (err) {
    console.log('[GET /api/items] ERROR:', err.message);
    response.error(req, res, 500, err.message || 'Error obteniendo ítems');
  }
});

// GET /api/items/:id
router.get('/:id', async (req, res) => {
  try {
    const data = await controller.get(req.params.id);
    response.success(req, res, 200, data);
  } catch (err) {
    console.log('[GET /api/items/:id] ERROR:', err.message);
    response.error(req, res, 404, err.message || 'Ítem no encontrado');
  }
});

// POST /api/items
router.post('/', async (req, res) => {
  try {
    const data = await controller.upsert(req.body);
    response.success(req, res, 201, data);
  } catch (err) {
    console.log('[POST /api/items] ERROR:', err.message);
    response.error(req, res, 400, err.message || 'Error guardando ítem');
  }
});

// PUT /api/items
router.put('/', async (req, res) => {
  try {
    const data = await controller.upsert(req.body);
    response.success(req, res, 200, data);
  } catch (err) {
    console.log('[PUT /api/items] ERROR:', err.message);
    response.error(req, res, 400, err.message || 'Error guardando ítem');
  }
});

// DELETE /api/items/:id
router.delete('/:id', async (req, res) => {
  try {
    const data = await controller.remove(req.params.id);
    response.success(req, res, 200, data);
  } catch (err) {
    console.log('[DELETE /api/items/:id] ERROR:', err.message);
    response.error(req, res, 400, err.message || 'Error eliminando ítem');
  }
});

module.exports = router;
