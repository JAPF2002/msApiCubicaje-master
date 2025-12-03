// msApiCubicaje-master/src/api/components/solicitud/controller/index.js

const db = require("../../../../store"); // usa src/store.js (el adaptador)
const response = require("../../../../utils/response");

// Promise wrapper para db.query(sql, params, cb)
function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    db.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

const ESTADOS_VALIDOS = new Set(["pendiente", "aceptada", "rechazada", "anulada"]);

async function list(req, res) {
  try {
    const { id_empleado, estado } = req.query;

    let where = "";
    const params = [];

    if (id_empleado) {
      where = "WHERE s.id_empleado = ?";
      params.push(Number(id_empleado));
    } else if (estado && estado !== "all") {
      where = "WHERE s.estado = ?";
      params.push(String(estado));
    }

    const sql = `
      SELECT
        s.*,
        u.nombre AS empleado_nombre
      FROM solicitudes s
      LEFT JOIN usuarios u ON u.id_usuario = s.id_empleado
      ${where}
      ORDER BY s.id_solicitud DESC
    `;

    const rows = await q(sql, params);
    return response.success(req, res, 200, rows);
  } catch (err) {
    console.log("[solicitud.controller] list error:", err?.message);
    return response.error(req, res, 500, err?.message || "Error listando solicitudes");
  }
}

async function insert(req, res) {
  try {
    const { id_empleado, nombre_sugerido_bodega, motivo } = req.body;

    if (!id_empleado || !nombre_sugerido_bodega || !motivo) {
      return response.error(req, res, 400, "Faltan campos: id_empleado, nombre_sugerido_bodega, motivo");
    }

    const sql = `
      INSERT INTO solicitudes (id_empleado, nombre_sugerido_bodega, motivo, estado, leida_por_empleado, fecha_creacion)
      VALUES (?, ?, ?, 'pendiente', 0, NOW())
    `;

    const result = await q(sql, [
      Number(id_empleado),
      String(nombre_sugerido_bodega),
      String(motivo),
    ]);

    // mysql devuelve insertId
    return response.success(req, res, 201, {
      id_solicitud: result.insertId,
      id_empleado: Number(id_empleado),
      estado: "pendiente",
    });
  } catch (err) {
    console.log("[solicitud.controller] insert error:", err?.message);
    return response.error(req, res, 500, err?.message || "Error creando solicitud");
  }
}

async function updateEstado(req, res) {
  try {
    const id = Number(req.params.id);

    // acepto { estado } y también { status } por si acaso
    const estado = String(req.body?.estado ?? req.body?.status ?? "").trim();

    if (!id || !estado) {
      return response.error(req, res, 400, "Faltan datos: id y estado");
    }
    if (!ESTADOS_VALIDOS.has(estado)) {
      return response.error(req, res, 400, `Estado inválido: ${estado}`);
    }

    const sql = `
      UPDATE solicitudes
      SET estado = ?, fecha_respuesta = NOW()
      WHERE id_solicitud = ?
    `;

    const result = await q(sql, [estado, id]);

    // mysql: affectedRows
    const affected = result?.affectedRows ?? 0;
    if (!affected) {
      return response.error(req, res, 404, "Solicitud no encontrada");
    }

    return response.success(req, res, 200, { id_solicitud: id, estado });
  } catch (err) {
    console.log("[solicitud.controller] updateEstado error:", err?.message);
    return response.error(req, res, 500, err?.message || "Error actualizando estado");
  }
}

module.exports = {
  list,
  insert,
  updateEstado,
};
