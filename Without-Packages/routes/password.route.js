const express = require("express");
const passwordResetController = require("../controllers/passwordReset.controller");
const createRequestThrottle = require("../middlewares/requestThrottle.middleware");
const validateRequest = require("../middlewares/validation.middleware");
const validateResetPassword = require("../validators/passwordResetRequest.validator");
const validatePasswordResetConfirm = require("../validators/passwordResetConfirm.validator");

const router = express.Router();

const passwordResetThrottle = createRequestThrottle({
  scope: "password-reset-request:v1",
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
});

const passwordResetConfirmThrottle = createRequestThrottle({
  scope: "password-reset-confirm:v1",
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
});

router.post(
  "/reset",
  passwordResetThrottle,
  validateRequest(validateResetPassword),
  passwordResetController.requestPasswordReset,
);

router.post(
  "/reset/confirm",
  passwordResetConfirmThrottle,
  validateRequest(validatePasswordResetConfirm),
  passwordResetController.confirmPasswordReset,
);

module.exports = router;
