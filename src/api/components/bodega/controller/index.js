const config = require('../../../../../config');
const createRemoteDB = require('../../../../store/remote');
const controller = require('./controller');

const store = createRemoteDB(config.mysqlService.host, config.mysqlService.port);

module.exports = controller(store);
