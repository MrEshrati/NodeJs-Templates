const AppError = require("../errors/AppError");

function validateRequest(validator) {
  return (req, res, next) => {
    try {
      const { data, fields } = validator(req.body || {});

      if (Object.keys(fields).length > 0) {
        return next(
          new AppError("Validation failed.", 400, "validation_error", fields),
        );
      }

      req.validatedBody = data;
      next();
    } catch (error) {
      next(error);
    }
  };
}

module.exports = validateRequest;
