const express = require("express");
const emailChangeController = require("../controllers/emailChange.controller");
const createRequestThrottle = require("../middlewares/requestThrottle.middleware");
const requireAccessToken = require("../middlewares/accessAuth.middleware");
const validateRequest = require("../middlewares/validation.middleware");
const validateEmailChangeRequest = require("../validators/emailChangeRequest.validator");
const validateEmailChangeConfirm = require("../validators/emailChangeConfirm.validator");

const router = express.Router();

const emailChangeRequestThrottle = createRequestThrottle({
  scope: "email-change-request:v1",
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
});

const emailChangeConfirmThrottle = createRequestThrottle({
  scope: "email-change-confirm:v1",
  maxRequests: 10,
  windowMs: 60 * 60 * 1000,
});

router.post(
  "/change",
  emailChangeRequestThrottle,
  requireAccessToken,
  validateRequest(validateEmailChangeRequest),
  emailChangeController.requestEmailChange,
);

router.post(
  "/change/confirm",
  emailChangeConfirmThrottle,
  validateRequest(validateEmailChangeConfirm),
  emailChangeController.confirmEmailChange,
);

module.exports = router;
