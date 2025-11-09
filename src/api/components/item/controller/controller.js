// C:\Users\japf2\Desktop\Tesis Cubicaje\Proyecto\proyectoPrincipal\msApiCubicaje-master\src\api\components\item\controller\controller.js

// Usa el store global (elige dummy/remote según configuración)
// MISMA RUTA que en bodega/space/type: 4 niveles arriba -> src/store
const store = require("../../../../store");

const TABLE_ITEMS = "items";
const TABLE_BODEGA_ITEMS = "bodega_items";

function num(v) {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function clampInt(v, min = 1) {
  const n = parseInt(v || "0", 10);
  return Math.max(Number.isFinite(n) ? n : 0, min);
}

/**
 * Normaliza un registro de item desde BD al formato esperado por el frontend.
 */
function mapItemRow(row) {
  return {
    id: row.id_item ?? row.id,
    nombre: row.nombre,
    ancho: num(row.ancho),
    alto: num(row.alto),
    largo: num(row.largo),
    peso: num(row.peso),
    cantidad: clampInt(row.cantidad ?? row.qty ?? 1, 1),
    bodegaId: row.id_bodega ?? row.bodega_id ?? row.bodegaId ?? null,
    id_categoria: row.id_categoria ?? row.categoriaId ?? null,
    clase: row.clase || null,
  };
}

/**
 * GET /api/items
 */
async function list() {
  const rows = await store.query(
    `SELECT i.*, bi.id_bodega, bi.qty AS cantidad
     FROM ${TABLE_ITEMS} i
     LEFT JOIN ${TABLE_BODEGA_ITEMS} bi ON bi.id_item = i.id_item
     WHERE i.activo IS NULL OR i.activo = 1`
  );

  if (!Array.isArray(rows)) return [];
  return rows.map(mapItemRow);
}

/**
 * GET /api/items/:id
 */
async function get(id) {
  const rows = await store.query(
    `SELECT i.*, bi.id_bodega, bi.qty AS cantidad
     FROM ${TABLE_ITEMS} i
     LEFT JOIN ${TABLE_BODEGA_ITEMS} bi ON bi.id_item = i.id_item
     WHERE i.id_item = ? LIMIT 1`,
    [id]
  );

  if (!rows || !rows.length) {
    throw new Error("Ítem no encontrado");
  }

  return mapItemRow(rows[0]);
}

/**
 * POST /api/items
 * PUT  /api/items/:id
 */
async function upsert(data) {
  const creating = !data.id && !data.id_item;

  const item = {
    id_item: data.id_item || data.id || undefined,
    nombre: data.nombre,
    id_categoria: data.id_categoria || data.categoriaId || null,
    ancho: num(data.ancho),
    alto: num(data.alto),
    largo: num(data.largo),
    peso: num(data.peso),
    activo: data.activo ?? 1,
  };

  if (!item.nombre) {
    throw new Error("El nombre del ítem es requerido");
  }

  let itemId = item.id_item;

  if (creating) {
    delete item.id_item;
    const result = await store.insert(TABLE_ITEMS, item);
    itemId = result.insertId || result.id || itemId;
  } else {
    await store.update(TABLE_ITEMS, { id_item: itemId }, item);
  }

  const bodegaId = data.id_bodega || data.bodegaId;
  const cantidad = clampInt(data.cantidad ?? data.qty ?? 0, 1);

  if (bodegaId) {
    const existing = await store.query(
      `SELECT * FROM ${TABLE_BODEGA_ITEMS}
       WHERE id_bodega = ? AND id_item = ? LIMIT 1`,
      [bodegaId, itemId]
    );

    if (existing && existing.length) {
      await store.update(
        TABLE_BODEGA_ITEMS,
        { id_bodega: bodegaId, id_item: itemId },
        { qty: cantidad }
      );
    } else {
      await store.insert(TABLE_BODEGA_ITEMS, {
        id_bodega: bodegaId,
        id_item: itemId,
        qty: cantidad,
      });
    }
  }

  return get(itemId);
}

/**
 * DELETE /api/items/:id
 * Borrado lógico.
 */
async function remove(id) {
  await store.update(
    TABLE_ITEMS,
    { id_item: id },
    {
      activo: 0,
      deleted_at: new Date(),
    }
  );

  return { message: "Ítem eliminado" };
}

module.exports = {
  list,
  get,
  upsert,
  remove,
};
