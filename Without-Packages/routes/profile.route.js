const express = require("express");
const profileController = require("../controllers/profile.controller");
const requireAccessToken = require("../middlewares/accessAuth.middleware");
const createRequestThrottle = require("../middlewares/requestThrottle.middleware");

const router = express.Router();

const profileRetrievalThrottle = createRequestThrottle({
  scope: "profile-retrieval:v1",
  maxRequests: 10,
  windowMs: 60 * 1000,
});

router.get(
  "/",
  profileRetrievalThrottle,
  requireAccessToken,
  profileController.getProfile,
);

module.exports = router;
