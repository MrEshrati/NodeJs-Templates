const express = require("express");
const passwordResetController = require("../controllers/passwordReset.controller");
const createRequestThrottle = require("../middlewares/requestThrottle.middleware");
const validateRequest = require("../middlewares/validation.middleware");
const validateResetPassword = require("../validators/passwordResetRequest.validator");

const router = express.Router();

const passwordResetThrottle = createRequestThrottle({
  scope: "password-reset-request:v1",
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
});

router.post(
  "/reset",
  passwordResetThrottle,
  validateRequest(validateResetPassword),
  passwordResetController.requestPasswordReset,
);

module.exports = router;
