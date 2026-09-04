const {
  requestOtpCode: requestOtpCodeService,
} = require("../services/otp.service");

exports.requestOtp = async (req, res, next) => {
  try {
    const { email } = req.validatedBody;
    const result = await requestOtpCodeService(email);

    if (result.status !== "accepted") {
      throw new Error("Unexpected OTP request service status.");
    }

    if (result.previewUrl) {
      console.log(`OTP email preview: ${result.previewUrl}`);
    }

    return res.status(200).json({
      detail:
        "If an account exists for that address, a sign-in code has been sent to it.",
    });
  } catch (error) {
    return next(error);
  }
};
