const AppError = require("../errors/AppError");
const {
  requestEmailChange: requestEmailChangeService,
  confirmEmailChange: confirmEmailChangeService,
} = require("../services/emailChange.service");

exports.requestEmailChange = async (req, res, next) => {
  try {
    const { new_email, password, code } = req.validatedBody;
    const result = await requestEmailChangeService(req.user._id, new_email, {
      password,
      code,
    });

    if (result.status === "password_invalid") {
      throw new AppError("Validation failed.", 400, "validation_error", {
        password: [
          {
            code: "reauth_required",
            message: "Incorrect password.",
          },
        ],
      });
    }

    if (result.status === "code_invalid") {
      throw new AppError("Validation failed.", 400, "validation_error", {
        code: [
          {
            code: "reauth_required",
            message: "Invalid or expired code.",
          },
        ],
      });
    }

    if (result.status === "user_inactive") {
      throw new AppError("User is inactive", 401, "user_inactive");
    }

    if (result.status !== "accepted") {
      throw new Error("Unexpected email change request status.");
    }

    if (result.previewUrl) {
      console.log(`Email-change preview: ${result.previewUrl}`);
    }

    return res.status(200).json({
      detail:
        "If that address is available, a confirmation email has been sent to it.",
    });
  } catch (error) {
    return next(error);
  }
};

exports.confirmEmailChange = async (req, res, next) => {
  try {
    const { key } = req.validatedBody;
    const result = await confirmEmailChangeService(key);

    if (result.status === "key_invalid") {
      throw new AppError("Validation failed.", 400, "validation_error", {
        key: [
          {
            code: "invalid",
            message: "Invalid or expired confirmation key.",
          },
        ],
      });
    }

    if (result.status === "unable") {
      throw new AppError(
        "Unable to confirm this email address.",
        400,
        "validation_error",
      );
    }

    if (result.status !== "changed") {
      throw new Error("Unexpected email change confirmation status.");
    }

    if (result.previewUrl) {
      console.log(
        `Email-change old-address notification preview: ${result.previewUrl}`,
      );
    }

    return res.status(200).json({
      detail: "Email address updated.",
    });
  } catch (error) {
    return next(error);
  }
};
