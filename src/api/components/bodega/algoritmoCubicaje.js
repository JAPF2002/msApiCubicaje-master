// msApiCubicaje-master/src/api/components/bodega/algoritmoCubicaje.js

// Usamos el mismo store que en network.js
const db = require('../../../store');

// Wrapper a Promesa usando db.query
function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/**
 * Heurística simple de cubicaje:
 * - Usa SOLO ubicaciones activas de la bodega (generadas desde layout D).
 * - Detecta cuáles están libres.
 * - Toma ítems movibles y los ordena por volumen (First-Fit Decreasing).
 * - Los va asignando a las primeras ubicaciones libres (First-Fit).
 *
 * Tablas usadas:
 *  - bodega_ubicaciones(id_ubicacion, id_bodega, pos_x, pos_y, activo, ...)
 *  - bodega_ubicacion_items(id_ubicacion, id_item, qty, movible, ...)
 *  - items(id_item, ancho, largo, alto, ...)
 */
async function optimizarBodegaSimple(id_bodega) {
  id_bodega = Number(id_bodega) || 0;
  if (!id_bodega) {
    throw new Error('ID de bodega inválido');
  }

  // 1) Todas las ubicaciones activas de la bodega (ordenadas por grilla)
  const ubicaciones = await q(
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
      mensaje: 'La bodega no tiene ubicaciones activas (revisa el layout).',
    };
  }

  // 2) Ítems ubicados en esa bodega (join con items para volumen)
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
    INNER JOIN bodega_ubicaciones u
      ON u.id_ubicacion = ui.id_ubicacion
    INNER JOIN items i
      ON i.id_item = ui.id_item
    WHERE u.id_bodega = ?
    `,
    [id_bodega]
  );

  // Conjunto de ubicaciones ocupadas
  const ocupadas = new Set(rowsItems.map((r) => r.id_ubicacion));

  // Lista de ubicaciones libres
  const ubicacionesLibres = ubicaciones
    .map((u) => u.id_ubicacion)
    .filter((id_u) => !ocupadas.has(id_u));

  // 3) Expandir ítems movibles por unidad (1 entrada por "caja")
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
        id_item: r.id_item,
        from_ubicacion: r.id_ubicacion,
        volumen,
      });
    }
  }

  if (!itemsMovibles.length) {
    return {
      movimientos: [],
      mensaje: 'No hay ítems movibles en esta bodega.',
    };
  }

  // 4) Ordenar ítems de mayor a menor volumen (First-Fit Decreasing)
  itemsMovibles.sort((a, b) => b.volumen - a.volumen);

  // 5) Asignar ítems a ubicaciones libres (First-Fit)
  const movimientos = [];
  let ptrUbicacion = 0;

  for (const it of itemsMovibles) {
    if (ptrUbicacion >= ubicacionesLibres.length) break; // no hay más huecos

    const destino = ubicacionesLibres[ptrUbicacion++];
    if (!destino) break;

    // Si ya estaba en esa ubicación, no lo movemos
    if (destino === it.from_ubicacion) {
      continue;
    }

    movimientos.push({
      id_item: it.id_item,
      from_ubicacion: it.from_ubicacion,
      to_ubicacion: destino,
    });

    // 5.1 Restar 1 unidad en la ubicación origen
    await q(
      `
      UPDATE bodega_ubicacion_items
      SET qty = qty - 1,
          fecha_actualizacion = NOW()
      WHERE id_ubicacion = ? AND id_item = ? AND qty > 0
      `,
      [it.from_ubicacion, it.id_item]
    );

    // 5.2 Eliminar registros con qty <= 0
    await q(
      `
      DELETE FROM bodega_ubicacion_items
      WHERE id_ubicacion = ? AND id_item = ? AND qty <= 0
      `,
      [it.from_ubicacion, it.id_item]
    );

    // 5.3 Agregar en la ubicación destino (o sumar si ya estaba)
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

  return {
    movimientos,
    mensaje: `Se procesaron ${movimientos.length} movimientos de ítems.`,
  };
}

/*--------------------------------------------------------------------------------------*/

/**
 * Recubicaje por prioridad (versión simple):
 * - Solo mueve ítems movibles indicados en `itemsPrioridad`.
 * - No toca los demás ítems.
 * - Intenta poner primero los de mayor prioridad en las ubicaciones
 *   "mejores" (pos_y, pos_x pequeños), reutilizando celdas en bucle.
 *
 * itemsPrioridad: array de objetos tipo:
 *   { id_item: number, prioridad: number }
 */
async function recubicarBodegaPorPrioridad(id_bodega, itemsPrioridad) {
  id_bodega = Number(id_bodega) || 0;
  if (!id_bodega) {
    const err = new Error('ID de bodega inválido');
    err.code = 'BODEGA_ID_INVALID';
    throw err;
  }

  if (!Array.isArray(itemsPrioridad) || !itemsPrioridad.length) {
    const err = new Error('Lista de items vacía');
    err.code = 'ITEMS_LIST_EMPTY';
    throw err;
  }

  // Mapa: id_item -> prioridad
  const prioridadPorItem = new Map();
  for (const it of itemsPrioridad) {
    const id = Number(it.id_item || it.id) || 0;
    const p  = Number(it.prioridad || 0) || 0;
    if (!id) continue;
    prioridadPorItem.set(id, p);
  }

  if (!prioridadPorItem.size) {
    const err = new Error('Ningún id_item válido en la lista');
    err.code = 'ITEMS_LIST_INVALID';
    throw err;
  }

  // 1) Todas las ubicaciones activas de la bodega (ordenadas por grilla)
  const ubicaciones = await q(
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
      mensaje: 'La bodega no tiene ubicaciones activas (revisa el layout).',
    };
  }

  // 2) Todos los ítems ubicados en esa bodega
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
    INNER JOIN bodega_ubicaciones u
      ON u.id_ubicacion = ui.id_ubicacion
    INNER JOIN items i
      ON i.id_item = ui.id_item
    WHERE u.id_bodega = ?
    `,
    [id_bodega]
  );

  if (!rowsItemsAll.length) {
    return {
      movimientos: [],
      mensaje: 'La bodega no tiene ítems registrados.',
    };
  }

  const idsPrioritarios = new Set(prioridadPorItem.keys());

  // 3) Filtrar solo ítems priorizados y movibles
  const rowsPrioritarios = [];
  for (const r of rowsItemsAll) {
    if (!idsPrioritarios.has(r.id_item)) continue;
    if (r.movible !== 1 && r.movible !== true) continue;
    rowsPrioritarios.push(r);
  }

  if (!rowsPrioritarios.length) {
    return {
      movimientos: [],
      mensaje: 'No hay ítems movibles entre los ítems priorizados.',
    };
  }

  // 4) Lista de ubicaciones destino (todas las activas, en orden)
  const ubicacionesDestino = ubicaciones.map((u) => u.id_ubicacion);
  const numDestinos = ubicacionesDestino.length;

  // 5) Expandir ítems priorizados por unidad (como en optimizarBodegaSimple)
  const itemsMovibles = [];

  for (const r of rowsPrioritarios) {
    const ancho = Number(r.ancho) || 0;
    const largo = Number(r.largo) || 0;
    const alto  = Number(r.alto)  || 0;
    const volumen = ancho * largo * alto;
    const qty = Number(r.qty) || 0;
    const prioridad = prioridadPorItem.get(r.id_item) || 0;

    for (let k = 0; k < qty; k++) {
      itemsMovibles.push({
        id_item: r.id_item,
        from_ubicacion: r.id_ubicacion,
        volumen,
        prioridad,
      });
    }
  }

  if (!itemsMovibles.length) {
    return {
      movimientos: [],
      mensaje: 'No hay unidades movibles de los ítems priorizados.',
    };
  }

  // 6) Ordenar: primero prioridad alta, luego volumen grande
  itemsMovibles.sort((a, b) => {
    if (b.prioridad !== a.prioridad) {
      return b.prioridad - a.prioridad;
    }
    return b.volumen - a.volumen;
  });

  // 7) Asignar cada unidad a ubicaciones en orden, reutilizando en bucle
  const movimientos = [];
  let idxDestino = 0;

  for (const it of itemsMovibles) {
    if (!numDestinos) break;

    const destino = ubicacionesDestino[idxDestino];
    idxDestino = (idxDestino + 1) % numDestinos;

    // Si el destino es el mismo origen, no tiene sentido mover esta unidad
    if (destino === it.from_ubicacion) {
      continue;
    }

    movimientos.push({
      id_item: it.id_item,
      from_ubicacion: it.from_ubicacion,
      to_ubicacion: destino,
      prioridad: it.prioridad,
    });

    // 7.1 Restar 1 unidad en la ubicación origen
    await q(
      `
      UPDATE bodega_ubicacion_items
      SET qty = qty - 1,
          fecha_actualizacion = NOW()
      WHERE id_ubicacion = ? AND id_item = ? AND qty > 0
      `,
      [it.from_ubicacion, it.id_item]
    );

    // 7.2 Eliminar si qty <= 0
    await q(
      `
      DELETE FROM bodega_ubicacion_items
      WHERE id_ubicacion = ? AND id_item = ? AND qty <= 0
      `,
      [it.from_ubicacion, it.id_item]
    );

    // 7.3 Sumar en la ubicación destino
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

  const msg = `Se recubicaron ${movimientos.length} unidades de ítems priorizados.`;

  return {
    movimientos,
    mensaje: msg,
  };
}










module.exports = {
  optimizarBodegaSimple,
  recubicarBodegaPorPrioridad,
};
