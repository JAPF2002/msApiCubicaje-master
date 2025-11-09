// C:\Users\japf2\Desktop\Tesis Cubicaje\Proyecto\proyectoPrincipal\msApiCubicaje-master\src\api\components\item\network.js

const express = require("express");
const response = require("../../../utils/response");
const controller = require("./controller/controller");

const router = express.Router();

// GET /api/items
router.get("/", async (req, res) => {
  try {
    const data = await controller.list();
    response.success(req, res, 200, data);
  } catch (err) {
    console.error("[GET /api/items] ERROR:", err);
    response.error(
      req,
      res,
      500,
      err.message || "Error al obtener ítems"
    );
  }
});

// GET /api/items/:id
router.get("/:id", async (req, res) => {
  try {
    const data = await controller.get(req.params.id);
    response.success(req, res, 200, data);
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
    const data = await controller.upsert(req.body || {});
    response.success(req, res, 201, data);
  } catch (err) {
    console.error("[POST /api/items] ERROR:", err);
    response.error(
      req,
      res,
      400,
      err.message || "Error al crear ítem"
    );
  }
});

// PUT /api/items  o /api/items/:id
router.put("/:id?", async (req, res) => {
  try {
    const body = { ...(req.body || {}) };

    if (req.params.id && !body.id && !body.id_item) {
      body.id = req.params.id;
    }

    const data = await controller.upsert(body);
    response.success(req, res, 200, data);
  } catch (err) {
    console.error("[PUT /api/items] ERROR:", err);
    response.error(
      req,
      res,
      400,
      err.message || "Error al actualizar ítem"
    );
  }
});

// DELETE /api/items/:id
router.delete("/:id", async (req, res) => {
  try {
    const data = await controller.remove(req.params.id);
    response.success(req, res, 200, data);
  } catch (err) {
    console.error("[DELETE /api/items/:id] ERROR:", err);
    response.error(
      req,
      res,
      400,
      err.message || "Error al eliminar ítem"
    );
  }
});

module.exports = router;
