const tokenGenerator = require("../utils/token.utils");
const PasswordResetToken = require("../models/passwordResetToken.model");
const User = require("../models/user.model");
const { sendPasswordResetEmail } = require("./email.service");

const PASSWORD_RESET_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_SEND_COOLDOWN_MS = 3 * 60 * 1000;

const issuePasswordResetTokenAfterCooldown = async (userId) => {
  const token = tokenGenerator.generateToken();
  const tokenHash = tokenGenerator.hashToken(token);
  const now = Date.now();
  const expiresAt = new Date(now + PASSWORD_RESET_TOKEN_TTL_MS);
  const cooldownCutoff = new Date(now - PASSWORD_RESET_SEND_COOLDOWN_MS);

  const updatedToken = await PasswordResetToken.findOneAndUpdate(
    {
      user: userId,
      $or: [
        { updatedAt: { $lte: cooldownCutoff } },
        { updatedAt: { $exists: false } },
      ],
    },
    {
      $set: {
        tokenHash,
        expiresAt,
      },
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (updatedToken) {
    return {
      token,
      tokenHash,
      expiresAt,
    };
  }

  try {
    await PasswordResetToken.create({
      user: userId,
      tokenHash,
      expiresAt,
    });

    return {
      token,
      tokenHash,
      expiresAt,
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

const requestPasswordReset = async (email) => {
  const user = await User.findOne({
    email,
    isActive: true,
  })
    .select("_id email")
    .lean();

  if (!user) {
    return {
      status: "accepted",
      sent: false,
      previewUrl: null,
    };
  }

  const issuedToken = await issuePasswordResetTokenAfterCooldown(user._id);

  if (issuedToken === null) {
    return {
      status: "accepted",
      sent: false,
      previewUrl: null,
    };
  }

  let emailResult;

  try {
    emailResult = await sendPasswordResetEmail(
      user.email,
      user._id,
      issuedToken.token,
    );
  } catch (error) {
    await PasswordResetToken.deleteOne({
      user: user._id,
      tokenHash: issuedToken.tokenHash,
      expiresAt: issuedToken.expiresAt,
    });

    throw error;
  }

  return {
    status: "accepted",
    sent: true,
    messageId: emailResult.messageId,
    previewUrl: emailResult.previewUrl,
  };
};

const inspectPasswordResetToken = async (uid, token) => {
  if (typeof uid !== "string" || !/^[a-fA-F0-9]{24}$/.test(uid.trim())) {
    return { status: "uid_invalid" };
  }

  const user = await User.findOne({ _id: uid.trim(), isActive: true })
    .select("_id email password")
    .lean();

  if (!user) {
    return { status: "uid_invalid" };
  }

  if (typeof token !== "string" || token.trim() === "") {
    return { status: "token_invalid" };
  }

  const hashedToken = tokenGenerator.hashToken(token);
  const resetToken = await PasswordResetToken.findOne({
    user: user._id,
    tokenHash: hashedToken,
    $expr: { $gt: ["$expiresAt", "$$NOW"] },
  })
    .select("_id user tokenHash expiresAt")
    .lean();

  if (!resetToken) {
    return { status: "token_invalid" };
  }

  return { status: "candidate", user, resetToken };
};

const consumePasswordResetToken = async (resetToken, session) => {
  if (
    !session ||
    typeof session.inTransaction !== "function" ||
    session.inTransaction() !== true
  ) {
    throw new Error("An active transaction is required.");
  }

  if (
    !resetToken ||
    resetToken._id === undefined ||
    resetToken._id === null ||
    resetToken.user === undefined ||
    resetToken.user === null ||
    typeof resetToken.tokenHash !== "string" ||
    resetToken.tokenHash === "" ||
    !(resetToken.expiresAt instanceof Date) ||
    !Number.isFinite(resetToken.expiresAt.getTime())
  ) {
    throw new TypeError("An inspected password reset token is required.");
  }

  // The caller commits this deletion together with the password and session updates.
  const deletedToken = await PasswordResetToken.findOneAndDelete(
    {
      _id: resetToken._id,
      user: resetToken.user,
      tokenHash: resetToken.tokenHash,
      expiresAt: resetToken.expiresAt,
      $expr: { $gt: ["$expiresAt", "$$NOW"] },
    },
    { session },
  )
    .select("_id")
    .lean();

  if (!deletedToken) {
    return { status: "token_invalid" };
  }

  return { status: "consumed" };
};

module.exports = {
  issuePasswordResetTokenAfterCooldown,
  requestPasswordReset,
  inspectPasswordResetToken,
  consumePasswordResetToken,
};
