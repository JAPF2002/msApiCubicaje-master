// C:\Users\japf2\Desktop\Tesis Cubicaje\Proyecto\proyectoPrincipal\msApiCubicaje-master\src\api\components\item\network.js

const express = require("express");
const router = express.Router();

// Helper de respuestas global (ruta correcta)
const response = require("../../../utils/response");

// Controller con la lógica de items
const controller = require("./controller/controller");

// GET /api/items
router.get("/", async (req, res) => {
  try {
    const items = await controller.list();
    // firma: success(req, res, status, data)
    response.success(req, res, 200, items);
  } catch (err) {
    console.error("[GET /api/items] ERROR:", err);
    response.error(req, res, 500, "Error obteniendo ítems");
  }
});

// GET /api/items/:id
router.get("/:id", async (req, res) => {
  try {
    const item = await controller.get(req.params.id);
    response.success(req, res, 200, item);
  } catch (err) {
    console.error("[GET /api/items/:id] ERROR:", err);
    response.error(
      req,
      res,
      404,
      err.message || "Ítem no encontrado"
    );
  }
});

// POST /api/items
router.post("/", async (req, res) => {
  try {
    const item = await controller.upsert(req.body);
    response.success(req, res, 201, item);
  } catch (err) {
    console.error("[POST /api/items] ERROR:", err);
    response.error(
      req,
      res,
      400,
      err.message || "Error creando ítem"
    );
  }
});

// PUT /api/items/:id
router.put("/:id", async (req, res) => {
  try {
    const item = await controller.upsert({
      ...req.body,
      id: req.params.id,
    });
    response.success(req, res, 200, item);
  } catch (err) {
    console.error("[PUT /api/items/:id] ERROR:", err);
    response.error(
      req,
      res,
      400,
      err.message || "Error actualizando ítem"
    );
  }
});

// DELETE /api/items/:id
router.delete("/:id", async (req, res) => {
  try {
    const result = await controller.remove(req.params.id);
    response.success(req, res, 200, result);
  } catch (err) {
    console.error("[DELETE /api/items/:id] ERROR:", err);
    response.error(
      req,
      res,
      400,
      err.message || "Error eliminando ítem"
    );
  }
});

module.exports = router;
