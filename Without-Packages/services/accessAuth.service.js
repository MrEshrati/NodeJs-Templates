const mongoose = require("mongoose");
const { verifyJwt } = require("../utils/jwt.utils");
const User = require("../models/user.model");

const authenticateAccessToken = async (token) => {
  const payload = verifyJwt(token, "access");
  if (payload === null) {
    return { status: "token_not_valid" };
  }

  if (!mongoose.isObjectIdOrHexString(payload.sub)) {
    return { status: "token_not_valid" };
  }

  const user = await User.findOne({
    _id: payload.sub,
    isActive: true,
  })
    .select("_id email firstName lastName emailVerified isActive")
    .lean();

  if (!user) {
    return { status: "user_inactive" };
  }

  return {
    status: "authenticated",
    user,
  };
};

module.exports = {
  authenticateAccessToken,
};
