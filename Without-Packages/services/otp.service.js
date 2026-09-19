const OtpCode = require("../models/otpCode.model");
const User = require("../models/user.model");
const { sendOtpCodeEmail } = require("./email.service");
const { issueTokenPair } = require("./token.service");
const {
  ACCOUNT_EMAIL_JOB_TYPES,
  enqueueAccountEmailJob,
} = require("./accountEmailJob.service");
const {
  generateOtpCode,
  hashOtpCode,
  verifyOtpCodeHash,
} = require("../utils/otp.utils");

const OTP_CODE_TTL_MS = 10 * 60 * 1000;
const OTP_SEND_COOLDOWN_MS = 60 * 1000;
const OTP_MAX_FAILED_ATTEMPTS = 5;

const createOtpCodeUpdate = (codeHash) => [
  {
    $set: {
      codeHash: { $literal: codeHash },
      expiresAt: { $add: ["$$NOW", OTP_CODE_TTL_MS] },
      sentAt: "$$NOW",
      failedAttempts: 0,
      createdAt: { $ifNull: ["$createdAt", "$$NOW"] },
      updatedAt: "$$NOW",
      failedAttempts: 0,
      consumedAt: null,
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

const requestOtpCode = async (email) => {
  await enqueueAccountEmailJob(ACCOUNT_EMAIL_JOB_TYPES.OTP_LOGIN, email);

  return { status: "accepted" };
};

const deliverOtpCodeEmail = async (email) => {
  const user = await User.findOne({
    email,
    isActive: true,
  })
    .select("_id email")
    .lean();

  if (!user) {
    return {
      status: "discarded",
      previewUrl: null,
    };
  }

  const issuedCode = await issueOtpCodeAfterCooldown(user._id);
  if (issuedCode === null) {
    return {
      status: "discarded",
      previewUrl: null,
    };
  }

  let emailResult;

  try {
    emailResult = await sendOtpCodeEmail(user.email, issuedCode.code);
  } catch (error) {
    await OtpCode.deleteOne({
      user: user._id,
      expiresAt: issuedCode.expiresAt,
    });

    throw error;
  }
  return {
    status: "sent",
    messageId: emailResult.messageId,
    previewUrl: emailResult.previewUrl,
  };
};

const inspectOtpCode = async (userId, code) => {
  const otp = await OtpCode.findOne({
    user: userId,
    consumedAt: null,
    failedAttempts: { $lt: OTP_MAX_FAILED_ATTEMPTS },
    $expr: { $gt: ["$expiresAt", "$$NOW"] },
  })
    .select("_id user codeHash sentAt expiresAt")
    .lean();

  if (!otp) {
    return { status: "otp_invalid" };
  }

  const codeMatches = verifyOtpCodeHash(userId, code, otp.codeHash);
  return { status: "candidate", otp, codeMatches };
};

const consumeOtpCode = async (userId, code) => {
  const result = await inspectOtpCode(userId, code);
  if (result.status !== "candidate") {
    return { status: "otp_invalid" };
  }

  const otp = result.otp;
  const codeMatches = result.codeMatches;
  const filter = {
    _id: otp._id,
    user: userId,
    codeHash: otp.codeHash,
    sentAt: otp.sentAt,
    expiresAt: otp.expiresAt,
    consumedAt: null,
    failedAttempts: { $lt: OTP_MAX_FAILED_ATTEMPTS },
    $expr: { $gt: ["$expiresAt", "$$NOW"] },
  };

  if (!codeMatches) {
    await OtpCode.updateOne(
      filter,
      {
        $inc: { failedAttempts: 1 },
        $currentDate: { updatedAt: true },
      },
      { upsert: false, timestamps: false },
    );

    return { status: "otp_invalid" };
  }

  const updateResult = await OtpCode.updateOne(
    filter,
    {
      $currentDate: {
        consumedAt: true,
        updatedAt: true,
      },
    },
    { upsert: false, timestamps: false },
  );

  if (updateResult.matchedCount === 1) {
    return { status: "consumed" };
  }

  return {
    status: "otp_invalid",
  };
};

const verifyOtpLogin = async (email, code) => {
  if (typeof email === "string" && email.trim() !== "") {
    const user = await User.findOne({
      email,
      isActive: true,
    })
      .select("_id email")
      .lean();

    if (!user) {
      return {
        status: "otp_invalid",
      };
    }

    const result = await consumeOtpCode(user._id, code);
    if (result.status !== "consumed") {
      return { status: "otp_invalid" };
    }

    const updateUser = await User.updateOne(
      { _id: user._id, email: user.email, isActive: true },
      { $set: { emailVerified: true } },
      { upsert: false, runValidators: true },
    );

    if (updateUser.matchedCount !== 1) {
      return {
        status: "otp_invalid",
      };
    }

    const tokens = await issueTokenPair(user._id);
    return { status: "authenticated", tokens };
  }
  return {
    status: "otp_invalid",
  };
};

module.exports = {
  issueOtpCodeAfterCooldown,
  requestOtpCode,
  deliverOtpCodeEmail,
  inspectOtpCode,
  consumeOtpCode,
  verifyOtpLogin,
};
