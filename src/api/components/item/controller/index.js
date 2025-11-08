// MSAPICUBICAJE-MASTER/src/api/components/item/controller/index.js

const config = require('../../../../../config');
const createRemoteDB = require('../../../../store/remote');
const controllerFactory = require('./controller');

const store = createRemoteDB(
  config.mysqlService.host,
  config.mysqlService.port
);

module.exports = controllerFactory(store);
