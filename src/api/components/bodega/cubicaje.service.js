// msApiCubicaje-master/src/api/components/bodega/cubicaje.service.js
const db = require("../../../store");

// Wrapper a Promesa usando db.query (callback-style adaptado)
function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

// Obtiene bodega + layout para calcular tamaño de celda estándar
async function getBodegaConLayout(id_bodega) {
  const rows = await q(
    `
    SELECT
      b.id_bodega,
      b.ancho    AS b_ancho,
      b.largo    AS b_largo,
      b.alto     AS b_alto,
      l.ancho    AS g_ancho,
      l.largo    AS g_largo
    FROM bodegas b
    LEFT JOIN bodega_layouts l
      ON l.id_bodega = b.id_bodega
    WHERE b.id_bodega = ?
    LIMIT 1
  `,
    [id_bodega]
  );

  if (!rows.length) {
    const err = new Error("BODEGA_NOT_FOUND");
    err.code = "BODEGA_NOT_FOUND";
    throw err;
  }

  return rows[0];
}

function calcularCeldaEstandar(bodegaRow) {
  const bAncho = Number(bodegaRow.b_ancho) || 0;
  const bLargo = Number(bodegaRow.b_largo) || 0;
  const bAlto = Number(bodegaRow.b_alto) || 0;

  const gAncho = Number(bodegaRow.g_ancho) || 0;
  const gLargo = Number(bodegaRow.g_largo) || 0;

  if (!bAncho || !bLargo || !bAlto || !gAncho || !gLargo) return null;

  return {
    width: bAncho / gAncho,
    length: bLargo / gLargo,
    height: bAlto,
  };
}

async function getItemDimensiones(id_item) {
  const rows = await q(
    `
    SELECT id_item, nombre, ancho, largo, alto
    FROM items
    WHERE id_item = ?
    LIMIT 1
  `,
    [id_item]
  );

  if (!rows.length) {
    const err = new Error("ITEM_NOT_FOUND");
    err.code = "ITEM_NOT_FOUND";
    throw err;
  }

  const it = rows[0];
  return {
    id_item: Number(it.id_item),
    nombre: it.nombre,
    width: Number(it.ancho) || 0,
    length: Number(it.largo) || 0,
    height: Number(it.alto) || 0,
  };
}

/**
 * Orientación que maximiza apilamiento si hay celda estándar.
 * Devuelve null si no cabe en ninguna orientación.
 */
function calcularMejorOrientacionItem(itemDims, celdaDims) {
  if (!celdaDims) {
    return {
      width: itemDims.width,
      length: itemDims.length,
      height: itemDims.height,
      maxStack: Number.MAX_SAFE_INTEGER,
    };
  }

  const { width: Wc, length: Lc, height: Hc } = celdaDims;

  const dims = [
    Number(itemDims.width) || 0,
    Number(itemDims.length) || 0,
    Number(itemDims.height) || 0,
  ];

  if (!dims[0] || !dims[1] || !dims[2]) {
    return {
      width: itemDims.width,
      length: itemDims.length,
      height: itemDims.height,
      maxStack: Number.MAX_SAFE_INTEGER,
    };
  }

  const perms = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 0, 2],
    [1, 2, 0],
    [2, 0, 1],
    [2, 1, 0],
  ];

  let best = null;

  for (const [iW, iH, iL] of perms) {
    const w = dims[iW];
    const h = dims[iH];
    const l = dims[iL];

    if (w <= Wc && l <= Lc && h <= Hc) {
      const maxStack = Math.max(1, Math.floor(Hc / h));
      const baseArea = w * l;

      if (
        !best ||
        maxStack > best.maxStack ||
        (maxStack === best.maxStack && baseArea < best.baseArea)
      ) {
        best = { width: w, length: l, height: h, maxStack, baseArea };
      }
    }
  }

  if (!best) return null;

  return {
    width: best.width,
    length: best.length,
    height: best.height,
    maxStack: best.maxStack,
  };
}

async function asignarItemAuto(id_bodega, id_item) {
  const bodegaRow = await getBodegaConLayout(id_bodega);
  const celdaDims = calcularCeldaEstandar(bodegaRow);
  const itemDims = await getItemDimensiones(id_item);

  const fit = calcularMejorOrientacionItem(itemDims, celdaDims);

  if (!fit) {
    const err = new Error(
      `ITEM_TOO_BIG_FOR_CELL: El ítem "${itemDims.nombre}" no cabe en una posición estándar de esta bodega.`
    );
    err.code = "ITEM_TOO_BIG_FOR_CELL";
    throw err;
  }

  const maxStack = fit.maxStack;

  // 1) apilar donde ya existe este item y no esté lleno
  let id_ubicacion = null;

  const pilas = await q(
    `
    SELECT ui.id_ubicacion, ui.qty
    FROM bodega_ubicacion_items ui
    INNER JOIN bodega_ubicaciones u ON u.id_ubicacion = ui.id_ubicacion
    WHERE u.id_bodega = ?
      AND u.activo = 1
      AND ui.id_item = ?
    ORDER BY ui.id_ubicacion ASC
    `,
    [id_bodega, id_item]
  );

  for (const p of pilas) {
    const qty = Number(p.qty) || 0;
    if (qty < maxStack) {
      id_ubicacion = Number(p.id_ubicacion);
      break;
    }
  }

  // 2) si no hay pila con espacio, buscar ubicación vacía
  if (!id_ubicacion) {
    const libres = await q(
      `
      SELECT u.id_ubicacion
      FROM bodega_ubicaciones u
      LEFT JOIN bodega_ubicacion_items ui ON ui.id_ubicacion = u.id_ubicacion
      WHERE u.id_bodega = ?
        AND u.activo = 1
        AND ui.id_ubicacion IS NULL
      ORDER BY u.id_ubicacion ASC
      LIMIT 1
      `,
      [id_bodega]
    );

    if (!libres.length) {
      const err = new Error("NO_FREE_LOCATION");
      err.code = "NO_FREE_LOCATION";
      throw err;
    }

    id_ubicacion = Number(libres[0].id_ubicacion);
  }

  // 3) sumar 1 unidad en ubicación
  await q(
    `
    INSERT INTO bodega_ubicacion_items
      (id_ubicacion, id_item, qty, movible, fecha_creacion, fecha_actualizacion)
    VALUES (?, ?, 1, 1, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      qty = qty + 1,
      fecha_actualizacion = NOW()
    `,
    [id_ubicacion, id_item]
  );

  // 4) mantener agregado por bodega
  await q(
    `
    INSERT INTO bodega_items
      (id_bodega, id_item, qty, fecha_creacion, fecha_actualizacion)
    VALUES (?, ?, 1, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      qty = qty + 1,
      fecha_actualizacion = NOW()
    `,
    [id_bodega, id_item]
  );

  return { id_ubicacion };
}

module.exports = { asignarItemAuto };
