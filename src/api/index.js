// msApiCubicaje-master/src/api/index.js

const express = require("express");
const bodyParser = require("body-parser");
const morgan = require("morgan");
const cors = require("cors");

const config = require("../../config");

// Routers activos
const bodegaRouter = require("./components/bodega/network");
const categoryRouter = require("./components/category/network");
const itemRouter = require("./components/item/network");
const solicitudRouter = require("./components/solicitud/network");
const movimientoRouter = require("./components/movimiento/network"); // ✅ NUEVO

const app = express();

// Middlewares globales
app.use(bodyParser.json());
app.use(morgan("dev"));
app.use(cors());

// Healthcheck
app.get("/health", (req, res) => {
  res.status(200).json({
    ok: true,
    service: "msApiCubicaje",
    port: config.api.port,
  });
});

// Rutas activas
app.use("/api/bodegas", bodegaRouter);
app.use("/api/categorias", categoryRouter);
app.use("/api/items", itemRouter);
app.use("/api/solicitudes", solicitudRouter);
app.use("/api/movimientos", movimientoRouter); // ✅ NUEVO

app.listen(config.api.port, () => {
  console.log("msApiCubicaje escuchando en el puerto", config.api.port);
});

module.exports = app;
