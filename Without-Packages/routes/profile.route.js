const express = require("express");
const profileController = require("../controllers/profile.controller");
const requireAccessToken = require("../middlewares/accessAuth.middleware");
const createRequestThrottle = require("../middlewares/requestThrottle.middleware");
const validateRequest = require("../middlewares/validation.middleware");
const validateProfileUpdate = require("../validators/profileUpdate.validator");

const router = express.Router();

const profileRetrievalThrottle = createRequestThrottle({
  scope: "profile-retrieval:v1",
  maxRequests: 10,
  windowMs: 60 * 1000,
});

const profileModificationThrottle = createRequestThrottle({
  scope: "profile-modification:v1",
  maxRequests: 10,
  windowMs: 60 * 1000,
});

router.get(
  "/",
  profileRetrievalThrottle,
  requireAccessToken,
  profileController.getProfile,
);

router.patch(
  "/",
  profileModificationThrottle,
  requireAccessToken,
  validateRequest(validateProfileUpdate),
  profileController.updateProfile,
);

module.exports = router;
