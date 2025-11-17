// msApiCubicaje-master/src/api/components/item/network.js

const express = require('express');
const router = express.Router();

// Lógica de negocio de ítems
const controller = require('./controller/controller');
const response = require('../../../utils/response');

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
      body = all.filter((it) => Number(it.bodegaId || 0) === bId);
    }

    return res.json({
      error: false,
      status: 200,
      body,
    });
  } catch (err) {
    console.log('[GET /api/items] ERROR:', err);
    return res.status(500).json({
      error: true,
      status: 500,
      message: err.message || 'Error obteniendo items',
    });
  }
});

/**
 * GET /api/items/:id/movimientos
 * Devuelve el historial (kardex) de un ítem.
 * IMPORTANTE: esta ruta va antes de GET /:id para que no la capture como un id.
 */
router.get('/:id/movimientos', async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({
        error: true,
        status: 400,
        message: 'ID inválido',
      });
    }

    const movimientos = await controller.getMovements(id);

    return res.json({
      error: false,
      status: 200,
      body: movimientos,
    });
  } catch (err) {
    console.log('[GET /api/items/:id/movimientos] ERROR:', err);
    return res.status(500).json({
      error: true,
      status: 500,
      message: err.message || 'Error obteniendo movimientos del item',
    });
  }
});

/**
 * GET /api/items/:id
 * Devuelve solo el registro base del ítem (tabla items).
 */
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({
        error: true,
        status: 400,
        message: 'ID inválido',
      });
    }

    const data = await controller.get(id);

    return res.json({
      error: false,
      status: 200,
      body: data,
    });
  } catch (err) {
    console.log('[GET /api/items/:id] ERROR:', err);
    return res.status(404).json({
      error: true,
      status: 404,
      message: err.message || 'Ítem no encontrado',
    });
  }
});

/**
 * POST /api/items
 * Crea un nuevo item (items) + su stock en bodega_items (si se envía bodegaId + cantidad).
 */
router.post('/', async (req, res) => {
  try {
    const data = req.body || {};
    const result = await controller.upsert(data, true); // creating = true

    return res.status(201).json({
      error: false,
      status: 201,
      body: result, // { id: idItem }
    });
  } catch (err) {
    console.log('[POST /api/items] ERROR:', err);
    return res.status(400).json({
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

    return res.json({
      error: false,
      status: 200,
      body: result || { id },
    });
  } catch (err) {
    console.log('[PUT /api/items/:id] ERROR:', err);
    return res.status(400).json({
      error: true,
      status: 400,
      message: err.message || 'Error actualizando item',
    });
  }
});

/**
 * DELETE /api/items/:id
 * Elimina el ítem (items + bodega_items) y registra EGRESOS en item_movimientos.
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

    return res.json({
      error: false,
      status: 200,
      body: { id },
    });
  } catch (err) {
    console.log('[DELETE /api/items/:id] ERROR:', err);
    return res.status(400).json({
      error: true,
      status: 400,
      message: err.message || 'Error eliminando item',
    });
  }
});

/**
 * POST /api/items/:id/move
 * Mueve cantidad de un item desde una bodega a otra.
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

    return res.json({
      error: false,
      status: 200,
      body: result,
    });
  } catch (err) {
    console.log('[POST /api/items/:id/move] ERROR:', err);
    return res.status(400).json({
      error: true,
      status: 400,
      message: err.message || 'Error moviendo cantidad entre bodegas',
    });
  }
});

module.exports = router;
