const express = require('express');
const bodyParser = require('body-parser');
const morgan = require('morgan');
const config = require('../../config');

const space = require('./components/space/network');
const item = require('./components/item/network');
const type = require('./components/type/network');
const bodega = require('./components/bodega/network');
const category = require('./components/category/network');

const app = express();
app.use(bodyParser.json());
app.use(morgan('dev'));

app.use('/api/spaces', space);
app.use('/api/items', item);
app.use('/api/types', type);
app.use('/api/bodegas', bodega);
app.use('/api/categorias', category);

app.listen(config.api.port, () => {
  console.log('msApiCubicaje escuchando en el puerto', config.api.port);
});
