const mongoose = require("mongoose");
const bcrypt = require("bcrypt");
const tokenGenerator = require("../utils/token.utils");
const PasswordResetToken = require("../models/passwordResetToken.model");
const User = require("../models/user.model");
const RefreshSession = require("../models/refreshSession.model");
const {
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
} = require("./email.service");
const {
  ACCOUNT_EMAIL_JOB_TYPES,
  enqueueAccountEmailJob,
} = require("./accountEmailJob.service");

const PASSWORD_RESET_TOKEN_TTL_MS = 60 * 60 * 1000;
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
      returnDocument: "after",
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
  await enqueueAccountEmailJob(
    ACCOUNT_EMAIL_JOB_TYPES.PASSWORD_RESET,
    email,
  );

  return { status: "accepted" };
};

const deliverPasswordResetEmail = async (email) => {
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

  const issuedToken = await issuePasswordResetTokenAfterCooldown(user._id);

  if (issuedToken === null) {
    return {
      status: "discarded",
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
    status: "sent",
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

const applyPasswordReset = async (user, passwordHash, session) => {
  if (
    !session ||
    typeof session.inTransaction !== "function" ||
    session.inTransaction() !== true
  ) {
    throw new Error("An active transaction is required.");
  }

  if (
    !user ||
    user._id === undefined ||
    user._id === null ||
    typeof user.email !== "string" ||
    user.email.trim() === "" ||
    (user.password !== null && typeof user.password !== "string")
  ) {
    throw new TypeError("An inspected user record is required.");
  }

  if (typeof passwordHash !== "string" || passwordHash.trim() === "") {
    throw new TypeError("passwordHash must be a non-empty string.");
  }

  const userUpdate = await User.updateOne(
    {
      _id: user._id,
      email: user.email,
      password: user.password,
      isActive: true,
    },
    {
      $set: { password: passwordHash },
    },
    {
      session,
      upsert: false,
      runValidators: true,
    },
  );

  if (userUpdate.matchedCount !== 1) {
    // Throw so the caller's transaction also rolls back token consumption.
    const error = new Error("Password reset state changed.");
    error.code = "password_reset_conflict";
    throw error;
  }

  await RefreshSession.updateMany(
    {
      user: user._id,
      revokedAt: null,
    },
    {
      $currentDate: {
        revokedAt: true,
        updatedAt: true,
      },
    },
    {
      session,
      upsert: false,
      timestamps: false,
    },
  );

  return { status: "updated" };
};

const confirmPasswordReset = async (uid, token, newPassword) => {
  const inspection = await inspectPasswordResetToken(uid, token);

  if (
    inspection.status === "uid_invalid" ||
    inspection.status === "token_invalid"
  ) {
    return inspection;
  }

  if (inspection.status !== "candidate") {
    throw new Error("Unexpected password reset inspection status.");
  }

  const { user, resetToken } = inspection;
  const passwordHash = await bcrypt.hash(newPassword, 12);
  let transactionResult;

  try {
    transactionResult = await mongoose.connection.transaction(async (session) => {
      const consumption = await consumePasswordResetToken(resetToken, session);

      if (consumption.status === "token_invalid") {
        return consumption;
      }

      if (consumption.status !== "consumed") {
        throw new Error("Unexpected password reset token consumption status.");
      }

      const update = await applyPasswordReset(user, passwordHash, session);

      if (update.status !== "updated") {
        throw new Error("Unexpected password reset update status.");
      }

      return { status: "reset" };
    });
  } catch (error) {
    if (error?.code !== "password_reset_conflict") {
      throw error;
    }

    const activeUser = await User.exists({ _id: user._id, isActive: true });

    return { status: activeUser ? "token_invalid" : "uid_invalid" };
  }

  if (transactionResult.status === "token_invalid") {
    return transactionResult;
  }

  if (transactionResult.status !== "reset") {
    throw new Error("Unexpected password reset transaction status.");
  }

  // Send only after commit: the transaction callback may run more than once.
  try {
    const emailResult = await sendPasswordChangedEmail(user.email);

    return {
      status: "reset",
      notificationSent: true,
      messageId: emailResult.messageId,
      previewUrl: emailResult.previewUrl,
    };
  } catch {
    console.error(
      "Password reset succeeded, but the notification email could not be sent.",
    );

    return {
      status: "reset",
      notificationSent: false,
      messageId: null,
      previewUrl: null,
    };
  }
};

module.exports = {
  issuePasswordResetTokenAfterCooldown,
  requestPasswordReset,
  deliverPasswordResetEmail,
  inspectPasswordResetToken,
  consumePasswordResetToken,
  applyPasswordReset,
  confirmPasswordReset,
};
