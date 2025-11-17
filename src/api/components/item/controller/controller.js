// msApiCubicaje-master/src/api/components/item/controller/controller.js

// Controlador de Items: encapsula la lógica de negocio de items + bodega_items
const db = require('../../../../store');

const TABLE_ITEMS = 'items';
const TABLE_BODEGA_ITEMS = 'bodega_items';

// Wrapper de Promesa sobre db.query (callback-style)
function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// Normaliza un registro de items + un posible registro de bodega_items
function buildItemRecord(itemRow, linkRow) {
  const id = Number(itemRow.id_item);
  const base = {
    ...itemRow,
    id,
    id_item: id,
    id_categoria:
      itemRow.id_categoria != null ? Number(itemRow.id_categoria) : null,
    ancho: Number(itemRow.ancho || 0),
    largo: Number(itemRow.largo || 0),
    alto: Number(itemRow.alto || 0),
    peso: itemRow.peso != null ? Number(itemRow.peso) : null,
  };

  if (!linkRow) {
    // Ítem sin relación en bodega_items
    return {
      ...base,
      bodegaId: null,
      cantidad: 0,
    };
  }

  return {
    ...base,
    bodegaId: Number(linkRow.id_bodega),
    cantidad: Number(linkRow.qty || 0),
  };
}

/**
 * Devuelve lista normalizada de ítems combinando items + bodega_items.
 * Cada combinación (item, bodega) se expone como un registro.
 */
async function list() {
  // Solo items activos
  const items = await q(
    `SELECT * FROM ${TABLE_ITEMS} WHERE activo = 1`
  );

  const rels = await q(
    `SELECT * FROM ${TABLE_BODEGA_ITEMS}`
  );

  // Agrupamos relaciones por id_item
  const byItem = new Map();
  for (const r of rels) {
    const key = Number(r.id_item);
    if (!byItem.has(key)) byItem.set(key, []);
    byItem.get(key).push(r);
  }

  const result = [];
  for (const it of items) {
    const id = Number(it.id_item);
    const links = byItem.get(id) || [];

    if (!links.length) {
      // Sin stock asociado en ninguna bodega
      result.push(buildItemRecord(it, null));
    } else {
      for (const link of links) {
        result.push(buildItemRecord(it, link));
      }
    }
  }

  return result;
}

/**
 * Obtiene un ítem por ID (solo el registro de items).
 */
async function get(id) {
  const rows = await q(
    `SELECT * FROM ${TABLE_ITEMS} WHERE id_item = ?`,
    [id]
  );
  if (!rows || !rows.length) {
    throw new Error('Ítem no encontrado');
  }
  return rows[0];
}

/**
 * Crea o actualiza un ítem.
 * Si viene bodegaId + cantidad, también upsertea en bodega_items.
 */
async function upsert(data = {}, creating = false) {
  const nombre = (data.nombre || '').trim();
  const idCategoria = data.id_categoria ?? data.categoriaId ?? null;
  const ancho = Number(data.ancho || 0);
  const largo = Number(data.largo || 0);
  const alto = Number(data.alto || 0);
  const peso = data.peso != null ? Number(data.peso) : null;
  const estado = data.estado || null;

  const bodegaId = data.bodegaId ?? data.id_bodega ?? null;
  const cantidad = Number(data.cantidad || 0);

  if (!nombre) {
    throw new Error('Campo requerido faltante: nombre');
  }

  let itemId = data.id_item || data.id || null;

  if (creating) {
    const insertRes = await q(
      `INSERT INTO ${TABLE_ITEMS}
      (nombre, id_categoria, ancho, largo, alto, peso, estado, activo)
      VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
      [nombre, idCategoria, ancho, largo, alto, peso, estado]
    );

    itemId = insertRes.insertId;
  } else {
    if (!itemId) {
      throw new Error('ID requerido para actualizar');
    }

    await q(
      `UPDATE ${TABLE_ITEMS}
       SET nombre = ?, id_categoria = ?, ancho = ?, largo = ?, alto = ?, peso = ?, estado = ?
       WHERE id_item = ?`,
      [nombre, idCategoria, ancho, largo, alto, peso, estado, itemId]
    );
  }

  // Si viene bodegaId, manejamos el stock en bodega_items
  if (bodegaId != null) {
    const existing = await q(
      `SELECT * FROM ${TABLE_BODEGA_ITEMS}
       WHERE id_bodega = ? AND id_item = ?`,
      [bodegaId, itemId]
    );

    if (!existing.length) {
      if (cantidad > 0) {
        await q(
          `INSERT INTO ${TABLE_BODEGA_ITEMS} (id_bodega, id_item, qty)
           VALUES (?, ?, ?)`,
          [bodegaId, itemId, cantidad]
        );
      }
    } else {
      // Ya existe relación, actualizamos qty (puede ser 0)
      await q(
        `UPDATE ${TABLE_BODEGA_ITEMS}
         SET qty = ?
         WHERE id_bodega = ? AND id_item = ?`,
        [cantidad, bodegaId, itemId]
      );
    }
  }

  return { id: itemId };
}

/**
 * Elimina un ítem y todas sus relaciones en bodega_items.
 */
/**
 * Elimina un ítem y todas sus relaciones en bodega_items,
 * registrando un EGRESO en item_movimientos por cada bodega
 * donde tenía stock.
 */
async function remove(id) {
  const itemId = Number(id);
  if (!itemId) {
    throw new Error('ID inválido');
  }

  // 1) Leer el stock actual por bodega para este ítem
  const stockRows = await q(
    `SELECT id_bodega, qty FROM ${TABLE_BODEGA_ITEMS} WHERE id_item = ?`,
    [itemId]
  );

  // 2) Registrar un movimiento de EGRESO por cada bodega con stock
  for (const row of stockRows) {
    const qty = Number(row.qty || 0);
    if (!qty) continue;

    const meta = {
      source: 'api/items DELETE',
      reason: 'deleteItem',
    };

    await q(
      `INSERT INTO item_movimientos
        (id_item, id_bodega_origen, id_bodega_destino, qty, tipo, motivo, meta)
       VALUES (?, ?, NULL, ?, 'egreso', ?, ?)`,
      [
        itemId,
        row.id_bodega,
        qty,
        'Eliminación de ítem desde la app',
        JSON.stringify(meta),
      ]
    );
  }

  // 3) Borrar el stock en bodega_items
  await q(
    `DELETE FROM ${TABLE_BODEGA_ITEMS} WHERE id_item = ?`,
    [itemId]
  );

  // 4) Borrar el ítem de la tabla items
  await q(
    `DELETE FROM ${TABLE_ITEMS} WHERE id_item = ?`,
    [itemId]
  );

  return { id: itemId };
}


/**
 * Mueve cantidad de un ítem entre bodegas (bodega_items).
 */
/**
 * Mueve cantidad de un ítem entre bodegas (bodega_items)
 * y registra una TRANSFERENCIA en item_movimientos.
 */
async function moveQty({ id, fromBodegaId, toBodegaId, cantidad }) {
  const itemId = Number(id);
  const fromId = Number(fromBodegaId);
  const toId = Number(toBodegaId);
  const qty = Number(cantidad);

  if (!itemId || !fromId || !toId || !qty || qty <= 0) {
    throw new Error('Parámetros inválidos para mover cantidad');
  }

  // 1) Validamos stock en origen
  const fromRows = await q(
    `SELECT * FROM ${TABLE_BODEGA_ITEMS}
     WHERE id_bodega = ? AND id_item = ?`,
    [fromId, itemId]
  );
  const fromRow = fromRows[0];

  if (!fromRow) {
    throw new Error('No existe stock en la bodega de origen');
  }

  const currentFromQty = Number(fromRow.qty || 0);
  if (currentFromQty < qty) {
    throw new Error('Stock insuficiente en la bodega de origen');
  }

  // 2) Leemos destino (si existe)
  const toRows = await q(
    `SELECT * FROM ${TABLE_BODEGA_ITEMS}
     WHERE id_bodega = ? AND id_item = ?`,
    [toId, itemId]
  );
  const toRow = toRows[0];

  // 3) Actualizamos origen
  const newFromQty = currentFromQty - qty;
  if (newFromQty > 0) {
    await q(
      `UPDATE ${TABLE_BODEGA_ITEMS}
       SET qty = ?
       WHERE id_bodega = ? AND id_item = ?`,
      [newFromQty, fromId, itemId]
    );
  } else {
    // Si queda en 0, borramos el registro
    await q(
      `DELETE FROM ${TABLE_BODEGA_ITEMS}
       WHERE id_bodega = ? AND id_item = ?`,
      [fromId, itemId]
    );
  }

  // 4) Actualizamos/insertamos destino
  if (!toRow) {
    await q(
      `INSERT INTO ${TABLE_BODEGA_ITEMS}
       (id_bodega, id_item, qty)
       VALUES (?, ?, ?)`,
      [toId, itemId, qty]
    );
  } else {
    const currentToQty = Number(toRow.qty || 0);
    const newToQty = currentToQty + qty;

    await q(
      `UPDATE ${TABLE_BODEGA_ITEMS}
       SET qty = ?
       WHERE id_bodega = ? AND id_item = ?`,
      [newToQty, toId, itemId]
    );
  }

  // 5) Registrar la TRANSFERENCIA en item_movimientos
  const meta = {
    source: 'api/items/:id/move',
    fromBodegaId: fromId,
    toBodegaId: toId,
  };

  await q(
    `INSERT INTO item_movimientos
      (id_item, id_bodega_origen, id_bodega_destino, qty, tipo, motivo, meta)
     VALUES (?, ?, ?, ?, 'transferencia', ?, ?)`,
    [
      itemId,
      fromId,
      toId,
      qty,
      'Transferencia de stock entre bodegas desde la app',
      JSON.stringify(meta),
    ]
  );

  return {
    ok: true,
    moved: qty,
    fromBodegaId: fromId,
    toBodegaId: toId,
  };
}

/**
 * Devuelve el historial de movimientos (kardex) de un ítem.
 */
async function getMovements(id) {
  const itemId = Number(id);
  if (!itemId) {
    throw new Error('ID inválido');
  }

  const rows = await q(
    `SELECT 
        m.*,
        bo.nombre AS bodega_origen_nombre,
        bd.nombre AS bodega_destino_nombre
     FROM item_movimientos m
     LEFT JOIN bodegas bo ON bo.id_bodega = m.id_bodega_origen
     LEFT JOIN bodegas bd ON bd.id_bodega = m.id_bodega_destino
     WHERE m.id_item = ?
     ORDER BY m.fecha_creacion DESC, m.id_mov DESC`,
    [itemId]
  );

  return rows;
}



module.exports = {
  list,
  get,
  upsert,
  remove,
  moveQty,
  getMovements,
};

