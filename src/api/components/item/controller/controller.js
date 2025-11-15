// msApiCubicaje-master/src/api/components/item/controller/controller.js

// OJO: desde esta carpeta hay que subir 4 niveles hasta src/store
const store = require('../../../../store');

const TABLE_ITEMS = 'items';
const TABLE_BODEGA_ITEMS = 'bodega_items';

/**
 * Devuelve lista normalizada de ítems combinando items + bodega_items.
 */
async function list() {
  const items = await store.query(TABLE_ITEMS, { activo: 1 }).catch(() => []);
  const rels = await store.query(TABLE_BODEGA_ITEMS).catch(() => []);

  const byItem = new Map();
  if (Array.isArray(rels)) {
    for (const r of rels) {
      const key = Number(r.id_item);
      if (!byItem.has(key)) byItem.set(key, []);
      byItem.get(key).push(r);
    }
  }

  const result = [];

  if (Array.isArray(items)) {
    for (const it of items) {
      const id = Number(it.id_item || it.id);
      const links = byItem.get(id) || [];

      const totalQtyFromLinks = links.reduce(
        (acc, r) => acc + Number(r.qty || 0),
        0
      );

      const totalQty =
        totalQtyFromLinks > 0
          ? totalQtyFromLinks
          : Number(it.cantidad || 0) || 1;

      let bodegaId = null;
      if (links.length === 1) {
        bodegaId = Number(links[0].id_bodega);
      }

      result.push({
        id,
        nombre: it.nombre,
        ancho: Number(it.ancho || 0),
        alto: Number(it.alto || 0),
        largo: Number(it.largo || 0),
        peso: Number(it.peso || 0),
        cantidad: totalQty,
        bodegaId,
        id_categoria: Number(it.id_categoria || 0) || null,
        clase: it.clase || null,
      });
    }
  }

  console.log(
    `[ITEM LIST] items=${result.length}, bodega_items=${
      Array.isArray(rels) ? rels.length : 0
    }, activos=${Array.isArray(items) ? items.length : 0}`
  );

  return result;
}

/**
 * Crear / actualizar ítem.
 */
async function upsert(data, creating) {
  const id = Number(data.id_item || data.id) || null;
  const nombre = (data.nombre || '').trim();

  if (!nombre) throw new Error('Nombre requerido');

  const baseData = {
    nombre,
    ancho: Number(data.ancho || 0),
    alto: Number(data.alto || 0),
    largo: Number(data.largo || 0),
    peso: Number(data.peso || 0),
    id_categoria: data.id_categoria || null,
    activo: 1,
  };

  // CREAR
  if (creating) {
    const inserted = await store.insert(TABLE_ITEMS, baseData);
    const newId = inserted.insertId || inserted.id;
    const idItem = newId;

    const idBodega = data.id_bodega || data.bodegaId || null;
    const cantidad = Number(data.cantidad || 0);

    if (idItem && idBodega && cantidad > 0) {
      await store.insert(TABLE_BODEGA_ITEMS, {
        id_bodega: idBodega,
        id_item: idItem,
        qty: cantidad,
      });
    }

    return { id: idItem };
  }

  // ACTUALIZAR
  if (!id) throw new Error('ID requerido');

  const fields = {};
  for (const k of ['nombre', 'ancho', 'alto', 'largo', 'peso', 'id_categoria']) {
    if (data[k] !== undefined && data[k] !== null && data[k] !== '') {
      fields[k] = baseData[k];
    }
  }

  if (Object.keys(fields).length === 0) {
    throw new Error('update(): no hay campos para actualizar.');
  }

  await store.update(TABLE_ITEMS, { id_item: id }, fields);

  // Actualizar relación en bodega_items si viene info
  if (data.id_bodega || data.bodegaId || data.cantidad) {
    const idBodega = data.id_bodega || data.bodegaId || null;
    const cantidad = Number(data.cantidad || 0);

    if (idBodega && cantidad > 0) {
      const rows = await store.query(TABLE_BODEGA_ITEMS, {
        id_bodega: idBodega,
        id_item: id,
      });

      if (Array.isArray(rows) && rows.length) {
        await store.update(
          TABLE_BODEGA_ITEMS,
          { id_bodega: idBodega, id_item: id },
          { qty: cantidad }
        );
      } else {
        await store.insert(TABLE_BODEGA_ITEMS, {
          id_bodega: idBodega,
          id_item: id,
          qty: cantidad,
        });
      }
    }
  }

  return { id };
}

/**
 * Eliminar ítem.
 */
async function remove(id) {
  const nId = Number(id || 0);
  if (!nId) throw new Error('ID requerido');

  await store.remove(TABLE_BODEGA_ITEMS, { id_item: nId });
  await store.remove(TABLE_ITEMS, { id_item: nId });

  return true;
}

/**
 * Mover cantidad parcial entre bodegas.
 */
async function moveQty({ id, fromBodegaId, toBodegaId, cantidad }) {
  const itemId = Number(id || 0);
  const fromId = fromBodegaId ? Number(fromBodegaId) : null;
  const toId = Number(toBodegaId || 0);
  const qty = Number(cantidad || 0);

  if (!itemId) throw new Error('ID de ítem inválido');
  if (!toId) throw new Error('Bodega destino requerida');
  if (!qty || qty <= 0) throw new Error('Cantidad debe ser mayor a 0');

  const rels = await store
    .query(TABLE_BODEGA_ITEMS, { id_item: itemId })
    .catch(() => []);

  const list = Array.isArray(rels) ? rels : [];
  if (!list.length) {
    throw new Error('El ítem no tiene cantidades asociadas a bodegas.');
  }

  let fromRow = null;
  if (fromId) {
    fromRow = list.find((r) => Number(r.id_bodega) === fromId);
    if (!fromRow) {
      throw new Error('No hay stock en la bodega origen seleccionada.');
    }
  } else {
    if (list.length === 1) {
      fromRow = list[0];
    } else {
      throw new Error(
        'Se requiere bodega origen (existen múltiples bodegas con este ítem).'
      );
    }
  }

  const fromQty = Number(fromRow.qty || 0);
  if (qty > fromQty) {
    throw new Error(
      `Cantidad a mover (${qty}) es mayor al stock en origen (${fromQty}).`
    );
  }

  const toRow = list.find((r) => Number(r.id_bodega) === toId);

  const newFromQty = fromQty - qty;
  if (newFromQty > 0) {
    await store.update(
      TABLE_BODEGA_ITEMS,
      { id_bodega: fromRow.id_bodega, id_item: itemId },
      { qty: newFromQty }
    );
  } else {
    await store.remove(TABLE_BODEGA_ITEMS, {
      id_bodega: fromRow.id_bodega,
      id_item: itemId,
    });
  }

  if (toRow) {
    const newToQty = Number(toRow.qty || 0) + qty;
    await store.update(
      TABLE_BODEGA_ITEMS,
      { id_bodega: toRow.id_bodega, id_item: itemId },
      { qty: newToQty }
    );
  } else {
    await store.insert(TABLE_BODEGA_ITEMS, {
      id_bodega: toId,
      id_item: itemId,
      qty: qty,
    });
  }

  return {
    ok: true,
    moved: qty,
    fromBodegaId: fromRow.id_bodega,
    toBodegaId: toId,
  };
}

module.exports = {
  list,
  upsert,
  remove,
  moveQty,
};
