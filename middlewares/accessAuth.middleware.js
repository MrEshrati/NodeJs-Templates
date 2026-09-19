const AppError = require("../errors/AppError");
const { authenticateAccessToken } = require("../services/accessAuth.service");

const requireAccessToken = async (req, res, next) => {
  try {
    const header = req.get("authorization");
    if (typeof header !== "string" || header.trim() === "") {
      throw new AppError(
        "Authentication credentials were not provided.",
        401,
        "not_authenticated",
      );
    }

    const match = header.match(/^Bearer +([^\s,]+)$/i);
    if (!match) {
      throw new AppError(
        "Given token not valid for any token type",
        401,
        "token_not_valid",
      );
    }

    const token = match[1];
    const result = await authenticateAccessToken(token);
    if (result.status === "token_not_valid") {
      throw new AppError(
        "Given token not valid for any token type",
        401,
        "token_not_valid",
      );
    }

    if (result.status === "user_inactive") {
      throw new AppError("User is inactive", 401, "user_inactive");
    }

    if (result.status !== "authenticated") {
      throw new Error("Unexpected status.");
    }

    req.user = result.user;
    return next();
  } catch (error) {
    return next(error);
  }
};

module.exports = requireAccessToken;
