// msApiCubicaje-master/src/store.js
// Este módulo no crea conexiones propias.
// Reutiliza la capa MySQL de msMysqlCubicaje-master.
// Así msMysqlCubicaje es el único responsable de hablar con la DB.

const path = require('path');

// Estructura esperada:
// proyectoPrincipal/
//   msApiCubicaje-master/
//   msMysqlCubicaje-master/
const mysqlStorePath = path.join(
  __dirname,
  '../../msMysqlCubicaje-master/src/stores/mysql'
);

const mysqlStore = require(mysqlStorePath);

// Validación básica
if (!mysqlStore) {
  throw new Error(
    `[msApiCubicaje] No se pudo requerir el store MySQL en: ${mysqlStorePath}`
  );
}

// OBLIGATORIO: mysqlStore.query debe existir y ser Promise-based
if (typeof mysqlStore.query !== 'function') {
  throw new Error(
    '[msApiCubicaje] El store MySQL no expone query(sql, params). Revisa msMysqlCubicaje-master/src/stores/mysql.js'
  );
}

/**
 * Adaptador a callback-style para compatibilidad con código antiguo:
 * Permite usar:
 *   db.query(sql, cb)
 *   db.query(sql, params, cb)
 */
function query(sql, params, cb) {
  if (typeof params === 'function') {
    cb = params;
    params = [];
  }

  mysqlStore
    .query(sql, params || [])
    .then((rows) => {
      if (cb) cb(null, rows);
    })
    .catch((err) => {
      if (cb) cb(err);
    });
}

module.exports = {
  // Usado por los network.js mediante wrapper q(...)
  query,

  // Extra: por si algún módulo quiere usar helpers directos
  list: mysqlStore.list,
  get: mysqlStore.get,
  insert: mysqlStore.insert,
  update: mysqlStore.update,
  remove: mysqlStore.remove,
};
