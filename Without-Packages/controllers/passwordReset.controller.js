const { requestPasswordReset } = require("../services/passwordReset.service");

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
