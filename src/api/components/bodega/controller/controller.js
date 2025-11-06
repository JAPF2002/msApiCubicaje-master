const TABLE = 'bodegas';

module.exports = function (injectedStore) {
  let store = injectedStore || require('../../../../store/dummy');

  function validateBodega(data) {
    const required = ['nombre', 'ancho', 'largo', 'alto', 'usuario_id'];
    for (const k of required) {
      if (!data[k] && data[k] !== 0) {
        throw new Error(`Campo requerido faltante: ${k}`);
      }
    }
  }

  async function list() {
    return store.list(TABLE);
  }

  async function get(id) {
    return store.get(TABLE, id);
  }

  async function insert(data) {
    validateBodega(data);
    return store.insert(TABLE, data);
  }

  async function update(data) {
    if (!data.id) throw new Error('ID requerido para actualizar');
    return store.update(TABLE, data);
  }

  async function remove(id) {
    return store.remove(TABLE, id);
  }

  return { list, get, insert, update, remove };
};
