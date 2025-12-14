const express = require("express");
const router = express.Router();
const store = require("../../../store");
const bcrypt = require("bcrypt");
const { generarJWT } = require("../../../helpers/jwt");
const jwt = require("jsonwebtoken");
const {validate} = require("rut.js");
const { json } = require("body-parser");
const {verificarToken} = require("../../../middleware/auth.middleware");

// Promise wrapper (store.query es callback-style)
function q(sql, params = []) {
  return new Promise((resolve, reject) => {
    store.query(sql, params, (err, rows) => {
      if (err) return reject(err);
      resolve(rows);
    });
  });
}

router.post("/login", async (req, res) => {
    const {rut, password} = req.body;
    console.log(rut, password);
    if (!rut || !password) {
        throw new Error("Datos incompletos: Falta rut o password");
    }
    const sql = `SELECT id_usuario, rut, nombre, password, rol, estado FROM usuarios WHERE rut = ?`;
    const rows = await q(sql, [rut]);
    if (rows.length === 0) {
        return res.status(401).json({ ok: false, error: "Usuario no encontrado" });
    }
    const user = rows[0];
    // Verificar estado
    if (user.estado !== 1) {
        return res.status(403).json({ ok:false, error: "Usuario inactivo" });
    }
    // Validar password
    const validPassword = await bcrypt.compareSync(password, user.password);
    if (!validPassword) {
        return res.status(401).json({ ok: false, error: "Password incorrecto" });
    }
    
    const token = await generarJWT(user.id_usuario, user.rut, user.nombre, user.rol);
    delete user.password;
    res.json({ ...user, token, ok: true });
})

router.post("/crear", async (req, res) => {
    const {rut, nombre, password, correo, rol} = req.body;
    try {
        if (!rut || !nombre || !password || !correo) {
            return res.status(400).json({ error: "Datos incompletos: Faltan campos obligatorios" });        
        }
        // Validación básica de correo: debe tener @ y una extensión .algo
        const correoTrim = String(correo).trim().toLowerCase();
        const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

        if (!emailRegex.test(correoTrim)) {
        return res.status(400).json({
            error: "Correo inválido: debe contener '@' y una extensión válida",
        });
        }

        if(!validate(rut)) {
            return res.status(400).json({ error: "RUT inválido" })
        }
        if(password.length < 12) {
            return res.status(400).json({ error: "La contraseña debe tener al menos 12 caracteres" });
        }
        const userCheckSql = `SELECT id_usuario FROM usuarios WHERE rut = ?`;
        const existingUsers = await q(userCheckSql, [rut]);
        if (existingUsers.length > 0) {
            return res.status(400).json({ error: "Ya existe un usuario con ese RUT" });
        }
        const userMailCheckSql = `SELECT correo FROM usuarios WHERE correo = ?`;
        const existingMails = await q(userMailCheckSql, [correoTrim]);
        if (existingMails.length > 0) {
            return res.status(400).json({error: "Ya existe un usuario con ese correo"})
        }
        const hashedPassword = await bcrypt.hashSync(password, 10);
        const sql = `INSERT INTO usuarios (rut, nombre, password, correo, rol) 
        VALUES (?, ?, ?, ?, ?)`;
        const result = await q(sql, [rut, nombre, hashedPassword, correoTrim, rol || 'empleado']);
        if (result.affectedRows === 1) {
            res.json({ message: "Usuario registrado exitosamente", id_usuario: result.insertId });
        } else {
            res.status(500).json({ error: "Error al registrar usuario" });
        }
    } catch (error) {
        console.log(error);
        
        res.status(500).json({ error: "Error al registrar usuario" });
    }
})

router.use(verificarToken);

router.get("/", async (req, res) => {
    const sql = `SELECT id_usuario, rut, nombre, rol, estado, correo
    FROM usuarios`;
    const rows = await q(sql);
    res.json({ usuarios: rows });
});

router.patch("/cambiar_estado/:id_usuario", async (req, res) => {
    const {id_usuario} = req.params;
    const sql_get = `SELECT estado FROM usuarios WHERE id_usuario = ?`;
    const rows = await q(sql_get, [id_usuario]);
    if (rows.length === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
    }
    const currentEstado = rows[0].estado;
    const newEstado = currentEstado === 1 ? 0 : 1;
    const sql_update = `UPDATE usuarios SET estado = ? WHERE id_usuario = ?`;
    const result = await q(sql_update, [newEstado, id_usuario]);
    if (result.affectedRows === 1) {
        res.json({ ok: true, message: "Estado del usuario actualizado", nuevo_estado: newEstado });
    } else {
        res.status(500).json({ error: "Error al actualizar estado del usuario" });
    }   
});

router.get("/:id_usuario", async (req, res) => {
    const {id_usuario} = req.params;
    const sql = `SELECT id_usuario, rut, nombre, rol, estado, correo
                FROM usuarios WHERE id_usuario = ?`;
    const rows = await q(sql, [id_usuario]);
    if (rows.length === 0) {
        return res.status(404).json({ error: "Usuario no encontrado" });
    }
    res.json({ usuario: rows[0] });
});

router.patch("/actualizar_datos/:id_usuario", async (req, res) => {
    const {id_usuario} = req.params;
    const {nombre, correo} = req.body;
    if (!nombre || !correo) {
        return res.status(400).json({ error: "Datos incompletos: Faltan campos obligatorios" });
    }
    // Validación básica de correo: debe tener @ y una extensión .algo
    const correoTrim = String(correo).trim().toLowerCase();
    const emailRegex = /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/;

    if (!emailRegex.test(correoTrim)) {
    return res.status(400).json({
        error: "Correo inválido: debe contener '@' y una extensión válida",
    });
    }
    const mail_check_sql = `SELECT id_usuario FROM usuarios WHERE correo = ?`;
    const existingMails = await q(mail_check_sql, [correo]);
    if (existingMails.length > 0 && existingMails[0].id_usuario != id_usuario) {
        return res.status(400).json({ error: "El correo ya está en uso por otro usuario" });
    }
    const sql = `UPDATE usuarios SET nombre = ?, correo = ? WHERE id_usuario = ?`;
    const result = await q(sql, [nombre, correo, id_usuario]);
    if (result.affectedRows === 1) {
        res.json({ message: "Datos del usuario actualizados", user: {id_usuario, nombre, correo} });
    } else {
        res.status(500).json({ error: "Error al actualizar datos del usuario" });
    }
});

router.patch("/cambiar_password", async (req, res) => {
    const payload = req.usuario;
    const id_usuario = payload.id_usuario;
    const {password} = req.body;
    if (!password) {
        return res.status(400).json({ error: "Falta el nuevo password" });
    }
    if(password.length < 12) {
        return res.status(400).json({ error: "La contraseña debe tener al menos 12 caracteres" });
    }
    const hashedPassword = await bcrypt.hashSync(password, 10);
    const sql = `UPDATE usuarios SET password = ? WHERE id_usuario = ?`;
    const result = await q(sql, [hashedPassword, id_usuario]);
    if (result.affectedRows === 1) {
        res.json({ message: "Password actualizado exitosamente" });
    } else {
        res.status(500).json({ error: "Error al actualizar el password" });
    }
});

router.patch("/asignar_rol/:id_usuario", async (req, res) => {
    const {id_usuario} = req.params;
    const {rol} = req.body;
    const roles_validos = ["admin", "empleado"];
    if (!roles_validos.includes(rol)) {
        return res.status(400).json({ error: "Rol inválido" });
    }
    const sql_estado = `SELECT estado FROM usuarios WHERE id_usuario = ?`;
    const rows = await q(sql_estado, [id_usuario]);
    if (rows.length === 0) {
        return res.status(404).json({ ok: false, error: "Usuario no encontrado" });
    }
    const estado = rows[0].estado;
    if (estado !== 1) {
        return res.status(400).json({ ok: false, error: "No se puede asignar rol a un usuario inactivo" });
    }
    const sql = `UPDATE usuarios SET rol = ? WHERE id_usuario = ?`;
    const result = await q(sql, [rol, id_usuario]); 
    if (result.affectedRows === 1) {
        res.json({ ok: true, message: "Rol del usuario actualizado", nuevo_rol: rol });
    } else {
        res.status(500).json({ ok: false, error: "Error al actualizar el rol del usuario" });
    }
});

module.exports = router;