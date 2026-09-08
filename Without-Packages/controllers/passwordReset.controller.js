const AppError = require("../errors/AppError");
const {
  requestPasswordReset,
  confirmPasswordReset: confirmPasswordResetService,
} = require("../services/passwordReset.service");

exports.requestPasswordReset = async (req, res, next) => {
  try {
    const { email } = req.validatedBody;
    const result = await requestPasswordReset(email);

    if (result.status !== "accepted") {
      throw new Error("Unexpected password_reset service status.");
    }

    if (result.previewUrl) {
      console.log(`Reset-Password preview: ${result.previewUrl}`);
    }

    res.status(200).json({
      detail: "Password reset e-mail has been sent.",
    });
  } catch (error) {
    next(error);
  }
};

exports.confirmPasswordReset = async (req, res, next) => {
  try {
    const { uid, token, new_password } = req.validatedBody;
    const result = await confirmPasswordResetService(uid, token, new_password);

    if (result.status === "uid_invalid" || result.status === "token_invalid") {
      const field = result.status === "uid_invalid" ? "uid" : "token";

      throw new AppError("Validation failed.", 400, "validation_error", {
        [field]: [
          {
            code: "invalid",
            message: "Invalid value",
          },
        ],
      });
    }

    if (result.status !== "reset") {
      throw new Error("Unexpected password reset confirmation service status.");
    }

    if (result.previewUrl) {
      console.log(`Password-change email preview: ${result.previewUrl}`);
    }

    return res.status(200).json({
      detail: "Password has been reset with the new password.",
    });
  } catch (error) {
    return next(error);
  }
};
