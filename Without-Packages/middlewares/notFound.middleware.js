const AppError = require("../errors/AppError");

const notFound = (req, res, next) =>
  next(
    new AppError(
      "The requested resource was not found.",
      404,
      "not_found",
    ),
  );

module.exports = notFound;
