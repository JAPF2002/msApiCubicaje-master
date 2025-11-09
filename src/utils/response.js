// msApiCubicaje-master/src/utils/response.js

exports.success = (req, res, status = 200, data = null) => {
  res.status(status).json({
    error: false,
    status,
    body: data,
  });
};

exports.error = (req, res, status = 500, message = "Error interno") => {
  res.status(status).json({
    error: true,
    status,
    body: message,
  });
};
