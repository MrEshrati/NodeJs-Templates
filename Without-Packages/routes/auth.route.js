const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const validateRequest = require("../middlewares/validation.middleware");
const createRequestThrottle = require("../middlewares/requestThrottle.middleware");

const refreshRequestThrottle = createRequestThrottle({
  scope: "token-refresh:v1",
  maxRequests: 10,
  windowMs: 60 * 1000,
});

const validateRegistration = require("../validators/register.validator");
const validateVerifyEmail = require("../validators/verifyEmail.validator");
const validateResendVerifyEmail = require("../validators/resendVerification.validator");
const validateLogin = require("../validators/login.validator");
const validateRefreshToken = require("../validators/refreshToken.validator");

router.post(
  "/register",
  validateRequest(validateRegistration),
  authController.SignUp,
);

router.post(
  "/confirm-email",
  validateRequest(validateVerifyEmail),
  authController.verifyEmail,
);

router.post(
  "/resend-verification",
  validateRequest(validateResendVerifyEmail),
  authController.resendVerification,
);

router.post("/login", validateRequest(validateLogin), authController.login);

router.post(
  "/token/refresh",
  refreshRequestThrottle,
  validateRequest(validateRefreshToken),
  authController.refreshToken,
)

module.exports = router;
