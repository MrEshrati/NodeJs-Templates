const {
  requestOtpCode: requestOtpCodeService,
  verifyOtpLogin: verifyOtpLoginService,
} = require("../services/otp.service");
const AppError = require("../errors/AppError");

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

exports.verifyOtp = async (req, res, next) => {
  try {
    const { email, code } = req.validatedBody;
    const result = await verifyOtpLoginService(email, code);

    if (result.status === "otp_invalid") {
      throw new AppError("Invalid or expired code.", 401, "otp_invalid");
    }

    if (result.status !== "authenticated") {
      throw new Error("Unexpected OTP verification service status.");
    }

    return res.status(200).json(result.tokens);
  } catch (error) {
    next(error);
  }
};
