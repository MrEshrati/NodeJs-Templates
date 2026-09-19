const crypto = require("crypto");
const RequestThrottle = require("../models/requestThrottle.model");

const getRequestThrottleSecret = () => {
  const secret = process.env.REQUEST_THROTTLE_SECRET;

  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("REQUEST_THROTTLE_SECRET must contain at least 32 bytes.");
  }

  return secret;
};

const createRequestKeyHmac = (scope, clientKey) => {
  if (typeof scope !== "string" || scope.trim() === "") {
    throw new TypeError("scope must be a non-empty string.");
  }

  if (typeof clientKey !== "string" || clientKey.trim() === "") {
    throw new TypeError("clientKey must be a non-empty string.");
  }

  return crypto
    .createHmac("sha256", getRequestThrottleSecret())
    .update(scope.trim(), "utf8")
    .update("\0", "utf8")
    .update(clientKey.trim(), "utf8")
    .digest("hex");
};

const createRequestThrottleUpdate = (maxRequests, windowMs) => {
  const shouldResetWindow = {
    $or: [
      { $eq: [{ $ifNull: ["$windowStartedAt", null] }, null] },
      {
        $lte: ["$windowStartedAt", { $subtract: ["$$NOW", windowMs] }],
      },
    ],
  };

  return [
    {
      $set: {
        requestCount: {
          $cond: [
            shouldResetWindow,
            1,
            {
              $min: [
                { $add: [{ $ifNull: ["$requestCount", 0] }, 1] },
                maxRequests + 1,
              ],
            },
          ],
        },
        windowStartedAt: {
          $cond: [shouldResetWindow, "$$NOW", "$windowStartedAt"],
        },
        createdAt: { $ifNull: ["$createdAt", "$$NOW"] },
        updatedAt: "$$NOW",
      },
    },
    {
      $set: {
        expiresAt: { $add: ["$windowStartedAt", windowMs] },
      },
    },
  ];
};

const consumeRequestThrottle = async (
  { scope, clientKey, maxRequests, windowMs } = {},
) => {
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

  const keyHmac = createRequestKeyHmac(scope, clientKey);

  await RequestThrottle.init();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const throttle = await RequestThrottle.findOneAndUpdate(
        { keyHmac },
        createRequestThrottleUpdate(maxRequests, windowMs),
        {
          upsert: true,
          returnDocument: "after",
          updatePipeline: true,
          timestamps: false,
          setDefaultsOnInsert: false,
        },
      ).lean();

      const throttled = throttle.requestCount > maxRequests;
      const retryAfterMs =
        throttle.expiresAt.getTime() - throttle.updatedAt.getTime();

      return {
        throttled,
        retryAfterSeconds: throttled
          ? Math.max(1, Math.ceil(retryAfterMs / 1000))
          : 0,
      };
    } catch (error) {
      const duplicateKey =
        error.code === 11000 &&
        (error.keyPattern?.keyHmac || error.keyValue?.keyHmac);

      if (!duplicateKey || attempt === 2) {
        throw error;
      }
    }
  }
};

module.exports = {
  consumeRequestThrottle,
};
