const errorHandler = (err, req, res, next) => {
  const statusCode = err.statusCode || 500;

  const response = {
    error: true,
    code: err.code || "internal_error",
    message: err.message || "Something went wrong",
  };

  if (err.fields !== null && err.fields !== undefined) {
    response.fields = err.fields;
  }

  res.status(statusCode).json(response);
};

module.exports = errorHandler;
