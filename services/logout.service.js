const { verifyJwt } = require("../utils/jwt.utils");
const { hashToken } = require("../utils/token.utils");
const RefreshSession = require("../models/refreshSession.model");

const revokeRefreshToken = async (refresh) => {
  const refreshMissing =
    refresh === null || refresh === undefined || refresh === "";
  if (refreshMissing) {
    return { status: "refresh_missing" };
  }

  const session = verifyJwt(refresh, "refresh");
  if (session === null) {
    return { status: "token_not_valid" };
  }

  const hashJti = hashToken(session.jti);

  const logoutUpdate = await RefreshSession.findOneAndUpdate(
    {
      jtiHash: hashJti,
      revokedAt: null,
      $expr: {
        $and: [
          { $gt: ["$expiresAt", "$$NOW"] },
          {
            $eq: [{ $toString: "$user" }, { $literal: session.sub }],
          },
        ],
      },
    },
    {
      $currentDate: {
        revokedAt: true,
        updatedAt: true,
      },
    },
    {
      returnDocument: "after",
      runValidators: true,
      upsert: false,
      timestamps: false,
    },
  );

  if (!logoutUpdate) {
    return { status: "token_not_valid" };
  }

  return { status: "logged_out" };
};

module.exports = { revokeRefreshToken };
