const bcrypt = require("bcrypt");
const tokenGenerator = require("../utils/token.utils");
const User = require("../models/user.model");
const EmailChangeToken = require("../models/emailChangeToken.model");
const { consumeOtpCode } = require("./otp.service");
const { sendEmailChangeConfirmationEmail } = require("./email.service");

const EMAIL_CHANGE_TOKEN_TTL_MS = 60 * 60 * 1000;
const EMAIL_CHANGE_SEND_COOLDOWN_MS = 3 * 60 * 1000;

const reauthenticateForEmailChange = async (userId, credentials = {}) => {
  const user = await User.findOne({ _id: userId, isActive: true })
    .select("_id email password")
    .lean();

  if (!user) {
    return { status: "user_inactive" };
  }

  const hasStoredPassword =
    typeof user.password === "string" && user.password.length > 0;

  if (hasStoredPassword) {
    const password = credentials?.password;
    const validPassword =
      typeof password === "string" &&
      password !== "" &&
      Buffer.byteLength(password, "utf8") <= 72;

    if (!validPassword) {
      return { status: "password_invalid" };
    }

    const passwordMatches = await bcrypt.compare(password, user.password);

    if (!passwordMatches) {
      return { status: "password_invalid" };
    }
  } else {
    const code = credentials?.code;

    if (typeof code !== "string" || code === "") {
      return { status: "code_invalid" };
    }

    const otpResult = await consumeOtpCode(user._id, code);

    if (otpResult.status !== "consumed") {
      return { status: "code_invalid" };
    }
  }

  return { status: "reauthenticated", user };
};

const checkEmailChangeAvailability = async (userId, newEmail) => {
  const now = new Date();
  const [loginEmailInUse, reservedByAnotherUser] = await Promise.all([
    User.exists({ email: newEmail }),
    EmailChangeToken.exists({
      user: { $ne: userId },
      newEmail,
      expiresAt: { $gt: now },
    }),
  ]);

  if (loginEmailInUse || reservedByAnotherUser) {
    return { status: "unavailable" };
  }

  return { status: "available" };
};

const issueEmailChangeTokenAfterCooldown = async (user, newEmail) => {
  const token = tokenGenerator.generateToken();
  const tokenHash = tokenGenerator.hashToken(token);
  const now = new Date();
  const expiresAt = new Date(now.getTime() + EMAIL_CHANGE_TOKEN_TTL_MS);
  const cooldownCutoff = new Date(
    now.getTime() - EMAIL_CHANGE_SEND_COOLDOWN_MS,
  );
  const tokenData = {
    user: user._id,
    oldEmail: user.email,
    newEmail,
    tokenHash,
    expiresAt,
  };

  await EmailChangeToken.init();
  await EmailChangeToken.deleteOne({
    newEmail,
    expiresAt: { $lte: now },
  });

  try {
    const updatedToken = await EmailChangeToken.findOneAndUpdate(
      {
        user: user._id,
        $or: [
          { newEmail: { $ne: newEmail } },
          { updatedAt: { $lte: cooldownCutoff } },
          { updatedAt: { $exists: false } },
        ],
      },
      {
        $set: {
          oldEmail: tokenData.oldEmail,
          newEmail: tokenData.newEmail,
          tokenHash: tokenData.tokenHash,
          expiresAt: tokenData.expiresAt,
        },
      },
      {
        new: true,
        runValidators: true,
      },
    );

    if (updatedToken) {
      return {
        status: "issued",
        token,
        tokenHash,
        expiresAt,
      };
    }

    await EmailChangeToken.create(tokenData);

    return {
      status: "issued",
      token,
      tokenHash,
      expiresAt,
    };
  } catch (error) {
    const duplicatePendingChange =
      error?.code === 11000 &&
      (error.keyPattern?.user === 1 ||
        error.keyPattern?.newEmail === 1 ||
        Object.prototype.hasOwnProperty.call(error.keyValue ?? {}, "user") ||
        Object.prototype.hasOwnProperty.call(
          error.keyValue ?? {},
          "newEmail",
        ) ||
        error.message?.includes("user_1") ||
        error.message?.includes("newEmail_1"));

    if (duplicatePendingChange) {
      return { status: "not_issued" };
    }

    throw error;
  }
};

const requestEmailChange = async (
  userId,
  newEmail,
  credentials = {},
) => {
  const reauthentication = await reauthenticateForEmailChange(
    userId,
    credentials,
  );

  if (
    reauthentication.status === "password_invalid" ||
    reauthentication.status === "code_invalid" ||
    reauthentication.status === "user_inactive"
  ) {
    return reauthentication;
  }

  if (reauthentication.status !== "reauthenticated") {
    throw new Error("Unexpected email change reauthentication status.");
  }

  const { user } = reauthentication;
  const availability = await checkEmailChangeAvailability(user._id, newEmail);

  if (availability.status === "unavailable") {
    return {
      status: "accepted",
      sent: false,
      previewUrl: null,
    };
  }

  if (availability.status !== "available") {
    throw new Error("Unexpected email change availability status.");
  }

  const issuedToken = await issueEmailChangeTokenAfterCooldown(user, newEmail);

  if (issuedToken.status === "not_issued") {
    return {
      status: "accepted",
      sent: false,
      previewUrl: null,
    };
  }

  if (issuedToken.status !== "issued") {
    throw new Error("Unexpected email change token issuance status.");
  }

  let emailResult;

  try {
    emailResult = await sendEmailChangeConfirmationEmail(
      newEmail,
      issuedToken.token,
    );
  } catch (error) {
    try {
      await EmailChangeToken.deleteOne({
        user: user._id,
        newEmail,
        tokenHash: issuedToken.tokenHash,
        expiresAt: issuedToken.expiresAt,
      });
    } catch {
      console.error(
        "Email change delivery failed, and its token could not be removed.",
      );
    }

    throw error;
  }

  return {
    status: "accepted",
    sent: true,
    messageId: emailResult.messageId,
    previewUrl: emailResult.previewUrl,
  };
};

module.exports = {
  reauthenticateForEmailChange,
  checkEmailChangeAvailability,
  issueEmailChangeTokenAfterCooldown,
  requestEmailChange,
};
