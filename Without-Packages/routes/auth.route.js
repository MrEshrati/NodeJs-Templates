const express = require("express");
const router = express.Router();
const authController = require("../controllers/auth.controller");
const validateRequest = require("../middlewares/validation.middleware");
const validateRegistration = require("../validators/register.validator");
const validateVerifyEmail = require("../validators/verifyEmail.validator");
const validateResendVerifyEmail = require("../validators/resendVerification.validator");

router.post(
  "/register",
  validateRequest(validateRegistration),
  authController.SignUp,
);

router.post(
  "/verify-email",
  validateRequest(validateVerifyEmail),
  authController.verifyEmail,
);

router.post(
  "/resend-verification",
  validateRequest(validateResendVerifyEmail),
  authController.resendVerification,
);

module.exports = router;
