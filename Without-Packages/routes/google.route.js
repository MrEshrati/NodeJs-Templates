const express = require("express");
const googleAuthController = require("../controllers/googleAuth.controller");
const createRequestThrottle = require("../middlewares/requestThrottle.middleware");
const validateRequest = require("../middlewares/validation.middleware");
const validateGoogleLogin = require("../validators/googleLogin.validator");

const router = express.Router();

const googleAuthThrottle = createRequestThrottle({
  scope: "google-auth:v1",
  maxRequests: 10,
  windowMs: 60 * 1000,
});

router.post(
  "/",
  googleAuthThrottle,
  validateRequest(validateGoogleLogin),
  googleAuthController.googleLogin,
);

module.exports = router;
