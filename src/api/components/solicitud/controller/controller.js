const pool = require("../../../utils/connection");

function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    pool.query(sql, params, (err, rows) => (err ? reject(err) : resolve(rows)));
  });
}

const ESTADOS_VALIDOS = new Set(["pendiente", "aceptada", "rechazada", "anulada"]);

async function list(query = {}) {
  const id_empleado = query.id_empleado ? Number(query.id_empleado) : null;
  const estado = query.estado ? String(query.estado) : null;

  let sql = `
    SELECT
      s.id_solicitud,
      s.id_empleado,
      s.nombre_sugerido_bodega,
      s.motivo,
      s.estado,
      s.leida_por_empleado,
      s.fecha_creacion,
      s.fecha_respuesta,
      u.nombre AS empleado_nombre
    FROM solicitudes s
    JOIN usuarios u ON u.id_usuario = s.id_empleado
    WHERE 1=1
  `;
  const params = [];

  if (id_empleado) {
    sql += " AND s.id_empleado = ? ";
    params.push(id_empleado);
  }

  // IMPORTANTE: si llega "all" lo ignoramos
  if (estado && estado !== "all") {
    sql += " AND s.estado = ? ";
    params.push(estado);
  }

  sql += " ORDER BY s.id_solicitud DESC ";

  return await q(sql, params);
}

async function insert(body = {}) {
  const id_empleado = Number(body.id_empleado);
  const nombre = String(body.nombre_sugerido_bodega || "").trim();
  const motivo = String(body.motivo || "").trim();

  if (!id_empleado) throw new Error("id_empleado es requerido");
  if (!nombre) throw new Error("nombre_sugerido_bodega es requerido");
  if (!motivo) throw new Error("motivo es requerido");

  const r = await q(
    `INSERT INTO solicitudes (id_empleado, nombre_sugerido_bodega, motivo, estado)
     VALUES (?, ?, ?, 'pendiente')`,
    [id_empleado, nombre, motivo]
  );

  const id = r.insertId;
  const rows = await q(
    `SELECT s.*, u.nombre AS empleado_nombre
     FROM solicitudes s
     JOIN usuarios u ON u.id_usuario = s.id_empleado
     WHERE s.id_solicitud = ?`,
    [id]
  );

  return rows?.[0] || { id_solicitud: id };
}

async function updateEstado(id, estado) {
  const id_solicitud = Number(id);
  const nuevoEstado = String(estado || "").toLowerCase().trim();

  if (!id_solicitud) throw new Error("ID inválido");
  if (!ESTADOS_VALIDOS.has(nuevoEstado)) {
    throw new Error(
      `Estado inválido: ${nuevoEstado}. Usa: pendiente|aceptada|rechazada|anulada`
    );
  }

  // Si admin responde (aceptada/rechazada/anulada), dejamos fecha_respuesta
  const setRespuesta = nuevoEstado === "pendiente" ? null : "NOW()";

  await q(
    `UPDATE solicitudes
     SET estado = ?,
         leida_por_empleado = 0,
         fecha_respuesta = ${setRespuesta}
     WHERE id_solicitud = ?`,
    [nuevoEstado, id_solicitud]
  );

  const rows = await q(
    `SELECT s.*, u.nombre AS empleado_nombre
     FROM solicitudes s
     JOIN usuarios u ON u.id_usuario = s.id_empleado
     WHERE s.id_solicitud = ?`,
    [id_solicitud]
  );

  return rows?.[0] || { ok: true };
}

module.exports = { list, insert, updateEstado };
