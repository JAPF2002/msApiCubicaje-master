// msApiCubicaje-master/src/api/components/item/controller/controller.js

const store = require('../../../../store');

const TABLE_ITEMS = 'items';
const TABLE_BI = 'bodega_items';

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function clampInt(v, min = 1) {
  const n = parseInt(v, 10);
  if (!Number.isFinite(n) || n < min) return min;
  return n;
}

function buildItemRow(baseItem, rel) {
  return {
    id: baseItem.id_item || baseItem.id,
    nombre: baseItem.nombre,
    ancho: num(baseItem.ancho),
    alto: num(baseItem.alto),
    largo: num(baseItem.largo),
    peso: num(baseItem.peso),
    cantidad: rel ? clampInt(rel.qty || rel.cantidad || 1, 1) : 1,
    bodegaId: rel ? (rel.id_bodega || rel.bodegaId || null) : null,
    id_categoria: baseItem.id_categoria || null,
    clase: baseItem.clase || null,
  };
}

/** GET /api/items */
async function list() {
  try {
    const items = (await store.list(TABLE_ITEMS)) || [];
    let bi = [];

    try {
      bi = (await store.list(TABLE_BI)) || [];
    } catch (e) {
      console.warn('[ITEM LIST] advertencia al leer bodega_items:', e.message);
      bi = [];
    }

    const byItem = new Map();
    for (const rel of bi) {
      const itemId = rel.id_item || rel.itemId;
      if (!itemId) continue;
      if (!byItem.has(itemId)) byItem.set(itemId, []);
      byItem.get(itemId).push(rel);
    }

    const result = [];
    for (const it of items) {
      if (it.activo !== undefined && Number(it.activo) === 0) continue;

      const itemId = it.id_item || it.id;
      const rels = byItem.get(itemId) || [];

      if (!rels.length) {
        result.push(buildItemRow(it, null));
      } else {
        for (const rel of rels) {
          result.push(buildItemRow(it, rel));
        }
      }
    }

    console.log(
      `[ITEM LIST] items=${items.length}, bodega_items=${bi.length}, activos=${result.length}`
    );

    return result;
  } catch (err) {
    console.error('[ITEM LIST] ERROR:', err);
    throw new Error('Error obteniendo ítems');
  }
}

/** GET /api/items/:id */
async function get(id) {
  const all = await list();
  const it = all.find((x) => String(x.id) === String(id));
  if (!it) throw new Error('Ítem no encontrado');
  return it;
}

/** POST/PUT /api/items */
async function upsert(body) {
  try {
    const id = body.id_item || body.id || null;

    const dataItem = {
      id_item: id || undefined,
      nombre: body.nombre,
      id_categoria: body.id_categoria || body.categoriaId || null,
      ancho: num(body.ancho),
      alto: num(body.alto),
      largo: num(body.largo),
      peso: num(body.peso),
      activo: body.activo !== undefined ? Number(body.activo) : 1,
    };

    Object.keys(dataItem).forEach((k) => {
      if (dataItem[k] === undefined) delete dataItem[k];
    });

    if (!dataItem.nombre) throw new Error('Nombre requerido');

    let itemId = id;

    if (!itemId) {
      const insertRes = await store.insert(TABLE_ITEMS, dataItem);
      itemId = insertRes.insertId || dataItem.id_item || insertRes.id;
      if (!itemId) throw new Error('No se pudo obtener el id del ítem insertado');
    } else {
      dataItem.id_item = itemId;
      await store.update(TABLE_ITEMS, dataItem);
    }

    const bodegaId = body.id_bodega || body.bodegaId || null;
    const qtyRaw = body.cantidad !== undefined ? body.cantidad : body.qty;

    if (store.query) {
      await store.query('DELETE FROM bodega_items WHERE id_item = ?', [itemId]);
    }

    if (bodegaId && qtyRaw !== undefined) {
      const qty = clampInt(qtyRaw, 1);
      await store.insert(TABLE_BI, {
        id_bodega: bodegaId,
        id_item: itemId,
        qty,
      });
    }

    return { id: itemId };
  } catch (err) {
    console.error('[ITEM UPSERT] ERROR:', err);
    throw new Error(err.message || 'Error guardando ítem');
  }
}

/** DELETE /api/items/:id */
async function remove(id) {
  try {
    if (store.query) {
      await store.query('DELETE FROM bodega_items WHERE id_item = ?', [id]);
    }
    await store.remove(TABLE_ITEMS, id);
    return { id };
  } catch (err) {
    console.error('[ITEM DELETE] ERROR:', err);
    throw new Error('Error eliminando ítem');
  }
}

module.exports = {
  list,
  get,
  upsert,
  remove,
};
