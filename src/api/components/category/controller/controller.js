// src/api/components/category/controller.js

const TABLE = 'categorias';

module.exports = function (injectedStore) {
  const store = injectedStore || require('../../../../store/dummy');

  async function list() {
    return store.list(TABLE);
  }

  async function get(id) {
    return store.get(TABLE, id);
  }

  // Opcional: si necesitas crear/editar categorías desde la app
  async function insert(data) {
    return store.insert(TABLE, data);
  }

  async function update(data) {
    if (!data.id && !data.id_categoria) {
      throw new Error('ID requerido para actualizar categoría');
    }
    const id = data.id || data.id_categoria;
    return store.update(TABLE, { ...data, id });
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
