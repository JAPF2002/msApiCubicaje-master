// C:\Users\japf2\Desktop\Tesis Cubicaje\Proyecto\proyectoPrincipal\msApiCubicaje-master\src\api\components\bodega\algoritmoCubicaje.js

const db = require("../../../store");

// Wrapper a Promesa usando db.query
function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/* =========================================================================
 * Helpers Layout / Mapa / Celdas bloqueadas
 * ========================================================================= */

function parseMapaJson(mapaJson) {
  if (!mapaJson) return {};
  if (typeof mapaJson === "string") {
    try {
      return JSON.parse(mapaJson);
    } catch {
      return {};
    }
  }
  return mapaJson;
}

function getEstadoCelda(mapa, index) {
  return mapa?.[index] ?? mapa?.[String(index)] ?? "D";
}

function celdaBloqueada(estado) {
  return estado === "B" || estado === "O";
}

async function getLayoutData(id_bodega) {
  const layoutRows = await q(
    `
    SELECT ancho, largo, mapa_json
    FROM bodega_layouts
    WHERE id_bodega = ?
    LIMIT 1
    `,
    [id_bodega]
  );

  if (!layoutRows.length) return null;

  const gAncho = Number(layoutRows[0].ancho) || 0;
  const gLargo = Number(layoutRows[0].largo) || 0;
  const mapa = parseMapaJson(layoutRows[0].mapa_json);

  if (!gAncho || !gLargo) return null;

  return { gAncho, gLargo, mapa };
}

function ubicacionBloqueadaPorLayout(u, layoutData) {
  if (!layoutData) return false;

  const x = Number(u.pos_x) || 0;
  const y = Number(u.pos_y) || 0;
  const index = y * layoutData.gAncho + x;
  const estado = getEstadoCelda(layoutData.mapa, index);

  return celdaBloqueada(estado);
}

/* =========================================================================
 * Helpers Bodega + Celda estándar (altura)
 * ========================================================================= */

async function getBodegaConLayout(id_bodega) {
  const rows = await q(
    `
    SELECT
      b.id_bodega,
      b.ancho AS b_ancho,
      b.largo AS b_largo,
      b.alto  AS b_alto,
      l.ancho AS g_ancho,
      l.largo AS g_largo
    FROM bodegas b
    LEFT JOIN bodega_layouts l ON l.id_bodega = b.id_bodega
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

// Elige orientación que maximiza apilamiento (maxStack). Si no cabe, null.
function calcularMejorOrientacionItem(itemDims, celdaDims) {
  // Si no hay celda estándar (no hay layout), no limitamos.
  if (!celdaDims) {
    return {
      height: Number(itemDims.alto) || 0,
      maxStack: Number.MAX_SAFE_INTEGER,
    };
  }

  const { width: Wc, length: Lc, height: Hc } = celdaDims;

  const dims = [
    Number(itemDims.ancho) || 0,
    Number(itemDims.largo) || 0,
    Number(itemDims.alto) || 0,
  ];

  if (!dims[0] || !dims[1] || !dims[2]) {
    return {
      height: dims[2],
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

  for (const [iW, iL, iH] of perms) {
    const w = dims[iW];
    const l = dims[iL];
    const h = dims[iH];

    if (w <= Wc && l <= Lc && h <= Hc) {
      const maxStack = Math.max(1, Math.floor(Hc / h));
      if (!best || maxStack > best.maxStack) best = { h, maxStack };
    }
  }

  return best ? { height: best.h, maxStack: best.maxStack } : null;
}

/* =========================================================================
 * Heurística simple de cubicaje
 * ========================================================================= */

async function optimizarBodegaSimple(id_bodega) {
  id_bodega = Number(id_bodega) || 0;
  if (!id_bodega) throw new Error("ID de bodega inválido");

  let ubicaciones = await q(
    `
    SELECT id_ubicacion, pos_x, pos_y
    FROM bodega_ubicaciones
    WHERE id_bodega = ? AND activo = 1
    ORDER BY pos_y ASC, pos_x ASC
    `,
    [id_bodega]
  );

  if (!ubicaciones.length) {
    return {
      movimientos: [],
      mensaje: "La bodega no tiene ubicaciones activas (revisa el layout).",
    };
  }

  const layoutData = await getLayoutData(id_bodega);
  if (layoutData) {
    ubicaciones = ubicaciones.filter((u) => !ubicacionBloqueadaPorLayout(u, layoutData));
  }

  if (!ubicaciones.length) {
    return {
      movimientos: [],
      mensaje: "No hay ubicaciones destino (todas están B/O en el layout).",
    };
  }

  const rowsItems = await q(
    `
    SELECT 
      ui.id_ubicacion,
      ui.id_item,
      ui.qty,
      ui.movible,
      i.ancho,
      i.largo,
      i.alto
    FROM bodega_ubicacion_items ui
    INNER JOIN bodega_ubicaciones u ON u.id_ubicacion = ui.id_ubicacion
    INNER JOIN items i ON i.id_item = ui.id_item
    WHERE u.id_bodega = ?
    `,
    [id_bodega]
  );

  const ocupadas = new Set(rowsItems.map((r) => r.id_ubicacion));
  const ubicacionesLibres = ubicaciones
    .map((u) => u.id_ubicacion)
    .filter((id_u) => !ocupadas.has(id_u));

  const itemsMovibles = [];
  for (const r of rowsItems) {
    if (r.movible !== 1 && r.movible !== true) continue;

    const ancho = Number(r.ancho) || 0;
    const largo = Number(r.largo) || 0;
    const alto = Number(r.alto) || 0;
    const volumen = ancho * largo * alto;
    const qty = Number(r.qty) || 0;

    for (let k = 0; k < qty; k++) {
      itemsMovibles.push({
        id_item: Number(r.id_item),
        from_ubicacion: Number(r.id_ubicacion),
        volumen,
      });
    }
  }

  if (!itemsMovibles.length) {
    return { movimientos: [], mensaje: "No hay ítems movibles en esta bodega." };
  }

  itemsMovibles.sort((a, b) => b.volumen - a.volumen);

  const movimientos = [];
  let ptrUbicacion = 0;

  for (const it of itemsMovibles) {
    if (ptrUbicacion >= ubicacionesLibres.length) break;

    const destino = ubicacionesLibres[ptrUbicacion++];
    if (!destino) break;
    if (destino === it.from_ubicacion) continue;

    movimientos.push({
      id_item: it.id_item,
      from_ubicacion: it.from_ubicacion,
      to_ubicacion: destino,
    });

    await q(
      `
      UPDATE bodega_ubicacion_items
      SET qty = qty - 1,
          fecha_actualizacion = NOW()
      WHERE id_ubicacion = ? AND id_item = ? AND qty > 0
      `,
      [it.from_ubicacion, it.id_item]
    );

    await q(
      `
      DELETE FROM bodega_ubicacion_items
      WHERE id_ubicacion = ? AND id_item = ? AND qty <= 0
      `,
      [it.from_ubicacion, it.id_item]
    );

    await q(
      `
      INSERT INTO bodega_ubicacion_items
        (id_ubicacion, id_item, qty, movible, fecha_creacion, fecha_actualizacion)
      VALUES (?, ?, 1, 1, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        qty = qty + 1,
        fecha_actualizacion = NOW()
      `,
      [destino, it.id_item]
    );
  }

  return { movimientos, mensaje: `Se procesaron ${movimientos.length} movimientos de ítems.` };
}

/* =========================================================================
 * Recubicaje por prioridad (COMPACTADO: ítems “pegados” para liberar espacio)
 * ========================================================================= */

async function recubicarBodegaPorPrioridad(id_bodega, itemsPrioridad) {
  id_bodega = Number(id_bodega) || 0;
  if (!id_bodega) {
    const err = new Error("ID de bodega inválido");
    err.code = "BODEGA_ID_INVALID";
    throw err;
  }

  if (!Array.isArray(itemsPrioridad) || !itemsPrioridad.length) {
    const err = new Error("Lista de items vacía");
    err.code = "ITEMS_LIST_EMPTY";
    throw err;
  }

  // id_item -> prioridad
  const prioridadPorItem = new Map();
  for (const it of itemsPrioridad) {
    const id = Number(it.id_item || it.id) || 0;
    const p = Number(it.prioridad || 0) || 0;
    if (!id) continue;
    prioridadPorItem.set(id, p);
  }

  if (!prioridadPorItem.size) {
    const err = new Error("Ningún id_item válido en la lista");
    err.code = "ITEMS_LIST_INVALID";
    throw err;
  }

  // ✅ Guardar prioridad POR BODEGA en bodega_items.prioridad
  for (const [id_item, prioridad] of prioridadPorItem.entries()) {
    await q(
      `
      INSERT INTO bodega_items (id_bodega, id_item, qty, prioridad, fecha_creacion, fecha_actualizacion)
      VALUES (?, ?, 0, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        prioridad = VALUES(prioridad),
        fecha_actualizacion = NOW()
      `,
      [id_bodega, Number(id_item), Number(prioridad) || 0]
    );
  }

  // 1) ubicaciones activas (orden “arriba/adelante”)
  let ubicaciones = await q(
    `
    SELECT id_ubicacion, pos_x, pos_y
    FROM bodega_ubicaciones
    WHERE id_bodega = ? AND activo = 1
    ORDER BY pos_y ASC, pos_x ASC
    `,
    [id_bodega]
  );

  if (!ubicaciones.length) {
    return {
      movimientos: [],
      mensaje: "La bodega no tiene ubicaciones activas (revisa el layout).",
    };
  }

  // Filtrar por layout: no usar celdas B/O como destino
  const layoutData = await getLayoutData(id_bodega);
  if (layoutData) {
    ubicaciones = ubicaciones.filter((u) => !ubicacionBloqueadaPorLayout(u, layoutData));
  }

  if (!ubicaciones.length) {
    return {
      movimientos: [],
      mensaje: "No hay ubicaciones destino (todas están B/O en el layout).",
    };
  }

  // ✅ IMPORTANTE: para compactar “pegado”, SIEMPRE usamos destAsc
  const destAsc = ubicaciones.map((u) => Number(u.id_ubicacion));

  // 2) items ubicados en bodega + dims
  const rowsItemsAll = await q(
    `
    SELECT 
      ui.id_ubicacion,
      ui.id_item,
      ui.qty,
      ui.movible,
      i.ancho,
      i.largo,
      i.alto
    FROM bodega_ubicacion_items ui
    INNER JOIN bodega_ubicaciones u ON u.id_ubicacion = ui.id_ubicacion
    INNER JOIN items i ON i.id_item = ui.id_item
    WHERE u.id_bodega = ?
    `,
    [id_bodega]
  );

  if (!rowsItemsAll.length) {
    return { movimientos: [], mensaje: "La bodega no tiene ítems registrados." };
  }

  const idsPrioritarios = new Set(prioridadPorItem.keys());

  // 3) solo priorizados + movibles
  const rowsPrioritarios = rowsItemsAll.filter((r) => {
    if (!idsPrioritarios.has(Number(r.id_item))) return false;
    if (r.movible !== 1 && r.movible !== true) return false;
    return true;
  });

  if (!rowsPrioritarios.length) {
    return {
      movimientos: [],
      mensaje: "No hay ítems movibles entre los ítems priorizados.",
    };
  }

  // 4) altura / celda estándar
  const bodegaRow = await getBodegaConLayout(id_bodega);
  const celdaDims = calcularCeldaEstandar(bodegaRow);
  const alturaMax = celdaDims ? Number(celdaDims.height) : Number.POSITIVE_INFINITY;

  // dims por item
  const dimsByItem = new Map();
  for (const r of rowsItemsAll) {
    const idItem = Number(r.id_item);
    if (!idItem) continue;
    if (!dimsByItem.has(idItem)) {
      dimsByItem.set(idItem, {
        ancho: Number(r.ancho) || 0,
        largo: Number(r.largo) || 0,
        alto: Number(r.alto) || 0,
      });
    }
  }

  // contenido actual por ubicación (qty)
  const contentsByUbic = new Map(); // uid -> Map(item -> {qty})
  for (const r of rowsItemsAll) {
    const uid = Number(r.id_ubicacion);
    const iid = Number(r.id_item);
    const qty = Number(r.qty) || 0;
    if (!uid || !iid || qty <= 0) continue;

    if (!contentsByUbic.has(uid)) contentsByUbic.set(uid, new Map());
    contentsByUbic.get(uid).set(iid, { qty });
  }

  // orientación cache
  const orientCache = new Map();
  function getOrientForItem(id_item) {
    if (orientCache.has(id_item)) return orientCache.get(id_item);
    const dims = dimsByItem.get(id_item) || { ancho: 0, largo: 0, alto: 0 };
    const fit = calcularMejorOrientacionItem(dims, celdaDims);
    orientCache.set(id_item, fit);
    return fit;
  }

  // =========================================================
  // COMPACTACIÓN: tirar todo al inicio (pegado), ordenado por prioridad
  // =========================================================

  // total a compactar por item + de dónde sacarlo
  const totalPorItem = new Map();   // id_item -> { qty, prioridad, volumen }
  const sacarDeOrigen = new Map();  // uid -> Map(id_item -> qty)

  for (const r of rowsPrioritarios) {
    const uid = Number(r.id_ubicacion);
    const iid = Number(r.id_item);
    const qty = Number(r.qty) || 0;
    if (!uid || !iid || qty <= 0) continue;

    const prio = Number(prioridadPorItem.get(iid) || 0);
    const dims = dimsByItem.get(iid) || { ancho: 0, largo: 0, alto: 0 };
    const vol = (dims.ancho || 0) * (dims.largo || 0) * (dims.alto || 0);

    if (!totalPorItem.has(iid)) totalPorItem.set(iid, { qty: 0, prioridad: prio, volumen: vol });
    totalPorItem.get(iid).qty += qty;
    totalPorItem.get(iid).prioridad = prio;
    totalPorItem.get(iid).volumen = vol;

    if (!sacarDeOrigen.has(uid)) sacarDeOrigen.set(uid, new Map());
    const m = sacarDeOrigen.get(uid);
    m.set(iid, (m.get(iid) || 0) + qty);
  }

  // base por celda: lo que queda después de sacar lo priorizado movible
  const baseHeightByUbic = new Map(); // uid -> altura ocupada que NO movemos

  for (const uid0 of destAsc) {
    const uid = Number(uid0);
    const cur = contentsByUbic.get(uid) || new Map();

    const stays = new Map();
    for (const [iid, info] of cur.entries()) {
      stays.set(Number(iid), { qty: Number(info.qty) || 0 });
    }

    const out = sacarDeOrigen.get(uid);
    if (out) {
      for (const [iid, qOut] of out.entries()) {
        const idItem = Number(iid);
        const rest = Number(qOut) || 0;
        if (!stays.has(idItem)) continue;

        const left = (Number(stays.get(idItem).qty) || 0) - rest;
        if (left > 0) stays.get(idItem).qty = left;
        else stays.delete(idItem);
      }
    }

    let hUsed = 0;
    if (celdaDims) {
      for (const [iid, info] of stays.entries()) {
        const fit = getOrientForItem(Number(iid));
        if (!fit) continue;
        hUsed += (Number(info.qty) || 0) * (Number(fit.height) || 0);
      }
    }

    baseHeightByUbic.set(uid, hUsed);
  }

  // orden: prioridad desc + volumen desc
  const itemsOrdenados = Array.from(totalPorItem.entries())
    .map(([id_item, v]) => ({
      id_item: Number(id_item),
      qty: Number(v.qty) || 0,
      prioridad: Number(v.prioridad) || 0,
      volumen: Number(v.volumen) || 0,
    }))
    .filter((x) => x.id_item && x.qty > 0)
    .sort((a, b) => (b.prioridad - a.prioridad) || (b.volumen - a.volumen));

  // plan destino compacto: uid -> Map(iid -> qty)
  // (D) Plan destino compacto: uid -> Map(iid -> qty)
  const plan = new Map();
  const addHeight = new Map(); // uid -> altura extra planificada

  // ✅ NUEVO: evitar mezclar ítems en una misma celda
  // uid -> id_item asignado para esa celda (exclusivo)
  const exclusiveItemByUid = new Map();

  function capUnits(uid, iid) {
    if (!celdaDims) return Number.MAX_SAFE_INTEGER;

    // ✅ si esta celda ya fue “reservada” para otro item, no cabe este
    const reserved = exclusiveItemByUid.get(uid);
    if (reserved != null && reserved !== iid) return 0;

    const fit = getOrientForItem(iid);
    if (!fit) return 0;

    const baseH = baseHeightByUbic.get(uid) || 0;
    const extra = addHeight.get(uid) || 0;
    const freeH = alturaMax - (baseH + extra);

    const h = Number(fit.height) || 0;
    if (freeH <= 1e-9 || !h) return 0;

    return Math.max(0, Math.floor(freeH / h));
  }

  function place(uid, iid, qUnits) {
    // ✅ reservar celda para este item si aún no está reservada
    const reserved = exclusiveItemByUid.get(uid);
    if (reserved == null) exclusiveItemByUid.set(uid, iid);
    else if (reserved !== iid) return 0;

    const cap = capUnits(uid, iid);
    if (cap <= 0) return 0;

    const put = Math.min(qUnits, cap);
    if (put <= 0) return 0;

    if (!plan.has(uid)) plan.set(uid, new Map());
    const m = plan.get(uid);
    m.set(iid, (m.get(iid) || 0) + put);

    if (celdaDims) {
      const fit = getOrientForItem(iid);
      addHeight.set(uid, (addHeight.get(uid) || 0) + put * (Number(fit.height) || 0));
    }

    return put;
  }


  let ptr = 0;
  const notPlaced = [];

  // ✅ clave: rellenar destAsc de izquierda->derecha, arriba->abajo (pegado)
  for (const it of itemsOrdenados) {
    let remaining = it.qty;
    const iid = it.id_item;

    while (remaining > 0 && ptr < destAsc.length) {
      const uid = Number(destAsc[ptr]);
      const put = place(uid, iid, remaining);
      remaining -= put;

      // si en esta celda ya no cabe más, avanzamos a la siguiente
      if (capUnits(uid, iid) === 0) ptr++;
      else if (put === 0) ptr++;
    }

    // fallback: buscar huecos (por si ptr avanzó raro)
    if (remaining > 0) {
      for (let i = 0; i < destAsc.length && remaining > 0; i++) {
        const uid = Number(destAsc[i]);
        const put = place(uid, iid, remaining);
        remaining -= put;
      }
    }

    if (remaining > 0) notPlaced.push({ id_item: iid, prioridad: it.prioridad, faltan: remaining });
  }

  if (notPlaced.length) {
    return {
      movimientos: [],
      mensaje: "No se pudo compactar completamente (capacidad insuficiente). No se hicieron cambios.",
      detalle: notPlaced,
    };
  }

  // aplicar DB en transacción
  try {
    await q("START TRANSACTION");

    // sacar todo lo priorizado movible
    for (const [uid, m] of sacarDeOrigen.entries()) {
      for (const [iid, qOut] of m.entries()) {
        const qtyOut = Number(qOut) || 0;
        if (qtyOut <= 0) continue;

        await q(
          `
          UPDATE bodega_ubicacion_items
          SET qty = qty - ?,
              fecha_actualizacion = NOW()
          WHERE id_ubicacion = ? AND id_item = ? AND qty > 0
          `,
          [qtyOut, uid, iid]
        );

        await q(
          `
          DELETE FROM bodega_ubicacion_items
          WHERE id_ubicacion = ? AND id_item = ? AND qty <= 0
          `,
          [uid, iid]
        );
      }
    }

    // sumar en destinos compactados
    for (const [uid, m] of plan.entries()) {
      for (const [iid, qIn] of m.entries()) {
        const qtyIn = Number(qIn) || 0;
        if (qtyIn <= 0) continue;

        await q(
          `
          INSERT INTO bodega_ubicacion_items
            (id_ubicacion, id_item, qty, movible, fecha_creacion, fecha_actualizacion)
          VALUES (?, ?, ?, 1, NOW(), NOW())
          ON DUPLICATE KEY UPDATE
            qty = qty + VALUES(qty),
            movible = 1,
            fecha_actualizacion = NOW()
          `,
          [uid, iid, qtyIn]
        );
      }
    }

    await q("COMMIT");
  } catch (e) {
    try { await q("ROLLBACK"); } catch {}
    throw e;
  }

  const movimientos = itemsOrdenados.map((it) => ({
    id_item: it.id_item,
    prioridad: it.prioridad,
    qty_reubicada: it.qty,
    modo: "compactado_pegado",
  }));

  return {
    movimientos,
    mensaje: "OK: compactado pegado desde el inicio; prioridad alta queda primero y la baja después, sin huecos.",
  };
}


module.exports = {
  optimizarBodegaSimple,
  recubicarBodegaPorPrioridad,
};
