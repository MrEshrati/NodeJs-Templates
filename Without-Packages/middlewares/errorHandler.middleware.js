const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  res.status(statusCode).json({
    error: true,
    code: err.code || "internal_error",
    message: err.message || "Something went wrong",
    fields: err.fields || null
  });
};

module.exports = errorHandler;