// msApiCubicaje-master/src/api/index.js

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const cors = require('cors');

const config = require('../../config');

// Routers de la API que SÍ vamos a usar por ahora
const bodegaRouter = require('./components/bodega/network');
const categoryRouter = require('./components/category/network');
const itemRouter = require('./components/item/network');

// Si más adelante quieres usar estos, primero revisamos sus archivos:
// const spaceRouter = require('./components/space/network');
// const typeRouter = require('./components/type/network');

const app = express();

// Middlewares globales
app.use(bodyParser.json());
app.use(morgan('dev'));
app.use(cors());

// Healthcheck simple para probar que el servicio está vivo
app.get('/health', (req, res) => {
  res.status(200).json({
    ok: true,
    service: 'msApiCubicaje',
    port: config.api.port,
  });
});

// Rutas activas
app.use('/api/bodegas', bodegaRouter);
app.use('/api/categorias', categoryRouter);
app.use('/api/items', itemRouter);

// Cuando estén OK los otros routers, los activamos:
// app.use('/api/spaces', spaceRouter);
// app.use('/api/types', typeRouter);

app.listen(config.api.port, () => {
  console.log('msApiCubicaje escuchando en el puerto', config.api.port);
});

module.exports = app;
