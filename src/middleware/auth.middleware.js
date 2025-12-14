const jwt = require("jsonwebtoken");

const verificarToken = (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    console.log("Auth Header:", req.headers.authorization);
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      throw new Error("Acceso denegado. No se proporcionó token.", 401);
    }
    const token = authHeader.split(" ")[1];
    const payload = jwt.verify(token, "TopiRuloCripyPola");
    req.usuario = payload;
    next();
  } catch (error) {
    return res.status(401).json({
      message: "Error de autorización",
      error: error.message,
    });
  }
};

module.exports = {
  verificarToken,
};
