const jwt = require("jsonwebtoken");

const generarJWT = (id_usuario, rut, nombre, rol) => {
  const payload = { id_usuario, rut, nombre, rol };

  return new Promise((resolve, reject) => {
    jwt.sign(
      payload,
      "TopiRuloCripyPola",
      {
        expiresIn: "24h",
      },
      (err, token) => {
        if (err) {
          console.log(err);
          reject(err);
        } else {
          resolve(token);
        }
      }
    );
  });
};

module.exports = {
  generarJWT,
};
