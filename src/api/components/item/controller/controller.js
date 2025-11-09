// C:\Users\japf2\Desktop\Tesis Cubicaje\Proyecto\proyectoPrincipal\msApiCubicaje-master\src\api\components\item\controller\controller.js

const store = require("../../../../store");

const TABLE_ITEMS = "items";
const TABLE_BODEGA_ITEMS = "bodega_items";

/* ------------ Helpers ------------ */

function num(v) {
  const n = parseFloat(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function clampInt(v, min = 1) {
  const n = parseInt(v ?? "0", 10);
  return Math.max(Number.isFinite(n) ? n : 0, min);
}

function mapItemRow(row) {
  return {
    id: row.id_item ?? row.id,
    nombre: row.nombre,
    ancho: num(row.ancho),
    alto: num(row.alto),
    largo: num(row.largo),
    peso: num(row.peso),
    cantidad: clampInt(row.cantidad ?? row.qty ?? 1, 1),
    bodegaId:
      row.id_bodega ?? row.bodega_id ?? row.bodegaId ?? null,
    id_categoria: row.id_categoria ?? row.categoriaId ?? null,
    clase: row.clase || null,
  };
}

/* ------------ LIST: GET /api/items ------------ */

async function list() {
  // usamos las abstracciones del store como en el resto del proyecto
  const itemsRows = (await store.list(TABLE_ITEMS)) || [];
  const relRows =
    (await store.list(TABLE_BODEGA_ITEMS)) || [];

  const relByItem = new Map();
  for (const r of relRows) {
    if (!r) continue;
    relByItem.set(r.id_item, r);
  }

  const activos = itemsRows.filter(
    (r) =>
      r &&
      (r.activo === undefined ||
        r.activo === null ||
        r.activo === 1)
  );

  const merged = activos.map((r) => {
    const rel = relByItem.get(r.id_item);
    return mapItemRow({
      ...r,
      id_bodega: rel?.id_bodega,
      cantidad: rel?.qty ?? r.cantidad,
    });
  });

  console.log(
    `[ITEM LIST] items=${itemsRows.length}, bodega_items=${relRows.length}, activos=${merged.length}`
  );

  return merged;
}

/* ------------ GET: /api/items/:id ------------ */

async function get(id) {
  const itemRow = await store.get(TABLE_ITEMS, id);

  if (!itemRow) {
    throw new Error("Ítem no encontrado");
  }

  const relRows =
    (await store.list(TABLE_BODEGA_ITEMS)) || [];
  const rel = relRows.find(
    (r) => r.id_item === itemRow.id_item
  );

  return mapItemRow({
    ...itemRow,
    id_bodega: rel?.id_bodega,
    cantidad: rel?.qty ?? itemRow.cantidad,
  });
}

/* ------------ UPSERT: POST/PUT /api/items ------------ */

async function upsert(data) {
  console.log("[ITEM UPSERT BODY]", data);

  const creating = !data.id && !data.id_item;

  if (!data.nombre) {
    throw new Error("El nombre del ítem es requerido");
  }

  let itemId = data.id_item || data.id || null;

  const item = {
    nombre: data.nombre,
    id_categoria: data.id_categoria || data.categoriaId || null,
    ancho: num(data.ancho),
    alto: num(data.alto),
    largo: num(data.largo),
    peso: num(data.peso),
    activo: 1,
  };

  if (creating) {
    const result = await store.insert(TABLE_ITEMS, item);
    itemId = result.insertId || result.id || itemId;
  } else {
    if (!itemId) {
      throw new Error("ID requerido para actualizar ítem");
    }
    await store.update(
      TABLE_ITEMS,
      { id_item: itemId },
      item
    );
  }

  const bodegaId = data.id_bodega || data.bodegaId || null;
  const cantidad = clampInt(
    data.cantidad ?? data.qty ?? 1,
    1
  );

  if (bodegaId && itemId) {
    const relRows =
      (await store.list(TABLE_BODEGA_ITEMS)) || [];
    const existing = relRows.find(
      (r) =>
        r.id_bodega === bodegaId &&
        r.id_item === itemId
    );

    if (existing) {
      await store.update(
        TABLE_BODEGA_ITEMS,
        {
          id_bodega: bodegaId,
          id_item: itemId,
        },
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

  if (!itemId) {
    console.log(
      "[ITEM UPSERT] WARNING: itemId indefinido tras guardar"
    );
    return {
      id: null,
      ...item,
      bodegaId,
      cantidad,
    };
  }

  try {
    return await get(itemId);
  } catch (e) {
    console.log(
      "[ITEM UPSERT] WARN no se pudo obtener ítem recién guardado:",
      e.message
    );
    return {
      id: itemId,
      ...item,
      bodegaId,
      cantidad,
    };
  }
}

/* ------------ DELETE: /api/items/:id ------------ */

async function remove(id) {
  await store.update(
    TABLE_ITEMS,
    { id_item: id },
    {
      activo: 0,
      fecha_eliminacion: new Date(),
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
