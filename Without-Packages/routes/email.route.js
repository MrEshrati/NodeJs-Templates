const express = require("express");
const emailChangeController = require("../controllers/emailChange.controller");
const createRequestThrottle = require("../middlewares/requestThrottle.middleware");
const requireAccessToken = require("../middlewares/accessAuth.middleware");
const validateRequest = require("../middlewares/validation.middleware");
const validateEmailChangeRequest = require("../validators/emailChangeRequest.validator");

const router = express.Router();

const emailChangeRequestThrottle = createRequestThrottle({
  scope: "email-change-request:v1",
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

module.exports = router;
