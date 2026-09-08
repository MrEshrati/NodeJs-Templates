const bcrypt = require("bcrypt");
const User = require("../models/user.model");
const RefreshSession = require("../models/refreshSession.model");

const reauthenticateForPasswordChange = async (userId, oldPassword) => {
  const user = await User.findOne({ _id: userId, isActive: true })
    .select("_id email password")
    .lean();

  if (!user) {
    return { status: "user_inactive" };
  }

  const hasStoredPassword =
    typeof user.password === "string" && user.password.length > 0;
  const validOldPassword =
    typeof oldPassword === "string" &&
    oldPassword !== "" &&
    Buffer.byteLength(oldPassword, "utf8") <= 72;

  if (!hasStoredPassword || !validOldPassword) {
    return { status: "old_password_invalid" };
  }

  const passwordMatches = await bcrypt.compare(oldPassword, user.password);

  if (!passwordMatches) {
    return { status: "old_password_invalid" };
  }

  return { status: "reauthenticated", user };
};

const applyPasswordChange = async (user, passwordHash, session) => {
  if (
    !session ||
    typeof session.inTransaction !== "function" ||
    session.inTransaction() !== true
  ) {
    throw new Error("An active transaction is required");
  }

  if (
    !user ||
    user._id === undefined ||
    user._id === null ||
    typeof user.email !== "string" ||
    user.email.trim() === "" ||
    typeof user.password !== "string" ||
    user.password === ""
  ) {
    throw new TypeError("A reauthenticated user record is required.");
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
      $set: {
        password: passwordHash,
      },
    },
    {
      session,
      upsert: false,
      runValidators: true,
    },
  );

  if (userUpdate.matchedCount !== 1) {
    const error = new Error("Password change state changed.");
    error.code = "password_change_conflict";
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

module.exports = {
  reauthenticateForPasswordChange,
  applyPasswordChange,
};
