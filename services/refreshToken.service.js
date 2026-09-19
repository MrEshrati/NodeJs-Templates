const { verifyJwt } = require("../utils/jwt.utils");
const { hashToken } = require("../utils/token.utils");
const RefreshSession = require("../models/refreshSession.model");
const User = require("../models/user.model");
const { createTokenPair } = require("./token.service");

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

const rotateRefreshToken = async (refresh) => {
  const result = await inspectRefreshToken(refresh);
  if (result.status !== "ready") {
    return result;
  }

  const session = result.session;
  const { tokens, sessionData } = createTokenPair(session.user);
  const refreshUpdate = await RefreshSession.findOneAndUpdate(
    {
      _id: session._id,
      user: session.user,
      jtiHash: session.jtiHash,
      revokedAt: null,
      $expr: {
        $gt: ["$expiresAt", "$$NOW"],
      },
    },
    {
      $set: {
        jtiHash: sessionData.jtiHash,
        expiresAt: sessionData.expiresAt,
      },
    },
    {
      returnDocument: "after",
      runValidators: true,
      upsert: false,
    },
  );

  if (!refreshUpdate) {
    return { status: "token_not_valid" };
  }

  return {
    status: "refreshed",
    tokens,
  };
};

module.exports = {
  inspectRefreshToken,
  rotateRefreshToken,
};
