const OtpCode = require("../models/otpCode.model");
const {
  generateOtpCode,
  hashOtpCode,
} = require("../utils/otp.utils");

const OTP_CODE_TTL_MS = 10 * 60 * 1000;
const OTP_SEND_COOLDOWN_MS = 60 * 1000;

const createOtpCodeUpdate = (codeHash) => [
  {
    $set: {
      codeHash: { $literal: codeHash },
      expiresAt: { $add: ["$$NOW", OTP_CODE_TTL_MS] },
      sentAt: "$$NOW",
      failedAttempts: 0,
      createdAt: { $ifNull: ["$createdAt", "$$NOW"] },
      updatedAt: "$$NOW",
    },
  },
];

const issueOtpCodeAfterCooldown = async (userId) => {
  const code = generateOtpCode();
  const codeHash = hashOtpCode(userId, code);
  const cooldownCutoff = new Date(Date.now() - OTP_SEND_COOLDOWN_MS);

  await OtpCode.init();

  try {
    const issuedCode = await OtpCode.findOneAndUpdate(
      {
        user: userId,
        $or: [
          { sentAt: { $lte: cooldownCutoff } },
          { sentAt: { $exists: false } },
        ],
      },
      createOtpCodeUpdate(codeHash),
      {
        upsert: true,
        returnDocument: "after",
        updatePipeline: true,
        timestamps: false,
        setDefaultsOnInsert: false,
      },
    )
      .select("_id expiresAt")
      .lean();

    return {
      code,
      expiresAt: issuedCode.expiresAt,
    };
  } catch (error) {
    const duplicateUser =
      error?.code === 11000 &&
      (error.keyPattern?.user === 1 ||
        Object.prototype.hasOwnProperty.call(error.keyValue ?? {}, "user") ||
        error.message?.includes("user_1"));

    if (duplicateUser) {
      return null;
    }

    throw error;
  }
};

module.exports = {
  issueOtpCodeAfterCooldown,
};

