const bcrypt = require("bcrypt");
const User = require("../models/user.model");
const { consumeOtpCode } = require("./otp.service");
const RefreshSession = require("../models/refreshSession.model");

const reauthenticateForDeletion = async (userId, credentials = {}) => {
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
    if (
      typeof password !== "string" ||
      password === "" ||
      Buffer.byteLength(password, "utf8") > 72
    ) {
      return { status: "reauth_failed" };
    }

    const passCompare = await bcrypt.compare(password, user.password);
    if (!passCompare) {
      return { status: "reauth_failed" };
    }
  } else {
    const code = credentials?.code;

    if (typeof code !== "string" || code === "") {
      return { status: "reauth_failed" };
    }

    const result = await consumeOtpCode(user._id, code);

    if (result.status !== "consumed") {
      return { status: "reauth_failed" };
    }
  }

  return { status: "reauthenticated", user };
};

const deactivateAccount = async (user) => {
  const userUpdate = await User.updateOne(
    {
      _id: user._id,
      email: user.email,
      password: user.password,
      isActive: true,
    },
    {
      $set: { isActive: false },
    },
    {
      upsert: false,
      runValidators: true,
    },
  );

  if (userUpdate.matchedCount !== 1) {
    return { status: "user_inactive" };
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
      upsert: false,
      timestamps: false,
    },
  );

  return { status: "deleted" };
};

const deleteAccount = async (userId, credentials = {}) => {
  const reauthentication = await reauthenticateForDeletion(
    userId,
    credentials,
  );

  if (reauthentication.status !== "reauthenticated") {
    return reauthentication;
  }

  return deactivateAccount(reauthentication.user);
};

module.exports = { reauthenticateForDeletion, deactivateAccount, deleteAccount };
