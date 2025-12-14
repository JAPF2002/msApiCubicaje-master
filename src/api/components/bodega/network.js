// msApiCubicaje-master/src/api/components/bodega/network.js
const express = require("express");
const router = express.Router();

const {
  optimizarBodegaSimple,
  recubicarBodegaPorPrioridad,
} = require("./algoritmoCubicaje");

const db = require("../../../store"); // tu módulo original
const {verificarToken} = require("../../../middleware/auth.middleware")

// Wrapper a Promesa usando db.query (callback-style adaptado)
function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/* =========================================================================
 *  HELPERS PARA LAYOUT + UBICACIONES
 * ========================================================================= */

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

// A partir de bodega + layout, calcula dimensiones de una celda física
function calcularCeldaEstandar(bodegaRow) {
  const bAncho = Number(bodegaRow.b_ancho) || 0;
  const bLargo = Number(bodegaRow.b_largo) || 0;
  const bAlto = Number(bodegaRow.b_alto) || 0;

  const gAncho = Number(bodegaRow.g_ancho) || 0;
  const gLargo = Number(bodegaRow.g_largo) || 0;

  if (!bAncho || !bLargo || !bAlto || !gAncho || !gLargo) return null;

  return {
    width: bAncho / gAncho, // ancho físico de una celda
    length: bLargo / gLargo, // largo físico de una celda
    height: bAlto, // altura útil de la celda (simplificación)
  };
}

// Obtiene dimensiones de un ítem
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
    id_item: it.id_item,
    nombre: it.nombre,
    width: Number(it.ancho) || 0,
    length: Number(it.largo) || 0,
    height: Number(it.alto) || 0,
  };
}

/**
 * Mejor orientación 3D dentro de celda estándar:
 * - perLayer = cuántas unidades caben por capa (ancho x largo)
 * - layers   = cuántas capas caben en altura
 * - maxUnits = perLayer * layers
 */
function calcularMejorOrientacionItem(itemDims, celdaDims) {
  // Si no hay layout/celda, no limitamos.
  if (!celdaDims) {
    return {
      width: itemDims.width,
      length: itemDims.length,
      height: itemDims.height,
      perLayer: Number.MAX_SAFE_INTEGER,
      layers: Number.MAX_SAFE_INTEGER,
      maxUnits: Number.MAX_SAFE_INTEGER,
      perRow: Number.MAX_SAFE_INTEGER,
      perCol: Number.MAX_SAFE_INTEGER,
    };
  }

  const { width: Wc, length: Lc, height: Hc } = celdaDims;

  const dims = [
    Number(itemDims.width) || 0,
    Number(itemDims.length) || 0,
    Number(itemDims.height) || 0,
  ];

  // Si falta alguna dimensión -> no bloqueamos (igual devolvemos algo)
  if (!dims[0] || !dims[1] || !dims[2]) {
    return {
      width: itemDims.width,
      length: itemDims.length,
      height: itemDims.height,
      perLayer: Number.MAX_SAFE_INTEGER,
      layers: Number.MAX_SAFE_INTEGER,
      maxUnits: Number.MAX_SAFE_INTEGER,
      perRow: Number.MAX_SAFE_INTEGER,
      perCol: Number.MAX_SAFE_INTEGER,
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
      const perRow = Math.max(1, Math.floor(Wc / w));
      const perCol = Math.max(1, Math.floor(Lc / l));
      const perLayer = Math.max(1, perRow * perCol);

      const layers = Math.max(1, Math.floor(Hc / h));
      const maxUnits = perLayer * layers;

      const baseArea = w * l;

      if (
        !best ||
        maxUnits > best.maxUnits ||
        (maxUnits === best.maxUnits && layers > best.layers) ||
        (maxUnits === best.maxUnits &&
          layers === best.layers &&
          baseArea < best.baseArea)
      ) {
        best = { w, l, h, perRow, perCol, perLayer, layers, maxUnits, baseArea };
      }
    }
  }

  if (!best) return null;

  return {
    width: best.w,
    length: best.l,
    height: best.h,
    perRow: best.perRow,
    perCol: best.perCol,
    perLayer: best.perLayer,
    layers: best.layers,
    maxUnits: best.maxUnits,
  };
}

// Guarda / actualiza el layout de una bodega y regenera ubicaciones
async function upsertLayoutForBodega(id_bodega, layout) {
  if (!layout || !layout.mapa_json) {
    console.log("[upsertLayoutForBodega] sin layout, no se guarda nada");
    return;
  }

  const anchoLayout = Number(layout.ancho) || 0;
  const largoLayout = Number(layout.largo) || 0;

  const mapaJsonString =
    typeof layout.mapa_json === "string"
      ? layout.mapa_json
      : JSON.stringify(layout.mapa_json);

  const sql = `
    INSERT INTO bodega_layouts
      (id_bodega, ancho, largo, mapa_json, fecha_creacion, fecha_actualizacion)
    VALUES (?, ?, ?, ?, NOW(), NOW())
    ON DUPLICATE KEY UPDATE
      ancho = VALUES(ancho),
      largo = VALUES(largo),
      mapa_json = VALUES(mapa_json),
      fecha_actualizacion = NOW()
  `;

  await q(sql, [id_bodega, anchoLayout, largoLayout, mapaJsonString]);

  // regenerar ubicaciones disponibles
  try {
    await regenUbicacionesDesdeLayout(id_bodega, {
      ancho: anchoLayout,
      largo: largoLayout,
      mapa_json: layout.mapa_json,
    });
  } catch (err) {
    console.error("[upsertLayoutForBodega] ERROR regenerando ubicaciones:", err);
  }
}

// Crea bodega_ubicaciones a partir de mapa_json (solo celdas NO bloqueadas)
async function regenUbicacionesDesdeLayout(id_bodega, layout) {
  const ancho = Number(layout.ancho) || 0;
  const largo = Number(layout.largo) || 0;
  if (!ancho || !largo) return;

  let mapa = layout.mapa_json;
  if (typeof mapa === "string") {
    try {
      mapa = JSON.parse(mapa);
    } catch (e) {
      console.error("[regenUbicacionesDesdeLayout] error parse JSON", e);
      return;
    }
  }

  await q("DELETE FROM bodega_ubicaciones WHERE id_bodega = ?", [id_bodega]);

  const totalCeldas = ancho * largo;

  for (let index = 0; index < totalCeldas; index++) {
    const estado = mapa[index] ?? mapa[String(index)] ?? "D";

    // Saltar bloqueadas: B = bloqueada, O = ocupada fija
    if (estado === "B" || estado === "O") continue;

    const x = index % ancho;
    const y = Math.floor(index / ancho);

    await q(
      `
      INSERT INTO bodega_ubicaciones
        (id_bodega, nombre, descripcion, pos_x, pos_y, pos_z,
         ancho, largo, alto, activo, fecha_creacion, fecha_actualizacion)
      VALUES
        (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(), NOW())
    `,
      [id_bodega, `C-${x}-${y}`, `Celda (${x},${y})`, x, y, 0, 1, 1, 1]
    );
  }
}

/* =========================================================================
 *  PASO 3: placements por unidad dentro de la celda (expandUnits=1)
 * ========================================================================= */

function buildUnitPlacements({ qty, fit, celdaDims }) {
  const n = Number(qty) || 0;
  if (!n) return [];

  // Si no hay celda estándar, apilado simple vertical
  if (!celdaDims || !fit || !Number.isFinite(fit.perLayer) || fit.perLayer <= 0) {
    const w = Number(fit?.width) || 0;
    const l = Number(fit?.length) || 0;
    const h = Number(fit?.height) || 0;

    const placements = [];
    for (let i = 0; i < n; i++) {
      placements.push({ x: 0, y: i * h, z: 0, w, l, h });
    }
    return placements;
  }

  const Wc = Number(celdaDims.width) || 0;
  const Lc = Number(celdaDims.length) || 0;

  const perRow = Math.max(1, Number(fit.perRow) || 1);
  const perCol = Math.max(1, Number(fit.perCol) || 1);
  const perLayer = Math.max(1, Number(fit.perLayer) || perRow * perCol);

  const w = Number(fit.width) || 0;
  const l = Number(fit.length) || 0;
  const h = Number(fit.height) || 0;

  // centrar dentro de la celda
  const usedX = perRow * w;
  const usedZ = perCol * l;
  const startX = Math.max(0, (Wc - usedX) / 2);
  const startZ = Math.max(0, (Lc - usedZ) / 2);

  const cap = Math.min(n, Number(fit.maxUnits) || n);

  const placements = [];
  for (let i = 0; i < cap; i++) {
    const layer = Math.floor(i / perLayer);
    const within = i % perLayer;

    const rx = within % perRow; // x
    const rz = Math.floor(within / perRow); // z

    const x = startX + rx * w;
    const z = startZ + rz * l;
    const y = layer * h;

    placements.push({ x, y, z, w, l, h });
  }

  return placements;
}

/* =========================================================================
 *  HELPER: asignar items automáticamente
 * ========================================================================= */

async function asignarItemAuto(id_bodega, id_item) {
  const bodegaRow = await getBodegaConLayout(id_bodega);
  const celdaDims = calcularCeldaEstandar(bodegaRow);
  const itemDims = await getItemDimensiones(id_item);

  const fit = calcularMejorOrientacionItem(itemDims, celdaDims);

  if (!fit) {
    const err = new Error(
      `ITEM_TOO_BIG_FOR_CELL: El ítem "${itemDims.nombre}" no cabe en ninguna orientación dentro de una celda estándar.`
    );
    err.code = "ITEM_TOO_BIG_FOR_CELL";
    throw err;
  }

  const maxUnits = fit.maxUnits;

  // 1) apilar donde ya existe este item y no esté lleno
  let id_ubicacion = null;

  const pilas = await q(
    `
    SELECT ui.id_ubicacion, ui.qty
    FROM bodega_ubicacion_items ui
    INNER JOIN bodega_ubicaciones u
      ON u.id_ubicacion = ui.id_ubicacion
    WHERE u.id_bodega = ?
      AND u.activo = 1
      AND ui.id_item = ?
    ORDER BY ui.id_ubicacion ASC
    `,
    [id_bodega, id_item]
  );

  for (const p of pilas) {
    const qty = Number(p.qty) || 0;
    if (qty < maxUnits) {
      id_ubicacion = p.id_ubicacion;
      break;
    }
  }

  // 2) si no hay pila con espacio, buscar ubicación vacía
  if (!id_ubicacion) {
    const libres = await q(
      `
      SELECT u.id_ubicacion
      FROM bodega_ubicaciones u
      LEFT JOIN bodega_ubicacion_items ui
        ON ui.id_ubicacion = u.id_ubicacion
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

    id_ubicacion = libres[0].id_ubicacion;
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

/* =========================================================================
 *  PASO 4: COMPACTACIÓN “TETRIS GLOBAL” + PRIORIDAD (CORREGIDO)
 * ========================================================================= */

async function compactarBodegaTetris(id_bodega, opts = {}) {
  const dryRun = !!opts.dryRun;

  const bodegaRow = await getBodegaConLayout(id_bodega);
  const celdaDims = calcularCeldaEstandar(bodegaRow);

  if (!celdaDims) {
    const err = new Error("BODEGA_LAYOUT_REQUIRED");
    err.code = "BODEGA_LAYOUT_REQUIRED";
    throw err;
  }

  // 1) traer ubicaciones (incluye vacías)
  const rows = await q(
    `
    SELECT
      u.id_ubicacion,
      u.pos_x, u.pos_y,
      u.activo,

      ui.id_item,
      ui.qty,
      COALESCE(ui.movible, 1) AS movible,

      i.nombre AS item_nombre,
      i.ancho  AS item_ancho,
      i.largo  AS item_largo,
      i.alto   AS item_alto,

      bi.prioridad AS item_prioridad
    FROM bodega_ubicaciones u
    LEFT JOIN bodega_ubicacion_items ui ON ui.id_ubicacion = u.id_ubicacion
    LEFT JOIN items i ON i.id_item = ui.id_item
    LEFT JOIN bodega_items bi ON bi.id_bodega = u.id_bodega AND bi.id_item = ui.id_item
    WHERE u.id_bodega = ?
      AND u.activo = 1
    ORDER BY u.pos_y ASC, u.pos_x ASC, u.id_ubicacion ASC
    `,
    [id_bodega]
  );

  // 2) map por ubicación
  const ubicMap = new Map();
  for (const r of rows) {
    const idu = Number(r.id_ubicacion);
    if (!ubicMap.has(idu)) {
      ubicMap.set(idu, {
        id_ubicacion: idu,
        pos_x: Number(r.pos_x) || 0,
        pos_y: Number(r.pos_y) || 0,
        locked: false,
        items: [],
      });
    }

    if (r.id_item != null) {
      ubicMap.get(idu).items.push({
        id_item: Number(r.id_item),
        qty: Number(r.qty) || 0,
        movible: Number(r.movible) || 0,
        prioridad: r.item_prioridad != null ? Number(r.item_prioridad) : 0,
        nombre: r.item_nombre || "",
        ancho: Number(r.item_ancho) || 0,
        largo: Number(r.item_largo) || 0,
        alto: Number(r.item_alto) || 0,
      });
    }
  }

  const ubicaciones = Array.from(ubicMap.values());

  // 3) lock: si contiene algo no-movible, o mezcla de distintos items
  for (const u of ubicaciones) {
    const ids = new Set(u.items.filter((x) => x.qty > 0).map((x) => x.id_item));
    const hasNonMov = u.items.some((x) => x.qty > 0 && Number(x.movible) !== 1); // ✅ endurecido
    const isMixed = ids.size > 1;

    if (hasNonMov || isMixed) u.locked = true;
  }

  // 4) stock total por item (y prioridad)
  const stockTotal = await q(
    `
    SELECT id_item, qty, COALESCE(prioridad,0) AS prioridad
    FROM bodega_items
    WHERE id_bodega = ?
    `,
    [id_bodega]
  );

  // 5) dims REALES desde tabla items para todos
  const itemIds = stockTotal.map((r) => Number(r.id_item)).filter(Boolean);
  let dimsRows = [];
  if (itemIds.length) {
    dimsRows = await q(
      `
      SELECT id_item, nombre, ancho, largo, alto
      FROM items
      WHERE id_item IN (${itemIds.map(() => "?").join(",")})
      `,
      itemIds
    );
  }

  const dimsByItem = new Map();
  for (const r of dimsRows) {
    dimsByItem.set(Number(r.id_item), {
      nombre: r.nombre || "",
      ancho: Number(r.ancho) || 0,
      largo: Number(r.largo) || 0,
      alto: Number(r.alto) || 0,
    });
  }

  // 6) qty fija por item (locked)
  const fixedByItem = new Map();
  for (const u of ubicaciones) {
    if (!u.locked) continue;
    for (const it of u.items) {
      if (!it.qty) continue;
      fixedByItem.set(it.id_item, (fixedByItem.get(it.id_item) || 0) + it.qty);
    }
  }

  // 7) armar lista movible a compactar
  const itemsToPack = stockTotal
    .map((r) => {
      const id_item = Number(r.id_item);
      const total = Number(r.qty) || 0;
      const fixed = fixedByItem.get(id_item) || 0;
      const movable = Math.max(0, total - fixed);

      const dims = dimsByItem.get(id_item);
      if (!dims || !dims.ancho || !dims.largo || !dims.alto) {
        const err = new Error(
          `ITEM_DIMS_MISSING: faltan dims reales para item ${id_item}`
        );
        err.code = "ITEM_DIMS_MISSING";
        throw err;
      }

      const itemDims = { width: dims.ancho, length: dims.largo, height: dims.alto };
      const fit = calcularMejorOrientacionItem(itemDims, celdaDims);

      if (!fit) {
        const err = new Error(
          `ITEM_TOO_BIG_FOR_CELL: item ${id_item} no cabe en celda estándar`
        );
        err.code = "ITEM_TOO_BIG_FOR_CELL";
        throw err;
      }

      const capacity = Math.max(1, Number(fit.maxUnits) || 1);
      const volume = itemDims.width * itemDims.length * itemDims.height;

      return {
        id_item,
        prioridad: Number(r.prioridad) || 0,
        total,
        fixed,
        movable,
        capacity,
        volume,
      };
    })
    .filter((x) => x.movable > 0);

  itemsToPack.sort((a, b) => (b.prioridad - a.prioridad) || (b.volume - a.volume));

  // 8) celdas disponibles (no locked) en orden “frente”
  const freeCells = ubicaciones
    .filter((u) => !u.locked)
    .sort(
      (a, b) =>
        a.pos_y - b.pos_y ||
        a.pos_x - b.pos_x ||
        a.id_ubicacion - b.id_ubicacion
    )
    .map((u) => u.id_ubicacion);

  // 9) construir target placements (1 item por celda)
  const target = new Map(); // cellId -> { id_item, qty }
  let cellPtr = 0;

  for (const it of itemsToPack) {
    let remaining = it.movable;

    while (remaining > 0) {
      if (cellPtr >= freeCells.length) {
        const err = new Error("NO_SPACE_TO_COMPACT");
        err.code = "NO_SPACE_TO_COMPACT";
        throw err;
      }
      const cellId = freeCells[cellPtr++];
      const put = Math.min(it.capacity, remaining);
      target.set(cellId, { id_item: it.id_item, qty: put });
      remaining -= put;
    }
  }

  // 10) sources: unidades movibles actuales (solo no-locked)
  // ordenar sources desde “más atrás” por pos_y desc, pos_x desc
  const posByCell = new Map();
  for (const u of ubicaciones) posByCell.set(u.id_ubicacion, { x: u.pos_x, y: u.pos_y });

  const sourcesByItem = new Map();
  for (const u of ubicaciones) {
    if (u.locked) continue;
    for (const it of u.items) {
      if (!it.qty || it.movible !== 1) continue;
      const arr = sourcesByItem.get(it.id_item) || [];
      arr.push({ cellId: u.id_ubicacion, qty: it.qty });
      sourcesByItem.set(it.id_item, arr);
    }
  }

  for (const [idItem, arr] of sourcesByItem.entries()) {
    arr.sort((a, b) => {
      const pa = posByCell.get(a.cellId) || { x: 0, y: 0 };
      const pb = posByCell.get(b.cellId) || { x: 0, y: 0 };
      return pb.y - pa.y || pb.x - pa.x || b.cellId - a.cellId;
    });
    sourcesByItem.set(idItem, arr);
  }

  function takeFromSources(itemId, needQty, preferredCellId) {
    const src = sourcesByItem.get(itemId) || [];
    const taken = [];
    let remaining = needQty;

    // 1) ✅ Primero toma desde la misma celda destino (evita mover por mover)
    if (preferredCellId != null && remaining > 0) {
      const idx = src.findIndex((s) => s.cellId === preferredCellId);
      if (idx !== -1) {
        const s = src[idx];
        const take = Math.min(Number(s.qty) || 0, remaining);

        if (take > 0) {
          taken.push({ from: s.cellId, qty: take });
          s.qty -= take;
          remaining -= take;

          if (s.qty <= 0) src.splice(idx, 1);
        }
      }
    }

    // 2) Luego toma desde “atrás”
    while (remaining > 0 && src.length) {
      const s = src[0];

      const take = Math.min(Number(s.qty) || 0, remaining);
      if (take <= 0) {
        src.shift();
        continue;
      }

      taken.push({ from: s.cellId, qty: take });
      s.qty -= take;
      remaining -= take;

      if (s.qty <= 0) src.shift();
    }

    sourcesByItem.set(itemId, src);
    return { taken, remaining };
  }

  const movimientos = [];

  for (const [toCell, t] of target.entries()) {
    const { taken, remaining } = takeFromSources(t.id_item, t.qty, toCell);

    if (remaining > 0) {
      const err = new Error(
        `INCONSISTENT_STOCK: faltan ${remaining} unidades item ${t.id_item}`
      );
      err.code = "INCONSISTENT_STOCK";
      throw err;
    }

    for (const x of taken) {
      if (x.from === toCell) continue; // si viene de la misma celda, no hay movimiento
      movimientos.push({
        id_item: t.id_item,
        from_ubicacion: x.from,
        to_ubicacion: toCell,
        qty: x.qty,
      });
    }
  }

  if (dryRun) {
    return { movimientos, mensaje: `Dry-run OK. Movimientos: ${movimientos.length}` };
  }

  // ✅ aplicar sin transacción
  for (const m of movimientos) {
    await q(
      `UPDATE bodega_ubicacion_items
       SET qty = qty - ?, fecha_actualizacion = NOW()
       WHERE id_ubicacion = ? AND id_item = ? AND movible = 1`,
      [m.qty, m.from_ubicacion, m.id_item]
    );

    await q(
      `DELETE FROM bodega_ubicacion_items
       WHERE id_ubicacion = ? AND id_item = ? AND qty <= 0`,
      [m.from_ubicacion, m.id_item]
    );

    await q(
      `INSERT INTO bodega_ubicacion_items
        (id_ubicacion, id_item, qty, movible, fecha_creacion, fecha_actualizacion)
       VALUES (?, ?, ?, 1, NOW(), NOW())
       ON DUPLICATE KEY UPDATE
         qty = qty + VALUES(qty),
         movible = 1,
         fecha_actualizacion = NOW()`,
      [m.to_ubicacion, m.id_item, m.qty]
    );
  }

  return { movimientos, mensaje: `Compactación OK. Movimientos: ${movimientos.length}` };
}

router.use(verificarToken)

/**
 * POST /api/bodegas/:id/compactar-tetris
 * Body opcional: { "dryRun": true }
 */
router.post("/:id/compactar-tetris", async (req, res) => {
  const id_bodega = Number(req.params.id) || 0;
  if (!id_bodega) {
    return res.status(400).json({ error: true, status: 400, body: "ID de bodega inválido" });
  }

  try {
    const dryRun = !!req.body?.dryRun;
    const result = await compactarBodegaTetris(id_bodega, { dryRun });
    return res.json({ error: false, status: 200, body: result });
  } catch (err) {
    console.log("[POST /api/bodegas/:id/compactar-tetris] ERROR:", err);

    if (err.code === "BODEGA_LAYOUT_REQUIRED") {
      return res.status(409).json({
        error: true,
        status: 409,
        body: "Esta bodega necesita layout para compactar.",
      });
    }
    if (err.code === "ITEM_DIMS_MISSING") {
      return res.status(409).json({ error: true, status: 409, body: err.message });
    }
    if (err.code === "ITEM_TOO_BIG_FOR_CELL") {
      return res.status(409).json({ error: true, status: 409, body: err.message });
    }
    if (err.code === "NO_SPACE_TO_COMPACT") {
      return res.status(409).json({
        error: true,
        status: 409,
        body: "No hay suficientes celdas disponibles para compactar.",
      });
    }
    if (err.code === "INCONSISTENT_STOCK") {
      return res.status(409).json({ error: true, status: 409, body: err.message });
    }

    return res
      .status(500)
      .json({ error: true, status: 500, body: "Error compactando bodega (tetris)" });
  }
});

/* =========================================================================
 *  ENDPOINTS BÁSICOS DE BODEGAS
 * ========================================================================= */

router.get("/", async (req, res) => {
  try {
    const rows = await q(
      `SELECT
         b.id_bodega,
         b.nombre,
         b.ciudad,
         b.direccion,
         b.ancho,
         b.largo,
         b.alto,
         b.id_usuario,
         b.activo              AS is_active,
         b.fecha_eliminacion   AS deleted_at,
         b.fecha_creacion      AS created_at,
         b.fecha_actualizacion AS updated_at,
         l.ancho               AS layout_ancho,
         l.largo               AS layout_largo,
         l.mapa_json            AS layout_mapa_json,
         c.nombre              AS nombre_ciudad
       FROM bodegas b
       LEFT JOIN bodega_layouts l ON l.id_bodega = b.id_bodega
       INNER JOIN ciudades c ON c.id_ciudad = b.ciudad
       WHERE b.fecha_eliminacion IS NULL
       ORDER BY b.id_bodega ASC`
    );

    res.json({ error: false, status: 200, body: rows });
  } catch (err) {
    console.log("[GET /api/bodegas] ERROR:", err);
    res.status(500).json({ error: true, status: 500, body: "Error obteniendo bodegas" });
  }
});

router.get("/ciudades", async (req, res) => {
    try {
      const sql = `SELECT id_ciudad, nombre
      FROM ciudades ORDER BY id_ciudad`;
      const rows = await q(sql);
      res.json({ ciudades: rows });
    } catch (error) {
      console.log(error)
      res.status(400).json({
        error: true, body: "Errpr obteniendo las ciudades"
      })
    }
});

router.get("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    const rows = await q(
      `SELECT
         b.id_bodega,
         b.nombre,
         b.ciudad,
         b.direccion,
         b.ancho,
         b.largo,
         b.alto,
         b.id_usuario,
         b.activo              AS is_active,
         b.fecha_eliminacion   AS deleted_at,
         b.fecha_creacion      AS created_at,
         b.fecha_actualizacion AS updated_at,
         l.ancho               AS layout_ancho,
         l.largo               AS layout_largo,
         l.mapa_json            AS layout_mapa_json
       FROM bodegas b
       LEFT JOIN bodega_layouts l
         ON l.id_bodega = b.id_bodega
       WHERE b.id_bodega = ?
         AND b.fecha_eliminacion IS NULL
       LIMIT 1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({ error: true, status: 404, body: "Bodega no encontrada" });
    }

    res.json({ error: false, status: 200, body: rows[0] });
  } catch (err) {
    console.log("[GET /api/bodegas/:id] ERROR:", err);
    res.status(500).json({ error: true, status: 500, body: "Error obteniendo bodega" });
  }
});

router.post("/", async (req, res) => {
  try {
    const { nombre, ciudad, direccion, ancho, largo, alto, id_usuario, activo = 1, layout } =
      req.body || {};

    if (!nombre || !direccion) {
      return res.status(400).json({
        error: true,
        status: 400,
        body: "nombre y direccion son obligatorios",
      });
    }

    const result = await q(
      `INSERT INTO bodegas
         (nombre, ciudad, direccion, ancho, largo, alto, id_usuario, activo, fecha_creacion, fecha_actualizacion)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
      [
        nombre,
        ciudad || null,
        direccion,
        ancho || 0,
        largo || 0,
        alto || 0,
        id_usuario || null,
        activo ? 1 : 0,
      ]
    );

    const newId = result.insertId;
    await upsertLayoutForBodega(newId, layout);

    res.status(201).json({ error: false, status: 201, body: { id_bodega: newId } });
  } catch (err) {
    console.log("[POST /api/bodegas] ERROR:", err);
    res.status(500).json({ error: true, status: 500, body: "Error creando bodega" });
  }
});

router.put("/:id", async (req, res) => {
  try {
    const { id } = req.params;
    const { nombre, ciudad, direccion, ancho, largo, alto, id_usuario, is_active, activo, layout } =
      req.body || {};

    const fields = [];
    const params = [];

    if (nombre !== undefined) { fields.push("nombre = ?"); params.push(nombre); }
    if (ciudad !== undefined) { fields.push("ciudad = ?"); params.push(ciudad); }
    if (direccion !== undefined) { fields.push("direccion = ?"); params.push(direccion); }
    if (ancho !== undefined) { fields.push("ancho = ?"); params.push(ancho); }
    if (largo !== undefined) { fields.push("largo = ?"); params.push(largo); }
    if (alto !== undefined) { fields.push("alto = ?"); params.push(alto); }
    if (id_usuario !== undefined) { fields.push("id_usuario = ?"); params.push(id_usuario); }

    const activeValue =
      typeof is_active === "number" || typeof is_active === "boolean"
        ? (is_active ? 1 : 0)
        : typeof activo === "number" || typeof activo === "boolean"
        ? (activo ? 1 : 0)
        : undefined;

    if (activeValue !== undefined) {
      fields.push("activo = ?");
      params.push(activeValue);
    }

    fields.push("fecha_actualizacion = NOW()");

    const sql = `UPDATE bodegas SET ${fields.join(", ")} WHERE id_bodega = ?`;
    params.push(id);

    await q(sql, params);
    await upsertLayoutForBodega(Number(id), layout);

    res.json({ error: false, status: 200, body: { id_bodega: id } });
  } catch (err) {
    console.log("[PUT /api/bodegas/:id] ERROR:", err);
    res.status(500).json({ error: true, status: 500, body: "Error actualizando bodega" });
  }
});

router.delete("/:id", async (req, res) => {
  try {
    const { id } = req.params;

    await q(
      `UPDATE bodegas
       SET activo = 0,
           fecha_eliminacion = NOW(),
           fecha_actualizacion = NOW()
       WHERE id_bodega = ?`,
      [id]
    );

    res.json({ error: false, status: 200, body: { id_bodega: id } });
  } catch (err) {
    console.log("[DELETE /api/bodegas/:id] ERROR:", err);
    res.status(500).json({ error: true, status: 500, body: "Error eliminando bodega" });
  }
});

/* =========================================================================
 *  ASIGNAR ITEMS AUTOMÁTICAMENTE
 * ========================================================================= */

router.post("/:id/items/auto", async (req, res) => {
  const id_bodega = Number(req.params.id);
  const { id_item } = req.body || {};

  if (!id_bodega || !id_item) {
    return res.status(400).json({
      error: true,
      status: 400,
      body: "id_bodega o id_item faltante",
    });
  }

  try {
    const result = await asignarItemAuto(id_bodega, Number(id_item));
    res.status(201).json({ error: false, status: 201, body: result });
  } catch (err) {
    console.log("[POST /api/bodegas/:id/items/auto] ERROR:", err);

    if (err.code === "NO_FREE_LOCATION") {
      return res.status(409).json({
        error: true,
        status: 409,
        body: "No hay ubicaciones disponibles en esta bodega",
      });
    }

    if (err.code === "ITEM_TOO_BIG_FOR_CELL") {
      return res.status(409).json({
        error: true,
        status: 409,
        body: err.message || "El ítem no cabe en una posición estándar de esta bodega",
      });
    }

    res.status(500).json({ error: true, status: 500, body: "Error asignando item a ubicación" });
  }
});

/* =========================================================================
 *  OPTIMIZAR / RECUBICAR
 * ========================================================================= */

router.post("/:id/optimizar-simple", async (req, res) => {
  const id_bodega = Number(req.params.id) || 0;

  if (!id_bodega) {
    return res.status(400).json({ error: true, status: 400, body: "ID de bodega inválido" });
  }

  try {
    const result = await optimizarBodegaSimple(id_bodega);
    res.json({ error: false, status: 200, body: result });
  } catch (err) {
    console.log("[POST /api/bodegas/:id/optimizar-simple] ERROR:", err);
    res.status(500).json({
      error: true,
      status: 500,
      body: "Error ejecutando la optimización de cubicaje",
    });
  }
});

router.post("/:id/recubicar-prioridad", async (req, res) => {
  const id_bodega = Number(req.params.id) || 0;
  const { items } = req.body || {};

  if (!id_bodega) {
    return res.status(400).json({ error: true, status: 400, body: "ID de bodega inválido" });
  }

  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({
      error: true,
      status: 400,
      body: 'Debes enviar un array "items" con id_item y prioridad',
    });
  }

  try {
    const result = await recubicarBodegaPorPrioridad(id_bodega, items);
    res.json({ error: false, status: 200, body: result });
  } catch (err) {
    console.log("[POST /api/bodegas/:id/recubicar-prioridad] ERROR:", err);

    if (
      err.code === "BODEGA_ID_INVALID" ||
      err.code === "ITEMS_LIST_EMPTY" ||
      err.code === "ITEMS_LIST_INVALID"
    ) {
      return res.status(400).json({ error: true, status: 400, body: err.message });
    }

    res.status(500).json({
      error: true,
      status: 500,
      body: "Error ejecutando recubicaje por prioridad",
    });
  }
});

/* =========================================================================
 *  GET /api/bodegas/:id/ubicaciones  
 * ========================================================================= */

router.get("/:id/ubicaciones", async (req, res) => {
  const id_bodega = Number(req.params.id) || 0;
  const expandUnits = String(req.query.expandUnits || "").trim() === "1";

  if (!id_bodega) {
    return res.status(400).json({ error: true, status: 400, body: "ID de bodega inválido" });
  }

  try {
    let celdaDims = null;
    if (expandUnits) {
      const bodegaRow = await getBodegaConLayout(id_bodega);
      celdaDims = calcularCeldaEstandar(bodegaRow);
    }

    // msApiCubicaje-master/src/api/components/bodega/network.js

// 1) traer ubicaciones (incluye vacías)
const rows = await q(
  `
  SELECT
    u.id_ubicacion,
    u.pos_x, u.pos_y,
    u.activo,

    ui.id_item,
    ui.qty,
    COALESCE(ui.movible, 1) AS movible,

    i.nombre AS item_nombre,
    i.ancho  AS item_ancho,
    i.largo  AS item_largo,
    i.alto   AS item_alto,

    bi.prioridad AS item_prioridad
  FROM bodega_ubicaciones u
  LEFT JOIN bodega_ubicacion_items ui ON ui.id_ubicacion = u.id_ubicacion
  LEFT JOIN items i ON i.id_item = ui.id_item
  LEFT JOIN bodega_items bi ON bi.id_bodega = u.id_bodega AND bi.id_item = ui.id_item
  WHERE u.id_bodega = ?
    AND u.activo = 1
  ORDER BY u.pos_y ASC, u.pos_x ASC, u.id_ubicacion ASC
  `,
  [id_bodega]
);


    const map = new Map();

    for (const r of rows) {
      const key = String(r.id_ubicacion);

      if (!map.has(key)) {
        map.set(key, {
          id_ubicacion: Number(r.id_ubicacion),
          nombre: r.ubic_nombre,
          descripcion: r.ubic_descripcion,
          pos_x: Number(r.pos_x) || 0,
          pos_y: Number(r.pos_y) || 0,
          pos_z: Number(r.pos_z) || 0,
          ancho: Number(r.ubic_ancho) || 1,
          largo: Number(r.ubic_largo) || 1,
          alto: Number(r.ubic_alto) || 1,
          items: [],
        });
      }

      if (r.id_item != null) {
        const item = {
          id_item: Number(r.id_item),
          nombre: r.item_nombre,
          qty: Number(r.qty) || 0,
          movible: Number(r.movible) || 0,
          ancho: Number(r.item_ancho) || 0,
          largo: Number(r.item_largo) || 0,
          alto: Number(r.item_alto) || 0,
          id_categoria: r.item_categoria != null ? Number(r.item_categoria) : null,
          prioridad: r.item_prioridad != null ? Number(r.item_prioridad) : 0,
        };

        if (expandUnits) {
          const itemDims = { width: item.ancho, length: item.largo, height: item.alto };
          const fit = calcularMejorOrientacionItem(itemDims, celdaDims);

          item.fit = fit
            ? {
                width: fit.width,
                length: fit.length,
                height: fit.height,
                perRow: fit.perRow,
                perCol: fit.perCol,
                perLayer: fit.perLayer,
                layers: fit.layers,
                maxUnits: fit.maxUnits,
              }
            : null;

          item.placements = fit
            ? buildUnitPlacements({ qty: item.qty, fit, celdaDims })
            : [];
        }

        map.get(key).items.push(item);
      }
    }

    for (const u of map.values()) {
      u.items.sort((a, b) => (b.prioridad || 0) - (a.prioridad || 0));
    }

    return res.json({ error: false, status: 200, body: Array.from(map.values()) });
  } catch (err) {
    console.log("[GET /api/bodegas/:id/ubicaciones] ERROR:", err);
    return res.status(500).json({
      error: true,
      status: 500,
      body: "Error obteniendo ubicaciones de la bodega",
    });
  }
});

module.exports = router;
