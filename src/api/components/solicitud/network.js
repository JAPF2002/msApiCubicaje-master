// msApiCubicaje-master/src/api/components/solicitud/network.js

const express = require("express");
const router = express.Router();

const controller = require("./controller"); // carga controller/index.js
const {verificarToken} = require("../../..//middleware/auth.middleware")
// GET /api/solicitudes?id_empleado=2
// GET /api/solicitudes?estado=pendiente
// GET /api/solicitudes?estado=all

router.use(verificarToken)
router.get("/", controller.list);

// POST /api/solicitudes
router.post("/", controller.insert);

// PATCH /api/solicitudes/:id  body: { estado: "aceptada" | "rechazada" }
router.patch("/:id", controller.updateEstado);

// (extra) por si tu front lo llama así:
router.patch("/:id/estado", controller.updateEstado);

module.exports = router;
