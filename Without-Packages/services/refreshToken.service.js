const { verifyJwt } = require("../utils/jwt.utils");
const { hashToken } = require("../utils/token.utils");
const RefreshSession = require("../models/refreshSession.model");
const User = require("../models/user.model");

const inspectRefreshToken = async (refresh) => {
  const payload = await verifyJwt(refresh, "refresh");
  if (payload === null) {
    return { status: "token_not_valid" };
  }

  const hashJti = hashToken(payload.jti);

  const session = await RefreshSession.findOne({
    jtiHash: hashJti,
    revokedAt: null,
    expiresAt: {
      $gt: Date.now(),
    },
  });

  if (!session || String(session.user) !== payload.sub) {
    return { status: "token_not_valid" };
  }

  const activeUser = await User.exists({
    _id: session.user,
    isActive: true,
  });

  if (!activeUser) {
    return { status: "no_active_account" };
  }

  return {
    status: "ready",
    session,
  };
};

module.exports = { inspectRefreshToken };