const AppError = require("../errors/AppError");
const {
  authenticateWithGoogle,
} = require("../services/googleAuth.service");

exports.googleLogin = async (req, res, next) => {
  try {
    const { id_token } = req.validatedBody;
    const result = await authenticateWithGoogle(id_token);

    if (result.status === "authentication_failed") {
      throw new AppError(
        "Invalid or expired Google ID token.",
        401,
        "authentication_failed",
      );
    }

    if (result.status === "social_email_unverified") {
      throw new AppError(
        "Google has not verified the email address on this account.",
        401,
        "social_email_unverified",
      );
    }

    if (result.status === "user_inactive") {
      throw new AppError(
        "User account is disabled.",
        401,
        "user_inactive",
      );
    }

    if (result.status !== "authenticated") {
      throw new Error("Unexpected Google authentication status.");
    }

    return res.status(200).json({
      access: result.tokens.access,
      refresh: result.tokens.refresh,
      created: result.created,
    });
  } catch (error) {
    return next(error);
  }
};
