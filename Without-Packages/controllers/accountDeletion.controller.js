const AppError = require("../errors/AppError");
const {
  deleteAccount: deleteAccountService,
} = require("../services/accountDeletion.service");

exports.deleteAccount = async (req, res, next) => {
  try {
    const result = await deleteAccountService(
      req.user._id,
      req.validatedBody,
    );

    if (result.status === "reauth_failed") {
      throw new AppError("Validation failed.", 400, "validation_error", {
        password: [
          {
            code: "reauth_required",
            message: "Incorrect password.",
          },
        ],
      });
    }

    if (result.status === "user_inactive") {
      throw new AppError("User is inactive", 401, "user_inactive");
    }

    if (result.status !== "deleted") {
      throw new Error("Unexpected account deletion service status.");
    }

    return res.status(204).end();
  } catch (error) {
    return next(error);
  }
};