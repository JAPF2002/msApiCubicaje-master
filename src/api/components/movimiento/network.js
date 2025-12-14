// msApiCubicaje-master/src/api/components/movimiento/network.js
const express = require("express");
const router = express.Router();

// PDF
const fs = require("fs");
const path = require("path");
const { PDFDocument, StandardFonts, rgb } = require("pdf-lib");

// Ticket
const crypto = require("crypto");

const store = require("../../../store");
const { verificarToken } = require("../../../middleware/auth.middleware");

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
 * ===========================
 * TICKETS (in-memory)
 * ===========================
 * - Se guardan en RAM (se borran solos por expiración).
 * - Si reinicias el backend, los tickets previos se pierden (normal).
 */
const TICKET_TTL_MS = 5 * 60 * 1000; // 5 minutos
const ticketStore = new Map(); // ticket -> { exp: number }

function pruneTickets() {
  const now = Date.now();
  for (const [t, info] of ticketStore.entries()) {
    if (!info?.exp || info.exp <= now) ticketStore.delete(t);
  }
}

function createTicket() {
  pruneTickets();
  const ticket = crypto.randomBytes(24).toString("hex");
  ticketStore.set(ticket, { exp: Date.now() + TICKET_TTL_MS });
  return ticket;
}

function validateTicket(ticket) {
  pruneTickets();
  const info = ticketStore.get(ticket);
  if (!info) return false;
  if (info.exp <= Date.now()) {
    ticketStore.delete(ticket);
    return false;
  }
  return true;
}

/**
 * ===========================
 * PDF (público con ticket OR con token)
 * ===========================
 * - Esto va ANTES de router.use(verificarToken) para que el browser pueda abrirlo.
 * - Igual exigimos: ticket válido O Authorization Bearer válido.
 */
router.get("/informe/pdf", async (req, res) => {
  try {
    const ticket = String(req.query.ticket || "").trim();

    // 1) Si viene ticket, valida ticket (sin token)
    if (ticket) {
      const ok = validateTicket(ticket);
      if (!ok) {
        return res.status(401).json({
          error: true,
          status: 401,
          body: "Ticket inválido o expirado. Genera uno nuevo.",
        });
      }
    } else {
      // 2) Si no viene ticket, aceptamos token (modo antiguo / Postman)
      const auth = String(req.headers.authorization || "");
      const hasBearer = auth.toLowerCase().startsWith("bearer ");
      if (!hasBearer) {
        return res.status(401).json({
          error: true,
          status: 401,
          body: "Falta ticket o Authorization Bearer.",
        });
      }

      // Ejecuta verificarToken manualmente (promisificado)
      await new Promise((resolve, reject) => {
        verificarToken(req, res, (err) => {
          if (err) return reject(err);
          return resolve();
        });
      });
    }

    // -------- helpers fecha --------
    const pad2 = (n) => String(n).padStart(2, "0");
    const toDate = (v) => {
      const d = new Date(v);
      return isNaN(d.getTime()) ? null : d;
    };

    const startOfDay = (d) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
    const endOfDay = (d) =>
      new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

    const startOfWeekMon = (d) => {
      const x = startOfDay(d);
      const day = x.getDay(); // 0 dom ... 6 sáb
      const diff = (day + 6) % 7; // lunes = 0
      x.setDate(x.getDate() - diff);
      return x;
    };

    const startOfMonth = (d) =>
      new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);

    const fmtDate = (d) =>
      `${pad2(d.getDate())}-${pad2(d.getMonth() + 1)}-${d.getFullYear()}`;
    const fmtTime = (d) => `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
    const fmtDateTime = (d) => `${fmtDate(d)} ${fmtTime(d)}`;

    const normTipo = (tipo) => {
      const t = String(tipo || "").toLowerCase();
      if (
        t === "traslado" ||
        t === "transfer" ||
        t === "move" ||
        t === "transferencia"
      )
        return "transfer";
      if (
        t === "entrada" ||
        t === "ingreso" ||
        t === "in" ||
        t === "add" ||
        t === "ajuste_mas"
      )
        return "in";
      if (
        t === "salida" ||
        t === "egreso" ||
        t === "out" ||
        t === "remove" ||
        t === "ajuste_menos"
      )
        return "out";
      return t;
    };

    const tipoLabel = (tipo) => {
      const t = normTipo(tipo);
      if (t === "transfer") return "Traslado";
      if (t === "in") return "Ingreso";
      if (t === "out") return "Egreso";
      return "Movimiento";
    };

    // Evita caracteres que dan WinAnsi error (→, —, etc.)
    const safe = (s) =>
      String(s ?? "")
        .replace(/→/g, "->")
        .replace(/—/g, "-")
        .replace(/•/g, "|")
        .replace(/[“”]/g, '"')
        .replace(/[’]/g, "'");

    // Cantidad con signo: Ingreso +, Egreso -, Traslado sin signo
    const signedQty = (tipo, cantidad) => {
      const t = normTipo(tipo);
      const q = Math.max(0, Number(cantidad) || 0);
      if (t === "in") return `+${q}`;
      if (t === "out") return `-${q}`;
      return `${q}`;
    };

    // Wrap simple para que no se corte por ancho
    const wrapText = (text, maxWidth, font, size) => {
      const words = String(text || "").split(" ");
      const lines = [];
      let line = "";

      for (const w of words) {
        const test = line ? `${line} ${w}` : w;
        const width = font.widthOfTextAtSize(test, size);
        if (width <= maxWidth) {
          line = test;
        } else {
          if (line) lines.push(line);
          line = w;
        }
      }
      if (line) lines.push(line);
      return lines;
    };

    // Devuelve 2 líneas por movimiento (con "punto" al inicio)
    const buildLines = (m) => {
      const prefix = "· "; // puedes cambiar por "- " si quieres

      const t = normTipo(m.tipo);
      const d = toDate(m.fecha) || new Date();
      const dt = fmtDateTime(d);

      const item = safe(m.itemNombre || "Item");
      const qty = signedQty(m.tipo, m.cantidad);

      if (t === "transfer") {
        const desde = safe(m.desdeBodega || "-");
        const hacia = safe(m.haciaBodega || "-");

        return [
          `${prefix}${desde}  ||  Movimiento: ${tipoLabel(
            m.tipo
          )}  ||  Hacia: ${hacia}  ||  Cantidad: ${qty}`,
          `${item}  ||  ${dt}`,
        ];
      }

      const bodega = safe(m.bodega || "-");

      return [
        `${prefix}${bodega}  ||  Movimiento: ${tipoLabel(
          m.tipo
        )}  ||  Cantidad: ${qty}`,
        `${item}  ||  ${dt}`,
      ];
    };

    // -------- 1) rangos --------
    const now = new Date();

    const rangeHoy = {
      label: "Hoy",
      start: startOfDay(now),
      end: endOfDay(now),
    };
    const rangeSemana = {
      label: "Esta semana",
      start: startOfWeekMon(now),
      end: endOfDay(now),
    };
    const rangeMes = {
      label: "Este mes",
      start: startOfMonth(now),
      end: endOfDay(now),
    };

    // -------- 2) query movimientos por rango --------
    const fetchMovs = async (start, end, limit) => {
      const sql = `
        SELECT
          m.id_mov AS id,
          i.nombre AS itemNombre,
          bo.nombre AS desdeBodega,
          bd.nombre AS haciaBodega,
          CASE
            WHEN m.tipo IN ('ingreso','ajuste_mas') THEN bd.nombre
            WHEN m.tipo IN ('egreso','ajuste_menos') THEN bo.nombre
            ELSE NULL
          END AS bodega,
          m.qty AS cantidad,
          m.tipo,
          m.fecha_creacion AS fecha,
          JSON_UNQUOTE(JSON_EXTRACT(m.meta, '$.userNombre')) AS usuarioNombre
        FROM item_movimientos m
        INNER JOIN items i ON i.id_item = m.id_item
        LEFT JOIN bodegas bo ON bo.id_bodega = m.id_bodega_origen
        LEFT JOIN bodegas bd ON bd.id_bodega = m.id_bodega_destino
        WHERE m.fecha_creacion >= ? AND m.fecha_creacion <= ?
        ORDER BY m.fecha_creacion DESC
        LIMIT ?
      `;
      return await q(sql, [start, end, limit]);
    };

    // Límites por bloque (según tu plantilla)
    const hoyRows = await fetchMovs(rangeHoy.start, rangeHoy.end, 6);
    const semanaRows = await fetchMovs(rangeSemana.start, rangeSemana.end, 4);
    const mesRows = await fetchMovs(rangeMes.start, rangeMes.end, 12);

    // -------- 3) cargar plantilla --------
    const templatePath = path.join(
      __dirname,
      "assets",
      "formato pdf, historial de transacciones.pdf"
    );

    if (!fs.existsSync(templatePath)) {
      return res.status(500).json({
        error: true,
        status: 500,
        body: `No encuentro la plantilla PDF en: ${templatePath}`,
      });
    }

    const templateBytes = fs.readFileSync(templatePath);
    const pdfDoc = await PDFDocument.load(templateBytes);

    const font = await pdfDoc.embedFont(StandardFonts.Helvetica);
    const page = pdfDoc.getPages()[0];
    const { width, height } = page.getSize();

    const yFromTop = (top) => height - top;

    const X = 85;
    const fontSize = 9.5;
    const lineH = 12;
    const gapBetweenMovs = 6;
    const maxWidth = width - X * 2;

    const drawList = (rows, yStart, maxMovs) => {
      let y = yStart;
      const slice = rows.slice(0, maxMovs);

      if (slice.length === 0) {
        page.drawText("Sin movimientos.", {
          x: X,
          y,
          size: fontSize,
          font,
          color: rgb(0, 0, 0),
        });
        return;
      }

      for (const m of slice) {
        const lines = buildLines(m);

        for (const L of lines) {
          const wrapped = wrapText(L, maxWidth, font, fontSize);
          for (const wline of wrapped) {
            page.drawText(wline, {
              x: X,
              y,
              size: fontSize,
              font,
              color: rgb(0, 0, 0),
            });
            y -= lineH;
            if (y < 60) return;
          }
        }

        y -= gapBetweenMovs;
      }
    };

    drawList(hoyRows, yFromTop(216.6), 6);
    drawList(semanaRows, yFromTop(288.6), 4);
    drawList(mesRows, yFromTop(336.5), 12);

    // -------- 4) devolver PDF --------
    const pdfBytes = await pdfDoc.save();
    const filename = `historial-${Date.now()}.pdf`;

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    return res.status(200).send(Buffer.from(pdfBytes));
  } catch (err) {
    console.log("[movimientos] GET /informe/pdf error:", err);
    return res.status(500).json({
      error: true,
      status: 500,
      body: err?.message || "Error generando PDF",
    });
  }
});

/**
 * ===========================
 * A PARTIR DE AQUÍ, TODO CON TOKEN
 * ===========================
 */
router.use(verificarToken);

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

/**
 * POST /api/movimientos/informe/ticket
 * - requiere token (por router.use)
 * - devuelve un ticket para luego abrir /informe/pdf?ticket=...
 */
router.post("/informe/ticket", async (req, res) => {
  try {
    const ticket = createTicket();
    return res.status(200).json({
      error: false,
      status: 200,
      ticket,
      expiresInSec: Math.floor(TICKET_TTL_MS / 1000),
    });
  } catch (err) {
    console.log("[movimientos] POST /informe/ticket error:", err);
    return res.status(500).json({
      error: true,
      status: 500,
      body: err?.message || "Error generando ticket",
    });
  }
});

module.exports = router;
