const { createJwt } = require("../utils/jwt.utils");
const { hashToken } = require("../utils/token.utils");
const refreshSession = require("../models/refreshSession.model");

const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const issueTokenPair = async (userId) => {
  const accessResult = createJwt({
    userId,
    tokenType: "access",
    expiresInSeconds: ACCESS_TOKEN_TTL_SECONDS,
  });

  const refreshResult = createJwt({
    userId,
    tokenType: "refresh",
    expiresInSeconds: REFRESH_TOKEN_TTL_SECONDS,
  });

  const jtiHash = hashToken(refreshResult.jti);
  await refreshSession.create({
    user: userId,
    jtiHash,
    expiresAt: refreshResult.expiresAt,
  });

  return {
    access: accessResult.token,
    refresh: refreshResult.token,
  };
};

module.exports = {
  issueTokenPair,
};