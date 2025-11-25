// msApiCubicaje-master/src/api/components/bodega/network.js
const express = require('express');
const router = express.Router();
const {
  optimizarBodegaSimple,
  recubicarBodegaPorPrioridad,
} = require('./algoritmoCubicaje');

const db = require('../../../store'); // 👈 tu módulo original



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
    const err = new Error('BODEGA_NOT_FOUND');
    err.code = 'BODEGA_NOT_FOUND';
    throw err;
  }

  return rows[0];
}

// A partir de bodega + layout, calcula dimensiones de una celda física
function calcularCeldaEstandar(bodegaRow) {
  const bAncho = Number(bodegaRow.b_ancho) || 0;
  const bLargo = Number(bodegaRow.b_largo) || 0;
  const bAlto  = Number(bodegaRow.b_alto)  || 0;

  const gAncho = Number(bodegaRow.g_ancho) || 0;
  const gLargo = Number(bodegaRow.g_largo) || 0;

  if (!bAncho || !bLargo || !bAlto || !gAncho || !gLargo) {
    // No hay datos suficientes para calcular celda
    return null;
  }

  return {
    width:  bAncho / gAncho,  // ancho físico de una celda
    length: bLargo / gLargo,  // largo físico de una celda
    height: bAlto,            // altura útil de la celda (simplificación)
  };
}

// Obtiene dimensiones de un ítem
async function getItemDimensiones(id_item) {
  const rows = await q(
    `
    SELECT
      id_item,
      nombre,
      ancho,
      largo,
      alto
    FROM items
    WHERE id_item = ?
    LIMIT 1
  `,
    [id_item]
  );

  if (!rows.length) {
    const err = new Error('ITEM_NOT_FOUND');
    err.code = 'ITEM_NOT_FOUND';
    throw err;
  }

  const it = rows[0];
  return {
    id_item: it.id_item,
    nombre: it.nombre,
    width:  Number(it.ancho) || 0,
    length: Number(it.largo) || 0,
    height: Number(it.alto)  || 0,
  };
}





/**
 * Calcula la mejor orientación 3D del ítem dentro de la celda estándar.
 * Si no cabe en ninguna orientación, devuelve null.
 * Si cabe, devuelve { width, length, height, maxStack }.
 */
function calcularMejorOrientacionItem(itemDims, celdaDims) {
  // Si la bodega no tiene layout/celda, no bloqueamos y no limitamos apilamiento.
  if (!celdaDims) {
    return {
      width: itemDims.width,
      length: itemDims.length,
      height: itemDims.height,
      maxStack: Number.MAX_SAFE_INTEGER, // sin límite práctico
    };
  }

  const { width: Wc, length: Lc, height: Hc } = celdaDims;
  const dims = [
    Number(itemDims.width) || 0,
    Number(itemDims.length) || 0,
    Number(itemDims.height) || 0,
  ];

  // Si falta alguna dimensión, no podemos razonar bien -> no bloqueamos.
  if (!dims[0] || !dims[1] || !dims[2]) {
    return {
      width: itemDims.width,
      length: itemDims.length,
      height: itemDims.height,
      maxStack: Number.MAX_SAFE_INTEGER,
    };
  }

  // 6 permutaciones de (ancho, alto, largo)
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
    const w = dims[iW]; // ancho en esta orientación
    const h = dims[iH]; // alto  en esta orientación
    const l = dims[iL]; // largo en esta orientación

    // ¿Cabe esta orientación dentro de la celda?
    if (w <= Wc && l <= Lc && h <= Hc) {
      const maxStack = Math.max(1, Math.floor(Hc / h));
      const baseArea = w * l;

      if (
        !best ||
        maxStack > best.maxStack || // más unidades apiladas
        (maxStack === best.maxStack && baseArea < best.baseArea) // misma altura, base más pequeña
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





// Verifica si el ítem cabe en una celda estándar
function itemCabeEnCelda(itemDims, celdaDims) {
  if (!celdaDims) return true; // si no tenemos layout, no bloqueamos nada

  const { width: Wi, length: Li, height: Hi } = itemDims;
  const { width: Wc, length: Lc, height: Hc } = celdaDims;

  // Si alguna dimensión del ítem es 0, lo consideramos inválido para
  // chequeo físico, pero no bloqueamos (puedes endurecer esta regla si quieres)
  if (!Wi || !Li || !Hi) return true;

  return Wi <= Wc && Li <= Lc && Hi <= Hc;
}


// Guarda / actualiza el layout de una bodega y regenera ubicaciones
async function upsertLayoutForBodega(id_bodega, layout) {
  if (!layout || !layout.mapa_json) {
    console.log('[upsertLayoutForBodega] sin layout, no se guarda nada');
    return;
  }

  const anchoLayout = Number(layout.ancho) || 0;
  const largoLayout = Number(layout.largo) || 0;

  // Nos aseguramos de mandar un JSON válido a MySQL
  const mapaJsonString =
    typeof layout.mapa_json === 'string'
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

  try {
    await q(sql, [id_bodega, anchoLayout, largoLayout, mapaJsonString]);
    console.log('[upsertLayoutForBodega] layout guardado OK para bodega', id_bodega);
  } catch (err) {
    console.error('[upsertLayoutForBodega] ERROR SQL:', err);
    throw err; // esto hará que el POST/PUT devuelva 500 si algo falla
  }

  // Después de guardar el layout, regeneramos las ubicaciones disponibles
  try {
    await regenUbicacionesDesdeLayout(id_bodega, {
      ancho: anchoLayout,
      largo: largoLayout,
      mapa_json: layout.mapa_json,
    });
    console.log('[upsertLayoutForBodega] ubicaciones regeneradas para bodega', id_bodega);
  } catch (err) {
    console.error('[upsertLayoutForBodega] ERROR regenerando ubicaciones:', err);
    // si quieres que aunque falle esto igual se considere éxito, no relanzamos el error
  }
}


// Crea bodega_ubicaciones a partir de mapa_json (solo celdas "D")
async function regenUbicacionesDesdeLayout(id_bodega, layout) {
  const ancho = Number(layout.ancho) || 0;
  const largo = Number(layout.largo) || 0;

  if (!ancho || !largo) return;

  let mapa = layout.mapa_json;
  if (typeof mapa === 'string') {
    try {
      mapa = JSON.parse(mapa);
    } catch (e) {
      console.error('[regenUbicacionesDesdeLayout] error parse JSON', e);
      return;
    }
  }

  // 1) Borrar todas las ubicaciones previas de esa bodega
  await q('DELETE FROM bodega_ubicaciones WHERE id_bodega = ?', [id_bodega]);

  const totalCeldas = ancho * largo;

// 2) Recorrer todas las celdas del grid y crear ubicaciones para "D" y "A"
// Creamos ubicación si es D (disponible) o A (altura libre). B y O se saltan.
  for (let index = 0; index < totalCeldas; index++) {
    const estado = mapa[index] ?? mapa[String(index)] ?? 'D';

    // Solo creamos ubicación si la celda es DISPONIBLE
    if (estado === 'B' || estado === 'O') continue;

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
      [
        id_bodega,
        `C-${x}-${y}`, // nombre
        `Celda (${x},${y})`,
        x, // pos_x
        y, // pos_y
        0, // pos_z
        1, // ancho celda
        1, // largo celda
        1, // alto celda
      ]
    );
  }
}

/* =========================================================================
 *  HELPER PARA ASIGNAR ITEMS SOLO A UBICACIONES LIBRES
 * ========================================================================= */

async function asignarItemAuto(id_bodega, id_item) {
  // 0) Cargar bodega + layout y dimensiones del ítem
  const bodegaRow = await getBodegaConLayout(id_bodega);
  const celdaDims = calcularCeldaEstandar(bodegaRow);
  const itemDims  = await getItemDimensiones(id_item);

  // 1) Calcular mejor orientación 3D + capacidad de apilamiento
  const fit = calcularMejorOrientacionItem(itemDims, celdaDims);

  if (!fit) {
    const err = new Error(
      `ITEM_TOO_BIG_FOR_CELL: El ítem "${itemDims.nombre}" ` +
      'no cabe en ninguna orientación dentro de una posición estándar de esta bodega.'
    );
    err.code = 'ITEM_TOO_BIG_FOR_CELL';
    throw err;
  }

  const maxStack = fit.maxStack; // unidades máximas apiladas en una celda

  // 2) Intentar apilar en ubicaciones que YA tienen este ítem y no están llenas
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
    if (qty < maxStack) {
      id_ubicacion = p.id_ubicacion;
      break;
    }
  }

  // 3) Si no encontramos pila con espacio, buscamos una ubicación vacía
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
      const err = new Error('NO_FREE_LOCATION');
      err.code = 'NO_FREE_LOCATION';
      throw err;
    }

    id_ubicacion = libres[0].id_ubicacion;
  }

  // 4) Registrar el ítem en esa ubicación (1 unidad por defecto)
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

  // 5) Mantener agregado por bodega en bodega_items
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
 *  ENDPOINTS BÁSICOS DE BODEGAS
 * ========================================================================= */

/**
 * GET /api/bodegas
 * Lista todas las bodegas (incluye layout si existe).
 */
router.get('/', async (req, res) => {
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
         b.activo             AS is_active,
         b.fecha_eliminacion  AS deleted_at,
         b.fecha_creacion     AS created_at,
         b.fecha_actualizacion AS updated_at,
         l.ancho              AS layout_ancho,
         l.largo              AS layout_largo,
         l.mapa_json          AS layout_mapa_json
       FROM bodegas b
       LEFT JOIN bodega_layouts l
         ON l.id_bodega = b.id_bodega
       WHERE b.fecha_eliminacion IS NULL
       ORDER BY b.id_bodega ASC`
    );

    console.log('[GET /api/bodegas] ->', rows.length, 'registros');
    res.json({ error: false, status: 200, body: rows });
  } catch (err) {
    console.log('[GET /api/bodegas] ERROR:', err);
    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error obteniendo bodegas',
    });
  }
});

/**
 * GET /api/bodegas/:id
 * Obtener una bodega específica (incluye layout si existe).
 */
router.get('/:id', async (req, res) => {
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
         b.activo             AS is_active,
         b.fecha_eliminacion  AS deleted_at,
         b.fecha_creacion     AS created_at,
         b.fecha_actualizacion AS updated_at,
         l.ancho              AS layout_ancho,
         l.largo              AS layout_largo,
         l.mapa_json          AS layout_mapa_json
       FROM bodegas b
       LEFT JOIN bodega_layouts l
         ON l.id_bodega = b.id_bodega
       WHERE b.id_bodega = ?
         AND b.fecha_eliminacion IS NULL
       LIMIT 1`,
      [id]
    );

    if (!rows.length) {
      return res.status(404).json({
        error: true,
        status: 404,
        message: 'Bodega no encontrada',
      });
    }

    res.json({ error: false, status: 200, body: rows[0] });
  } catch (err) {
    console.log('[GET /api/bodegas/:id] ERROR:', err);
    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error obteniendo bodega',
    });
  }
});

/**
 * POST /api/bodegas
 * Crea una nueva bodega (y opcionalmente su layout).
 */
router.post('/', async (req, res) => {
  try {
    const {
      nombre,
      ciudad,
      direccion,
      ancho,
      largo,
      alto,
      id_usuario,
      activo = 1,
      layout, // 👈 viene del frontend (layout: { ancho, largo, mapa_json })
    } = req.body || {};

    if (!nombre || !direccion) {
      return res.status(400).json({
        error: true,
        status: 400,
        message: 'nombre y direccion son obligatorios',
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

    // Guardar layout + generar ubicaciones (si viene)
    await upsertLayoutForBodega(newId, layout);

    res.status(201).json({
      error: false,
      status: 201,
      body: { id_bodega: newId },
    });
  } catch (err) {
    console.log('[POST /api/bodegas] ERROR:', err);
    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error creando bodega',
    });
  }
});

/**
 * PUT /api/bodegas/:id
 * Actualiza bodega existente (y opcionalmente su layout).
 */
router.put('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const {
      nombre,
      ciudad,
      direccion,
      ancho,
      largo,
      alto,
      id_usuario,
      is_active,
      activo,
      layout, // 👈 puede venir actualizado desde el frontend
    } = req.body || {};

    const fields = [];
    const params = [];

    if (nombre !== undefined) { fields.push('nombre = ?'); params.push(nombre); }
    if (ciudad !== undefined) { fields.push('ciudad = ?'); params.push(ciudad); }
    if (direccion !== undefined) { fields.push('direccion = ?'); params.push(direccion); }
    if (ancho !== undefined) { fields.push('ancho = ?'); params.push(ancho); }
    if (largo !== undefined) { fields.push('largo = ?'); params.push(largo); }
    if (alto !== undefined) { fields.push('alto = ?'); params.push(alto); }
    if (id_usuario !== undefined) { fields.push('id_usuario = ?'); params.push(id_usuario); }

    const activeValue =
      typeof is_active === 'number' || typeof is_active === 'boolean'
        ? (is_active ? 1 : 0)
        : typeof activo === 'number' || typeof activo === 'boolean'
        ? (activo ? 1 : 0)
        : undefined;

    if (activeValue !== undefined) {
      fields.push('activo = ?');
      params.push(activeValue);
    }

    fields.push('fecha_actualizacion = NOW()');

    const sql = `
      UPDATE bodegas
      SET ${fields.join(', ')}
      WHERE id_bodega = ?
    `;
    params.push(id);

    await q(sql, params);

    // Actualizar/crear layout + regenerar ubicaciones (si viene)
    await upsertLayoutForBodega(Number(id), layout);

    res.json({
      error: false,
      status: 200,
      body: { id_bodega: id },
    });
  } catch (err) {
    console.log('[PUT /api/bodegas/:id] ERROR:', err);
    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error actualizando bodega',
    });
  }
});

/**
 * DELETE /api/bodegas/:id
 * Soft delete: activo=0 y fecha_eliminacion.
 */
router.delete('/:id', async (req, res) => {
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

    res.json({
      error: false,
      status: 200,
      body: { id_bodega: id },
    });
  } catch (err) {
    console.log('[DELETE /api/bodegas/:id] ERROR:', err);
    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error eliminando bodega',
    });
  }
});

/* =========================================================================
 *  ENDPOINT PARA ASIGNAR ITEMS AUTOMÁTICAMENTE
 * ========================================================================= */

/**
 * POST /api/bodegas/:id/items/auto
 * Body: { id_item: number }
 * Asigna el item a una ubicación libre dentro de la bodega.
 */
router.post('/:id/items/auto', async (req, res) => {
  const id_bodega = Number(req.params.id);
  const { id_item } = req.body || {};

  if (!id_bodega || !id_item) {
    return res.status(400).json({
      error: true,
      status: 400,
      message: 'id_bodega o id_item faltante',
    });
  }

  try {
    const result = await asignarItemAuto(id_bodega, Number(id_item));

    res.status(201).json({
      error: false,
      status: 201,
      body: result, // { id_ubicacion }
    });
  } catch (err) {
    console.log('[POST /api/bodegas/:id/items/auto] ERROR:', err);

    if (err.code === 'NO_FREE_LOCATION') {
      return res.status(409).json({
        error: true,
        status: 409,
        message: 'No hay ubicaciones disponibles en esta bodega',
      });
    }

    if (err.code === 'ITEM_TOO_BIG_FOR_CELL') {
      return res.status(409).json({
        error: true,
        status: 409,
        message: err.message || 'El ítem no cabe en una posición estándar de esta bodega',
      });
    }


    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error asignando item a ubicación',
    });
  }
});



/*---------------------------------------------------*/



/**
 * POST /api/bodegas/:id/optimizar-simple
 * Ejecuta la heurística simple de cubicaje sobre una bodega.
 */
router.post('/:id/optimizar-simple', async (req, res) => {
  const id_bodega = Number(req.params.id) || 0;

  if (!id_bodega) {
    return res.status(400).json({
      error: true,
      status: 400,
      message: 'ID de bodega inválido',
    });
  }

  try {
    const result = await optimizarBodegaSimple(id_bodega);

    res.json({
      error: false,
      status: 200,
      body: result, // { movimientos: [...], mensaje: '...' }
    });
  } catch (err) {
    console.log('[POST /api/bodegas/:id/optimizar-simple] ERROR:', err);
    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error ejecutando la optimización de cubicaje',
    });
  }
});


/**
 * POST /api/bodegas/:id/recubicar-prioridad
 *
 * Body:
 * {
 *   "items": [
 *     { "id_item": 10, "prioridad": 3 },
 *     { "id_item": 5,  "prioridad": 2 },
 *     { "id_item": 7,  "prioridad": 1 }
 *   ]
 * }
 *
 * Solo mueve esos ítems (si son movibles) dentro de la bodega,
 * intentando colocar primero los de mayor prioridad en las
 * ubicaciones más "cercanas" (pos_y, pos_x pequeños).
 */
router.post('/:id/recubicar-prioridad', async (req, res) => {
  const id_bodega = Number(req.params.id) || 0;
  const { items } = req.body || {};

  if (!id_bodega) {
    return res.status(400).json({
      error: true,
      status: 400,
      message: 'ID de bodega inválido',
    });
  }

  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({
      error: true,
      status: 400,
      message: 'Debes enviar un array "items" con id_item y prioridad',
    });
  }

  try {
    const result = await recubicarBodegaPorPrioridad(id_bodega, items);

    res.json({
      error: false,
      status: 200,
      body: result, // { movimientos: [...], mensaje: '...' }
    });
  } catch (err) {
    console.log('[POST /api/bodegas/:id/recubicar-prioridad] ERROR:', err);

    if (
      err.code === 'BODEGA_ID_INVALID' ||
      err.code === 'ITEMS_LIST_EMPTY' ||
      err.code === 'ITEMS_LIST_INVALID'
    ) {
      return res.status(400).json({
        error: true,
        status: 400,
        message: err.message,
      });
    }

    res.status(500).json({
      error: true,
      status: 500,
      message: 'Error ejecutando recubicaje por prioridad',
    });
  }
});




module.exports = router;
