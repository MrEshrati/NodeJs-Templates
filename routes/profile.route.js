const express = require("express");
const profileController = require("../controllers/profile.controller");
const requireAccessToken = require("../middlewares/accessAuth.middleware");
const createRequestThrottle = require("../middlewares/requestThrottle.middleware");
const validateRequest = require("../middlewares/validation.middleware");
const validateProfileUpdate = require("../validators/profileUpdate.validator");

const AppError = require("../errors/AppError");
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

const rejectProfilePut = (req, res, next) => {
  res.setHeader("Allow", "GET, PATCH");

  return next(
    new AppError(
      `Method "${req.method}" not allowed.`,
      405,
      "method_not_allowed",
    ),
  );
};

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

router.put(
  "/",
  profileModificationThrottle,
  requireAccessToken,
  rejectProfilePut,
);

module.exports = router;
