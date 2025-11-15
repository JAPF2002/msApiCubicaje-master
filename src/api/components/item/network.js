// msApiCubicaje-master/src/api/components/item/network.js

const express = require('express');
const router = express.Router();

// Lógica de negocio de ítems
const controller = require('./controller/controller');

/**
 * GET /api/items
 * Lista todos los ítems normalizados.
 * Si viene ?bodegaId=XX o ?id_bodega=XX, filtra por esa bodega.
 */
router.get('/', async (req, res) => {
  try {
    const all = await controller.list();

    const bodegaIdRaw = req.query.bodegaId || req.query.id_bodega;
    let body = all;

    if (bodegaIdRaw) {
      const bId = Number(bodegaIdRaw);
      body = all.filter(
        (it) => Number(it.bodegaId || 0) === bId
      );
    }

    res.json({
      error: false,
      status: 200,
      body,
    });
  } catch (err) {
    console.error('[GET /api/items] ERROR:', err);
    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error obteniendo items',
    });
  }
});

/**
 * POST /api/items
 * Crea un nuevo item (items) + su stock en bodega_items (si se envía bodegaId + cantidad).
 *
 * Body ejemplo:
 * {
 *   "nombre": "Caja 1x1x1",
 *   "id_categoria": 2,
 *   "ancho": 1,
 *   "largo": 1,
 *   "alto": 1,
 *   "peso": 5,
 *   "bodegaId": 19,
 *   "cantidad": 10
 * }
 */
router.post('/', async (req, res) => {
  try {
    const data = req.body || {};
    const result = await controller.upsert(data, true); // creating = true

    res.status(201).json({
      error: false,
      status: 201,
      body: result, // { id: idItem }
    });
  } catch (err) {
    console.error('[POST /api/items] ERROR:', err);
    res.status(400).json({
      error: true,
      status: 400,
      message: err.message || 'Error creando item',
    });
  }
});

/**
 * PUT /api/items/:id
 * Actualiza un item existente y/o su cantidad en una bodega.
 */
router.put('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({
        error: true,
        status: 400,
        message: 'ID inválido',
      });
    }

    const data = {
      ...(req.body || {}),
      id_item: id, // para que el controller lo reconozca
    };

    const result = await controller.upsert(data, false); // creating = false

    res.json({
      error: false,
      status: 200,
      body: result || { id },
    });
  } catch (err) {
    console.error('[PUT /api/items/:id] ERROR:', err);
    res.status(400).json({
      error: true,
      status: 400,
      message: err.message || 'Error actualizando item',
    });
  }
});

/**
 * DELETE /api/items/:id
 * Elimina el ítem (items + bodega_items).
 */
router.delete('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({
        error: true,
        status: 400,
        message: 'ID inválido',
      });
    }

    await controller.remove(id);

    res.json({
      error: false,
      status: 200,
      body: { id },
    });
  } catch (err) {
    console.error('[DELETE /api/items/:id] ERROR:', err);
    res.status(400).json({
      error: true,
      status: 400,
      message: err.message || 'Error eliminando item',
    });
  }
});

/**
 * POST /api/items/:id/move
 * Mueve cantidad de un item desde una bodega a otra.
 *
 * Body ejemplo:
 * {
 *   "fromBodegaId": 13,
 *   "toBodegaId": 19,
 *   "cantidad": 5
 * }
 */
router.post('/:id/move', async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    const { fromBodegaId, toBodegaId, cantidad } = req.body || {};

    const result = await controller.moveQty({
      id,
      fromBodegaId,
      toBodegaId,
      cantidad,
    });

    res.json({
      error: false,
      status: 200,
      body: result,
    });
  } catch (err) {
    console.error('[POST /api/items/:id/move] ERROR:', err);
    res.status(400).json({
      error: true,
      status: 400,
      message: err.message || 'Error moviendo cantidad entre bodegas',
    });
  }
});

module.exports = router;
