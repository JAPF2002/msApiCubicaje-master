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

    if (bodegaIdRaw != null) {
      const bId = Number(bodegaIdRaw);
      if (!Number.isNaN(bId)) {
        body = all.filter(
          (it) => Number(it.bodegaId ?? 0) === bId
        );
      }
    }

    return response.success(req, res, 200, body);
  } catch (err) {
    console.error('[GET /api/items] ERROR:', err);
    return response.error(
      req,
      res,
      500,
      err.message || 'Error obteniendo ítems'
    );
  }
});

/**
 * GET /api/items/:id
 * Obtiene un ítem por ID.
 */
router.get('/:id', async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) {
      return response.error(req, res, 400, 'ID inválido');
    }

    const data = await controller.get(id);
    return response.success(req, res, 200, data);
  } catch (err) {
    console.error('[GET /api/items/:id] ERROR:', err);
    return response.error(
      req,
      res,
      404,
      err.message || 'Ítem no encontrado'
    );
  }
});

/**
 * POST /api/items
 * Crea un nuevo item (tabla items) y opcionalmente su stock en bodega_items
 * si viene bodegaId + cantidad.
 */
router.post('/', async (req, res) => {
  try {
    const data = req.body || {};
    const result = await controller.upsert(data, true); // creating = true

    return response.success(req, res, 201, result);
  } catch (err) {
    console.error('[POST /api/items] ERROR:', err);
    return response.error(
      req,
      res,
      400,
      err.message || 'Error creando ítem'
    );
  }
});

/**
 * PUT /api/items
 * Actualiza un item existente y/o su cantidad en una bodega.
 * El ID debe venir en body como id o id_item.
 */
router.put('/', async (req, res) => {
  try {
    const data = req.body || {};
    const result = await controller.upsert(data, false); // creating = false

    return response.success(req, res, 200, result);
  } catch (err) {
    console.error('[PUT /api/items] ERROR:', err);
    return response.error(
      req,
      res,
      400,
      err.message || 'Error actualizando ítem'
    );
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
      return response.error(req, res, 400, 'ID inválido');
    }

    const result = await controller.remove(id);
    return response.success(req, res, 200, result);
  } catch (err) {
    console.error('[DELETE /api/items/:id] ERROR:', err);
    return response.error(
      req,
      res,
      400,
      err.message || 'Error eliminando ítem'
    );
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
    const payload = {
      id,
      ...(req.body || {}),
    };

    const result = await controller.moveQty(payload);

    return response.success(req, res, 200, result);
  } catch (err) {
    console.error('[POST /api/items/:id/move] ERROR:', err);
    return response.error(
      req,
      res,
      400,
      err.message || 'Error moviendo cantidad entre bodegas'
    );
  }
});

module.exports = router;
