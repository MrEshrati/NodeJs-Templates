const AppError = require("../errors/AppError");

const errorHandler = (err, req, res, next) => {
  if (err?.type === "entity.parse.failed") {
    return res.status(400).json({
      error: true,
      code: "invalid_json",
      message: "Request body contains invalid JSON.",
    });
  }

  if (err?.type === "entity.too.large") {
    return res.status(413).json({
      error: true,
      code: "payload_too_large",
      message: "Request body is too large.",
    });
  }

  const validAppError =
    err instanceof AppError &&
    Number.isInteger(err.statusCode) &&
    err.statusCode >= 400 &&
    err.statusCode <= 599;

  if (!validAppError) {
    const requestId = req?.requestId ?? "unavailable";

    console.error(`Unexpected application error [requestId=${requestId}]:`, err);

    return res.status(500).json({
      error: true,
      code: "internal_error",
      message: "Something went wrong",
    });
  }

  const response = {
    error: true,
    code: err.code || "internal_error",
    message: err.message || "Something went wrong",
  };

  if (err.fields !== null && err.fields !== undefined) {
    response.fields = err.fields;
  }

  return res.status(err.statusCode).json(response);
};

module.exports = errorHandler;
