const crypto = require("crypto");
const LoginThrottle = require("../models/loginThrottle.model");

const MAX_FAILED_ATTEMPTS = 5;
const ATTEMPT_WINDOW_MS = 15 * 60 * 1000;
const BLOCK_DURATION_MS = 15 * 60 * 1000;

const getLoginThrottleSecret = () => {
  const secret = process.env.LOGIN_THROTTLE_SECRET;

  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("LOGIN_THROTTLE_SECRET must contain at least 32 bytes.");
  }

  return secret;
};

const createEmailHmac = (email) => {
  if (typeof email !== "string" || email.trim() === "") {
    throw new TypeError("email must be a non-empty string.");
  }

  const normalizedEmail = email.trim().toLowerCase();

  return crypto
    .createHmac("sha256", getLoginThrottleSecret())
    .update(normalizedEmail, "utf8")
    .digest("hex");
};

const getLoginThrottleStatus = async (email) => {
  const emailHmac = createEmailHmac(email);

  const throttle = await LoginThrottle.findOne({
    emailHmac,
    $expr: { $gt: ["$blockedUntil", "$$NOW"] },
  })
    .select("blockedUntil -_id")
    .lean();

  return {
    blocked: Boolean(throttle),
    blockedUntil: throttle?.blockedUntil ?? null,
  };
};

const createFailedLoginUpdate = () => {
  const isBlocked = {
    $gt: [{ $ifNull: ["$blockedUntil", null] }, "$$NOW"],
  };

  const shouldReset = {
    $or: [
      { $eq: [{ $ifNull: ["$windowStartedAt", null] }, null] },
      {
        $lte: ["$windowStartedAt", { $subtract: ["$$NOW", ATTEMPT_WINDOW_MS] }],
      },
      {
        $and: [
          { $ne: [{ $ifNull: ["$blockedUntil", null] }, null] },
          { $lte: ["$blockedUntil", "$$NOW"] },
        ],
      },
    ],
  };

  return [
    {
      $set: {
        failedAttempts: {
          $cond: [
            isBlocked,
            "$failedAttempts",
            {
              $cond: [
                shouldReset,
                1,
                { $add: [{ $ifNull: ["$failedAttempts", 0] }, 1] },
              ],
            },
          ],
        },
        windowStartedAt: {
          $cond: [
            isBlocked,
            "$windowStartedAt",
            { $cond: [shouldReset, "$$NOW", "$windowStartedAt"] },
          ],
        },
        createdAt: { $ifNull: ["$createdAt", "$$NOW"] },
        updatedAt: { $cond: [isBlocked, "$updatedAt", "$$NOW"] },
      },
    },
    {
      $set: {
        blockedUntil: {
          $cond: [
            isBlocked,
            "$blockedUntil",
            {
              $cond: [
                { $gte: ["$failedAttempts", MAX_FAILED_ATTEMPTS] },
                { $add: ["$$NOW", BLOCK_DURATION_MS] },
                null,
              ],
            },
          ],
        },
      },
    },
    {
      $set: {
        expiresAt: {
          $ifNull: [
            "$blockedUntil",
            { $add: ["$windowStartedAt", ATTEMPT_WINDOW_MS] },
          ],
        },
      },
    },
  ];
};

const recordFailedLogin = async (email) => {
  const emailHmac = createEmailHmac(email);

  await LoginThrottle.init();

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const throttle = await LoginThrottle.findOneAndUpdate(
        { emailHmac },
        createFailedLoginUpdate(),
        {
          upsert: true,
          returnDocument: "after",
          updatePipeline: true,
          timestamps: false,
          setDefaultsOnInsert: false,
        },
      ).lean();

      return {
        blocked: throttle.blockedUntil !== null,
        blockedUntil: throttle.blockedUntil,
      };
    } catch (error) {
      const duplicateEmail =
        error.code === 11000 &&
        (error.keyPattern?.emailHmac || error.keyValue?.emailHmac);

      if (!duplicateEmail || attempt === 2) {
        throw error;
      }
    }
  }
};

const clearLoginFailures = async (email) => {
  const emailHmac = createEmailHmac(email);
  await LoginThrottle.deleteOne({ emailHmac });
};

module.exports = {
  getLoginThrottleStatus,
  recordFailedLogin,
  clearLoginFailures,
};
