const bodyParser = require('body-parser');
const express = require('express');
const config = require('../../config.js');
const space = require('./components/space/network');
const item = require('./components/item/network');
const type = require('./components/type/network');
const bodega = require('./components/bodega/network');

const app = express();
app.use(bodyParser.json());

app.use('/api/spaces', space);
app.use('/api/items', item);
app.use('/api/types', type);
app.use('/api/bodegas', bodega);


app.listen(config.api.port, () => {
    console.log('Api escuchando en el puerto ', config.api.port);
});