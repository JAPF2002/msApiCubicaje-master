// MSAPICUBICAJE-MASTER/src/api/components/item/controller/controller.js

const TABLE = 'items';

module.exports = function (injectedStore) {
  const store = injectedStore || require('../../../../store/dummy');

  function validateItem(data) {
    const required = ['nombre', 'id_categoria', 'ancho', 'largo', 'alto', 'peso'];
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
    validateItem(data);
    return store.insert(TABLE, data);
  }

  async function update(data) {
    const id = data.id_item || data.id;
    if (!id) throw new Error('ID requerido para actualizar');

    const payload = {
      ...data,
      id_item: id,
      id,
    };

    validateItem(payload);
    return store.update(TABLE, payload);
  }

  async function remove(id) {
    return store.remove(TABLE, id);
  }

  return {
    list,
    get,
    insert,
    update,
    remove,
  };
};
