// msApiCubicaje-master/src/api/components/item/index.js

const router = require('./network');

module.exports = (server, config) => {
  server.use('/api/items', router);
};
