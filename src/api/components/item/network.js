// msApiCubicaje-master/src/api/components/item/network.js

const express = require("express");
const router = express.Router();

// Lógica de negocio de ítems
const controller = require("./controller/controller");

// Para queries directas (helpers move físico)
const db = require("../../../store");

// Servicio de auto-ubicación
const { asignarItemAuto } = require("../bodega/cubicaje.service");

// Wrapper a Promesa usando db.query (callback-style)
function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/* =========================================================================
 * Helpers para registrar movimientos
 * ========================================================================= */

async function registrarIngresoItem({ itemId, bodegaId, qty, meta = {} }) {
  const n = Number(qty || 0);
  if (!itemId || !bodegaId || n <= 0) return;

  await q(
    `INSERT INTO item_movimientos
      (id_item, id_bodega_origen, id_bodega_destino, qty, tipo, motivo, meta)
     VALUES (?, NULL, ?, ?, 'ingreso', ?, ?)`,
    [
      Number(itemId),
      Number(bodegaId),
      n,
      "Ingreso de stock (alta/guardado) desde la app",
      JSON.stringify({ source: "api/items POST", ...meta }),
    ]
  );
}

async function registrarEgresoItem({ itemId, bodegaId, qty, meta = {} }) {
  const n = Number(qty || 0);
  if (!itemId || !bodegaId || n <= 0) return;

  await q(
    `INSERT INTO item_movimientos
      (id_item, id_bodega_origen, id_bodega_destino, qty, tipo, motivo, meta)
     VALUES (?, ?, NULL, ?, 'egreso', ?, ?)`,
    [
      Number(itemId),
      Number(bodegaId),
      n,
      "Egreso de stock (salida) desde la app",
      JSON.stringify({ source: "api/items/:id/sacar", ...meta }),
    ]
  );
}

async function registrarTransferencia(itemId, fromId, toId, qty) {
  const meta = {
    source: "api/items/:id/move (ubicaciones)",
    fromBodegaId: fromId,
    toBodegaId: toId,
  };

  await q(
    `
    INSERT INTO item_movimientos
      (id_item, id_bodega_origen, id_bodega_destino, qty, tipo, motivo, meta)
    VALUES (?, ?, ?, ?, 'transferencia', ?, ?)
    `,
    [
      itemId,
      fromId,
      toId,
      qty,
      "Transferencia física (ubicaciones) entre bodegas desde la app",
      JSON.stringify(meta),
    ]
  );
}

/* =========================================================================
 * GET /api/items
 * ========================================================================= */

router.get("/", async (req, res) => {
  try {
    const all = await controller.list();

    const bodegaIdRaw = req.query.bodegaId || req.query.id_bodega;
    let body = all;

    if (bodegaIdRaw) {
      const bId = Number(bodegaIdRaw) || 0;

      body = all.filter((it) => Number(it.bodegaId || 0) === bId);

      // Adjuntar prioridad por bodega desde bodega_items
      if (bId > 0) {
        const priRows = await q(
          `SELECT id_item, prioridad FROM bodega_items WHERE id_bodega = ?`,
          [bId]
        );

        const priMap = new Map(
          priRows.map((r) => [
            Number(r.id_item),
            r.prioridad != null ? Number(r.prioridad) : 0,
          ])
        );

        body = body.map((it) => {
          const idItem = Number(it.id_item || it.id || 0);
          return { ...it, prioridad: priMap.get(idItem) ?? 0 };
        });
      }
    }

    return res.json({
      error: false,
      status: 200,
      body,
    });
  } catch (err) {
    console.log("[GET /api/items] ERROR:", err);
    return res.status(500).json({
      error: true,
      status: 500,
      body: err.message || "Error obteniendo items",
    });
  }
});

/* =========================================================================
 * GET /api/items/:id/movimientos
 * ========================================================================= */

router.get("/:id/movimientos", async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({
        error: true,
        status: 400,
        body: "ID inválido",
      });
    }

    const movimientos = await controller.getMovements(id);

    return res.json({
      error: false,
      status: 200,
      body: movimientos,
    });
  } catch (err) {
    console.log("[GET /api/items/:id/movimientos] ERROR:", err);
    return res.status(500).json({
      error: true,
      status: 500,
      body: err.message || "Error obteniendo movimientos del item",
    });
  }
});

/* =========================================================================
 * GET /api/items/:id
 * ========================================================================= */

router.get("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({
        error: true,
        status: 400,
        body: "ID inválido",
      });
    }

    const data = await controller.get(id);

    return res.json({
      error: false,
      status: 200,
      body: data,
    });
  } catch (err) {
    console.log("[GET /api/items/:id] ERROR:", err);
    return res.status(404).json({
      error: true,
      status: 404,
      body: err.message || "Ítem no encontrado",
    });
  }
});

/* =========================================================================
 * POST /api/items  (crea + auto-ubica + registra INGRESO)
 * ========================================================================= */

router.post("/", async (req, res) => {
  try {
    const raw = req.body || {};

    const bodegaId = Number(raw.bodegaId ?? raw.id_bodega ?? 0) || 0;
    const cantidad = Number(raw.cantidad ?? 0) || 0;

    // Creamos el item SIN tocar bodega_items aquí.
    const dataForCreate = {
      ...raw,
      bodegaId: null,
      id_bodega: null,
      cantidad: 0,
    };

    const result = await controller.upsert(dataForCreate, true); // { id: idItem }
    const itemId = Number(result?.id || 0);

    if (bodegaId && cantidad > 0) {
      let placed = 0;

      for (let i = 0; i < cantidad; i++) {
        try {
          await asignarItemAuto(bodegaId, itemId);
          placed++;
        } catch (e) {
          // ✅ si alcanzó a ubicar algo, registramos el ingreso parcial
          if (placed > 0) {
            await registrarIngresoItem({
              itemId,
              bodegaId,
              qty: placed,
              meta: { partial: true, requested: cantidad, placed },
            });
          }

          const msg =
            e.code === "NO_FREE_LOCATION"
              ? "No hay ubicaciones disponibles en la bodega."
              : e.code === "ITEM_TOO_BIG_FOR_CELL"
              ? e.message
              : "Error al auto-ubicar el ítem.";

          return res.status(409).json({
            error: true,
            status: 409,
            body: {
              message: msg,
              requested: cantidad,
              placed,
              remaining: Math.max(0, cantidad - placed),
              code: e.code || "AUTO_ASSIGN_FAILED",
            },
          });
        }
      }

      // ✅ si terminó bien, registramos el ingreso total
      if (placed > 0) {
        await registrarIngresoItem({
          itemId,
          bodegaId,
          qty: placed,
          meta: { requested: cantidad, placed },
        });
      }
    }

    return res.status(201).json({
      error: false,
      status: 201,
      body: { id: itemId },
    });
  } catch (err) {
    console.log("[POST /api/items] ERROR:", err);
    return res.status(400).json({
      error: true,
      status: 400,
      body: err.message || "Error creando item",
    });
  }
});

/* =========================================================================
 * PUT /api/items/:id
 * ========================================================================= */

router.put("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({
        error: true,
        status: 400,
        body: "ID inválido",
      });
    }

    const data = {
      ...(req.body || {}),
      id_item: id,
    };

    const result = await controller.upsert(data, false);

    return res.json({
      error: false,
      status: 200,
      body: result || { id },
    });
  } catch (err) {
    console.log("[PUT /api/items/:id] ERROR:", err);
    return res.status(400).json({
      error: true,
      status: 400,
      body: err.message || "Error actualizando item",
    });
  }
});

/* =========================================================================
 * DELETE /api/items/:id
 * ========================================================================= */

router.delete("/:id", async (req, res) => {
  try {
    const id = Number(req.params.id || 0);
    if (!id) {
      return res.status(400).json({
        error: true,
        status: 400,
        body: "ID inválido",
      });
    }

    await controller.remove(id);

    return res.json({
      error: false,
      status: 200,
      body: { id },
    });
  } catch (err) {
    console.log("[DELETE /api/items/:id] ERROR:", err);
    return res.status(400).json({
      error: true,
      status: 400,
      body: err.message || "Error eliminando item",
    });
  }
});

/* =========================================================================
 * Helpers para movimiento físico (ubicaciones)
 * ========================================================================= */

async function decBodegaItemsOne(id_bodega, id_item) {
  await q(
    `
    UPDATE bodega_items
    SET qty = qty - 1, fecha_actualizacion = NOW()
    WHERE id_bodega = ? AND id_item = ? AND qty > 0
    `,
    [id_bodega, id_item]
  );

  await q(
    `
    DELETE FROM bodega_items
    WHERE id_bodega = ? AND id_item = ? AND qty <= 0
    `,
    [id_bodega, id_item]
  );
}

async function takeOneUnitFromOriginMovible(id_bodega, id_item) {
  const rows = await q(
    `
    SELECT ui.id_ubicacion, ui.qty
    FROM bodega_ubicacion_items ui
    INNER JOIN bodega_ubicaciones u ON u.id_ubicacion = ui.id_ubicacion
    WHERE u.id_bodega = ?
      AND ui.id_item = ?
      AND ui.qty > 0
      AND (ui.movible = 1 OR ui.movible = true)
    ORDER BY u.pos_y ASC, u.pos_x ASC, ui.id_ubicacion ASC
    LIMIT 1
    `,
    [id_bodega, id_item]
  );

  if (!rows.length) {
    const err = new Error("NO_MOVIBLE_STOCK_IN_ORIGIN");
    err.code = "NO_MOVIBLE_STOCK_IN_ORIGIN";
    throw err;
  }

  const uid = Number(rows[0].id_ubicacion);

  await q(
    `
    UPDATE bodega_ubicacion_items
    SET qty = qty - 1, fecha_actualizacion = NOW()
    WHERE id_ubicacion = ? AND id_item = ? AND qty > 0
    `,
    [uid, id_item]
  );

  await q(
    `
    DELETE FROM bodega_ubicacion_items
    WHERE id_ubicacion = ? AND id_item = ? AND qty <= 0
    `,
    [uid, id_item]
  );

  return { from_ubicacion: uid };
}

/* =========================================================================
 * POST /api/items/:id/egreso   (alias: /sacar)
 * Saca unidades REALES desde ubicaciones + decrementa bodega_items + registra EGRESO
 * ========================================================================= */

async function egresoHandler(req, res) {
  const id_item = Number(req.params.id || 0);

  // 🔧 CAMBIA SI TU APP ENVÍA OTRO CAMPO:
  const bodegaIdRaw =
    req.body?.bodegaId ?? req.body?.id_bodega ?? req.body?.fromBodegaId ?? 0;

  const cantidadRaw = req.body?.cantidad ?? req.body?.qty ?? 0; // 🔧 si tu app manda "qty", queda soportado.

  const bodegaId = Number(bodegaIdRaw || 0);
  const qtyReq = Number(cantidadRaw || 0);

  if (!id_item || !bodegaId || qtyReq <= 0) {
    return res.status(400).json({
      error: true,
      status: 400,
      body: "Parámetros inválidos para egresar (sacar) cantidad",
    });
  }

  let moved = 0;
  const detalle = [];

  try {
    for (let i = 0; i < qtyReq; i++) {
      const taken = await takeOneUnitFromOriginMovible(bodegaId, id_item);
      await decBodegaItemsOne(bodegaId, id_item);
      moved++;
      detalle.push({ from_ubicacion: taken.from_ubicacion, qty: 1 });
    }

    if (moved > 0) {
      await registrarEgresoItem({
        itemId: id_item,
        bodegaId,
        qty: moved,
        meta: { requested: qtyReq, moved },
      });
    }

    return res.json({
      error: false,
      status: 200,
      body: {
        ok: true,
        requested: qtyReq,
        egresado: moved,
        bodegaId,
        detalle,
      },
    });
  } catch (err) {
    const noStock = err.code === "NO_MOVIBLE_STOCK_IN_ORIGIN";

    // ✅ si alcanzó a sacar algo, lo registramos igual como egreso parcial
    if (moved > 0) {
      await registrarEgresoItem({
        itemId: id_item,
        bodegaId,
        qty: moved,
        meta: { partial: true, requested: qtyReq, moved, error: err.code || err.message },
      });

      return res.status(409).json({
        error: true,
        status: 409,
        body: {
          message: noStock
            ? "Se sacó parcialmente, pero ya no queda stock movible en esa bodega."
            : "Error sacando unidades (egreso).",
          requested: qtyReq,
          egresado: moved,
          remaining: Math.max(0, qtyReq - moved),
          partial: true,
          code: err.code || "EGRESO_PARTIAL_FAIL",
          detalle,
        },
      });
    }

    return res.status(409).json({
      error: true,
      status: 409,
      body: noStock
        ? "No hay stock movible en esa bodega para sacar."
        : err.message || "Error sacando unidades (egreso)",
    });
  }
}

router.post("/:id/egreso", egresoHandler);
router.post("/:id/sacar", egresoHandler); // ✅ alias para tu botón "Sacar"

/* =========================================================================
 * POST /api/items/:id/move   (transferencia física entre bodegas)
 * ========================================================================= */

router.post("/:id/move", async (req, res) => {
  const id_item = Number(req.params.id || 0);
  const { fromBodegaId, toBodegaId, cantidad } = req.body || {};

  const fromId = Number(fromBodegaId || 0);
  const toId = Number(toBodegaId || 0);
  const qtyReq = Number(cantidad || 0);

  if (!id_item || !fromId || !toId || qtyReq <= 0) {
    return res.status(400).json({
      error: true,
      status: 400,
      body: "Parámetros inválidos para mover cantidad",
    });
  }

  let moved = 0;
  const movimientos = [];

  try {
    for (let i = 0; i < qtyReq; i++) {
      // 1) sacar 1 unidad real del origen (movible)
      const taken = await takeOneUnitFromOriginMovible(fromId, id_item);

      // 2) mantener agregado origen (-1)
      await decBodegaItemsOne(fromId, id_item);

      // 3) ubicar 1 unidad en destino
      try {
        const placed = await asignarItemAuto(toId, id_item);
        moved++;

        movimientos.push({
          id_item,
          from_bodega: fromId,
          to_bodega: toId,
          from_ubicacion: taken.from_ubicacion,
          to_ubicacion: placed.id_ubicacion,
        });
      } catch (e) {
        // Revertimos esa unidad devolviéndola al origen (auto-ubicación)
        try {
          await asignarItemAuto(fromId, id_item);
        } catch (_) {}

        const msg =
          e.code === "NO_FREE_LOCATION"
            ? "No hay ubicaciones disponibles en la bodega destino."
            : e.code === "ITEM_TOO_BIG_FOR_CELL"
            ? e.message
            : "Error al ubicar en bodega destino.";

        if (moved > 0) {
          await registrarTransferencia(id_item, fromId, toId, moved);
          return res.status(409).json({
            error: true,
            status: 409,
            body: {
              message: msg,
              requested: qtyReq,
              moved,
              remaining: Math.max(0, qtyReq - moved),
              partial: true,
              movimientos,
              code: e.code || "MOVE_PARTIAL_DEST_FAIL",
            },
          });
        }

        return res.status(409).json({
          error: true,
          status: 409,
          body: {
            message: msg,
            requested: qtyReq,
            moved: 0,
            code: e.code || "MOVE_FAIL",
          },
        });
      }
    }

    await registrarTransferencia(id_item, fromId, toId, moved);

    return res.json({
      error: false,
      status: 200,
      body: {
        ok: true,
        requested: qtyReq,
        moved,
        fromBodegaId: fromId,
        toBodegaId: toId,
        movimientos,
      },
    });
  } catch (err) {
    console.log("[POST /api/items/:id/move] ERROR:", err);

    const msg =
      err.code === "NO_MOVIBLE_STOCK_IN_ORIGIN"
        ? "No hay stock movible en la bodega de origen."
        : err.message || "Error moviendo cantidad entre bodegas";

    return res.status(400).json({
      error: true,
      status: 400,
      body: msg,
    });
  }
});

module.exports = router;
