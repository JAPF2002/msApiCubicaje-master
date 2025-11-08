const TABLE = 'bodegas';

module.exports = function (injectedStore) {
  const store = injectedStore || require('../../../../store/dummy');

  // obtiene id_usuario desde usuario_id o id_usuario
  function getUserIdOrThrow(data) {
    const userId = data.usuario_id ?? data.id_usuario;
    if (!userId && userId !== 0) {
      throw new Error('Campo requerido faltante: usuario_id / id_usuario');
    }
    return userId;
  }

  function validateBodega(data) {
    const required = ['nombre', 'ancho', 'largo', 'alto', 'id_usuario'];
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
    const userId = getUserIdOrThrow(data);

    // ⚠️ solo mandamos columnas que EXISTEN en la tabla bodegas
    const payload = {
      nombre: (data.nombre || '').trim(),
      direccion: (data.direccion || '').trim(),
      ciudad: (data.ciudad || '').trim(),
      ancho: Number(data.ancho),
      alto: Number(data.alto),
      largo: Number(data.largo),
      id_usuario: userId,
      is_active: 1,
    };

    validateBodega(payload);
    return store.insert(TABLE, payload);
  }

  async function update(data) {
    const id = data.id_bodega || data.id;
    if (!id) {
      throw new Error('ID requerido para actualizar');
    }

    const userId = data.usuario_id ?? data.id_usuario;

    // igual: solo columnas reales
    const payload = {
      id_bodega: id,
      id, // por compatibilidad con algunos stores remotos
      nombre: (data.nombre || '').trim(),
      direccion: (data.direccion || '').trim(),
      ciudad: (data.ciudad || '').trim(),
      ancho: Number(data.ancho),
      alto: Number(data.alto),
      largo: Number(data.largo),
    };

    if (userId) {
      payload.id_usuario = userId;
    }

    if (data.is_active !== undefined) {
      payload.is_active = data.is_active ? 1 : 0;
    }

    validateBodega(payload);
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
