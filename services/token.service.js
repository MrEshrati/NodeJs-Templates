const { createJwt } = require("../utils/jwt.utils");
const { hashToken } = require("../utils/token.utils");
const refreshSession = require("../models/refreshSession.model");

const ACCESS_TOKEN_TTL_SECONDS = 10 * 60;
const REFRESH_TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;

const issueTokenPair = async (userId) => {
  const { tokens, sessionData } = createTokenPair(userId);
  await refreshSession.create({
    user: userId,
    ...sessionData,
  });

  return tokens;
};

const createTokenPair = (userId) => {
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

  return {
    tokens: {
      access: accessResult.token,
      refresh: refreshResult.token,
    },
    sessionData: {
      jtiHash,
      expiresAt: refreshResult.expiresAt,
    },
  };
};

module.exports = {
  createTokenPair,
  issueTokenPair,
};
