const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const otpController = require("../controllers/otp.controller");

const validateRequest = require("../middlewares/validation.middleware");
const createRequestThrottle = require("../middlewares/requestThrottle.middleware");

const registerRequestThrottle = createRequestThrottle({
  scope: "token-register:v1",
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
});

const loginRequestThrottle = createRequestThrottle({
  scope: "token-login:v1",
  maxRequests: 10,
  windowMs: 60 * 1000,
});

const verifyEmailRequestThrottle = createRequestThrottle({
  scope: "token-verify-email:v1",
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
});

const resendVerificationRequestThrottle = createRequestThrottle({
  scope: "token-resend-verification:v1",
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
});

const refreshRequestThrottle = createRequestThrottle({
  scope: "token-refresh:v1",
  maxRequests: 10,
  windowMs: 60 * 1000,
});

const logoutRequestThrottle = createRequestThrottle({
  scope: "logout:v1",
  maxRequests: 10,
  windowMs: 60 * 1000,
});
const otpRequestThrottle = createRequestThrottle({
  scope: "otp-request:v1",
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
});

const validateRegistration = require("../validators/register.validator");
const validateVerifyEmail = require("../validators/verifyEmail.validator");
const validateResendVerifyEmail = require("../validators/resendVerification.validator");
const validateLogin = require("../validators/login.validator");
const validateRefreshToken = require("../validators/refreshToken.validator");
const validateOtpRequest = require("../validators/otpRequest.validator");

router.post(
  "/register",
  registerRequestThrottle,
  validateRequest(validateRegistration),
  authController.SignUp,
);

router.post(
  "/verify-email",
  verifyEmailRequestThrottle,
  validateRequest(validateVerifyEmail),
  authController.verifyEmail,
);

router.post(
  "/resend-verification",
  resendVerificationRequestThrottle,
  validateRequest(validateResendVerifyEmail),
  authController.resendVerification,
);

router.post(
  "/login",
  loginRequestThrottle,
  validateRequest(validateLogin),
  authController.login,
);

router.post(
  "/token/refresh",
  refreshRequestThrottle,
  validateRequest(validateRefreshToken),
  authController.refreshToken,
);

router.post("/logout", logoutRequestThrottle, authController.logout);

router.post(
  "/otp/request",
  otpRequestThrottle,
  validateRequest(validateOtpRequest),
  otpController.requestOtp,
);

module.exports = router;
