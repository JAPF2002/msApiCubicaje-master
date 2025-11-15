// msApiCubicaje-master/src/api/index.js

const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const config = require('../../config');

// Routers de la API
const bodega = require('./components/bodega/network');
const item = require('./components/item/network'); // 👈 ACTIVADO
// Si después quieres usar el resto, los revisamos uno por uno.
// const space = require('./components/space/network');
// const type = require('./components/type/network');
// const category = require('./components/category/network');

const app = express();

// Middlewares globales
app.use(bodyParser.json());
app.use(morgan('dev'));

// Rutas activas
app.use('/api/bodegas', bodega);
app.use('/api/items', item); // 👈 ACTIVADO

// Cuando estén OK los otros routers, descomentas:
// app.use('/api/spaces', space);
// app.use('/api/types', type);
// app.use('/api/categorias', category);

app.listen(config.api.port, () => {
  console.log('msApiCubicaje escuchando en el puerto', config.api.port);
});

module.exports = app;
