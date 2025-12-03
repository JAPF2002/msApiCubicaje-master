// msApiCubicaje-master/src/api/components/movimiento/network.js
const express = require("express");
const router = express.Router();

const store = require("../../../store");

// Promise wrapper (store.query es callback-style)
function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    store.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

/**
 * GET /api/movimientos
 * Query opcional:
 *  - limit=200
 *  - id_item=15
 *  - id_bodega=1   (filtra si fue origen o destino)
 *  - tipo=transferencia|ingreso|egreso  (o varios separados por coma)
 */
router.get("/", async (req, res) => {
  try {
    const limit = Math.min(
      Math.max(parseInt(req.query.limit || "200", 10) || 200, 1),
      1000
    );

    const id_item = req.query.id_item ? parseInt(req.query.id_item, 10) : null;
    const id_bodega = req.query.id_bodega
      ? parseInt(req.query.id_bodega, 10)
      : null;

    // tipo puede venir como: tipo=ingreso  o tipo=ingreso,egreso
    const tipoRaw = String(req.query.tipo || "").trim();
    const tipos = tipoRaw
      ? tipoRaw
          .split(",")
          .map((x) => x.trim())
          .filter(Boolean)
      : [];

    let where = "WHERE 1=1";
    const params = [];

    if (Number.isFinite(id_item) && id_item > 0) {
      where += " AND m.id_item = ?";
      params.push(id_item);
    }

    if (Number.isFinite(id_bodega) && id_bodega > 0) {
      where += " AND (m.id_bodega_origen = ? OR m.id_bodega_destino = ?)";
      params.push(id_bodega, id_bodega);
    }

    if (tipos.length) {
      where += ` AND m.tipo IN (${tipos.map(() => "?").join(",")})`;
      params.push(...tipos);
    }

    const sql = `
      SELECT
        m.id_mov AS id,
        m.id_item AS itemId,
        i.nombre AS itemNombre,

        m.id_bodega_origen AS desdeBodegaId,
        bo.nombre AS desdeBodega,

        m.id_bodega_destino AS haciaBodegaId,
        bd.nombre AS haciaBodega,

        CASE
          WHEN m.tipo IN ('ingreso','ajuste_mas') THEN m.id_bodega_destino
          WHEN m.tipo IN ('egreso','ajuste_menos') THEN m.id_bodega_origen
          ELSE NULL
        END AS bodegaId,

        CASE
          WHEN m.tipo IN ('ingreso','ajuste_mas') THEN bd.nombre
          WHEN m.tipo IN ('egreso','ajuste_menos') THEN bo.nombre
          ELSE NULL
        END AS bodega,

        m.qty AS cantidad,
        m.tipo,
        m.motivo,
        m.meta,
        m.fecha_creacion AS fecha,

        JSON_UNQUOTE(JSON_EXTRACT(m.meta, '$.userNombre')) AS usuarioNombre
      FROM item_movimientos m
      INNER JOIN items i ON i.id_item = m.id_item
      LEFT JOIN bodegas bo ON bo.id_bodega = m.id_bodega_origen
      LEFT JOIN bodegas bd ON bd.id_bodega = m.id_bodega_destino

      ${where}
      ORDER BY m.fecha_creacion DESC
      LIMIT ?
    `;

    const rows = await q(sql, [...params, limit]);

    return res.status(200).json({
      error: false,
      status: 200,
      body: rows,
    });
  } catch (err) {
    console.log("[movimientos] GET error:", err);
    return res.status(500).json({
      error: true,
      status: 500,
      body: err?.message || "Error obteniendo movimientos",
    });
  }
});

module.exports = router;
