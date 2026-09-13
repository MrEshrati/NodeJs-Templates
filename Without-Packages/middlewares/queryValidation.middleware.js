const AppError = require("../errors/AppError");

const validateQuery = (validator) => (req, res, next) => {
  try {
    const { data, fields } = validator(req.query || {});

    if (Object.keys(fields).length > 0) {
      return next(
        new AppError("Validation failed.", 400, "validation_error", fields),
      );
    }

    req.validatedQuery = data;
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = validateQuery;
