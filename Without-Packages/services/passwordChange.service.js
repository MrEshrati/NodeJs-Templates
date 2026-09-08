const bcrypt = require("bcrypt");
const User = require("../models/user.model");

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

module.exports = { reauthenticateForPasswordChange };
