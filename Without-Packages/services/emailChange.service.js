const bcrypt = require("bcrypt");
const User = require("../models/user.model");
const EmailChangeToken = require("../models/emailChangeToken.model");
const { consumeOtpCode } = require("./otp.service");

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

module.exports = {
  reauthenticateForEmailChange,
  checkEmailChangeAvailability,
};
