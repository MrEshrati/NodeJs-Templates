const AppError = require("../errors/AppError");
const {
  consumeRequestThrottle,
} = require("../services/requestThrottle.service");

const createRequestThrottle = ({ scope, maxRequests, windowMs } = {}) => {
  if (typeof scope !== "string" || scope.trim() === "") {
    throw new TypeError("scope must be a non-empty string.");
  }

  if (
    !Number.isSafeInteger(maxRequests) ||
    maxRequests < 1 ||
    maxRequests >= Number.MAX_SAFE_INTEGER
  ) {
    throw new TypeError(
      "maxRequests must be a positive safe integer smaller than Number.MAX_SAFE_INTEGER.",
    );
  }

  if (!Number.isSafeInteger(windowMs) || windowMs < 1) {
    throw new TypeError("windowMs must be a positive safe integer.");
  }

  const normalizedScope = scope.trim();
  const windowSeconds = Math.ceil(windowMs / 1000);

  return async (req, res, next) => {
    try {
      const result = await consumeRequestThrottle({
        scope: normalizedScope,
        clientKey: req.ip,
        maxRequests,
        windowMs,
      });

      if (result.throttled === false) {
        return next();
      }

      if (
        result.throttled !== true ||
        !Number.isSafeInteger(result.retryAfterSeconds) ||
        result.retryAfterSeconds < 1
      ) {
        throw new Error("Unexpected request throttle service result.");
      }

      res.setHeader("Retry-After", String(result.retryAfterSeconds));

      return next(
        new AppError(
          `Request was throttled. Expected available in ${windowSeconds} seconds.`,
          429,
          "throttled",
        ),
      );
    } catch (error) {
      return next(error);
    }
  };
};

module.exports = createRequestThrottle;
