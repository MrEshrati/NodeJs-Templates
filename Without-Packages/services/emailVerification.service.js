const tokenGenerator = require("../utils/token.utils");
const emailVerification = require("../models/emailVerificationToken.model");
const User = require("../models/user.model");
const { sendVerificationEmail } = require("./email.service");

const VERIFICATION_TOKEN_TTL_MS = 60 * 60 * 1000;
const VERIFICATION_RESEND_COOLDOWN_MS = 3 * 60 * 1000;

const issueEmailVerificationToken = async (userId) => {
  const token = tokenGenerator.generateToken();
  const hashedToken = tokenGenerator.hashToken(token);
  const expireTime = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

  await emailVerification.findOneAndUpdate(
    { user: userId },
    {
      $set: {
        tokenHash: hashedToken,
        expiresAt: expireTime,
      },
    },
    { upsert: true, runValidators: true },
  );

  return {
    token,
    expiresAt: expireTime,
  };
};

const confirmEmailAddress = async (key) => {
  const hashedToken = tokenGenerator.hashToken(key);
  const verificationToken = await emailVerification.findOneAndDelete({
    tokenHash: hashedToken,
    expiresAt: {
      $gt: new Date(),
    },
  });

  if (!verificationToken) {
    return {
      status: "invalid",
    };
  }

  const user = await User.findOneAndUpdate(
    {
      _id: verificationToken.user,
      isActive: true,
    },
    {
      $set: {
        emailVerified: true,
      },
    },
    {
      returnDocument: "after",
      runValidators: true,
    },
  );

  if (!user) {
    return {
      status: "unable",
    };
  }

  return {
    status: "verified",
    user,
  };
};

const issueEmailVerificationTokenAfterCooldown = async (userId) => {
  const token = tokenGenerator.generateToken();
  const hashedToken = tokenGenerator.hashToken(token);
  const now = Date.now();
  const expiresAt = new Date(now + VERIFICATION_TOKEN_TTL_MS);
  const cooldownCutoff = new Date(now - VERIFICATION_RESEND_COOLDOWN_MS);
  const tokenUpdate = {
    $set: {
      tokenHash: hashedToken,
      expiresAt,
    },
  };

  const updatedToken = await emailVerification.findOneAndUpdate(
    {
      user: userId,
      $or: [
        { updatedAt: { $lte: cooldownCutoff } },
        { updatedAt: { $exists: false } },
      ],
    },
    tokenUpdate,
    {
      returnDocument: "after",
      runValidators: true,
    },
  );

  if (updatedToken) {
    return {
      token,
      expiresAt,
    };
  }

  try {
    await emailVerification.create({
      user: userId,
      tokenHash: hashedToken,
      expiresAt,
    });

    return {
      token,
      expiresAt,
    };
  } catch (error) {
    const duplicateUser =
      error.code === 11000 &&
      (error.keyPattern?.user ||
        error.keyValue?.user ||
        error.message?.includes("user_1"));

    if (duplicateUser) {
      return null;
    }

    throw error;
  }
};

const resendEmailVerification = async (email) => {
  const user = await User.findOne({ email, isActive: true });

  if (!user || user.emailVerified) {
    return {
      sent: false,
      previewUrl: null,
    };
  }

  const tokenResult = await issueEmailVerificationTokenAfterCooldown(user._id);

  if (!tokenResult) {
    return {
      sent: false,
      previewUrl: null,
    };
  }

  const { messageId, previewUrl } = await sendVerificationEmail(
    user.email,
    tokenResult.token,
  );

  return {
    sent: true,
    messageId,
    previewUrl,
  };
};

module.exports = {
  issueEmailVerificationToken,
  confirmEmailAddress,
  resendEmailVerification,
};
