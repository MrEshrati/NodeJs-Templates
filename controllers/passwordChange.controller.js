const AppError = require("../errors/AppError");
const {
  changePassword: changePasswordService,
} = require("../services/passwordChange.service");

exports.changePassword = async (req, res, next) => {
  try {
    const { old_password, new_password } = req.validatedBody;
    const result = await changePasswordService(
      req.user._id,
      old_password,
      new_password,
    );

    if (result.status === "old_password_invalid") {
      throw new AppError("Validation failed.", 400, "validation_error", {
        old_password: [
          {
            code: "invalid",
            message:
              "Your old password was entered incorrectly. Please enter it again.",
          },
        ],
      });
    }

    if (result.status === "user_inactive") {
      throw new AppError("User is inactive", 401, "user_inactive");
    }

    if (result.status !== "changed") {
      throw new Error("Unexpected password change service status.");
    }

    if (result.previewUrl) {
      console.log(`Password-change email preview: ${result.previewUrl}`);
    }

    return res.status(200).json({
      detail: "New password has been saved.",
    });
  } catch (error) {
    return next(error);
  }
};
