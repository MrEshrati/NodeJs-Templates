const express = require("express");
const notificationController = require("../controllers/notification.controller");
const requireAccessToken = require("../middlewares/accessAuth.middleware");
const createRequestThrottle = require("../middlewares/requestThrottle.middleware");
const validateQuery = require("../middlewares/queryValidation.middleware");
const validateNotificationList = require("../validators/notificationList.validator");

const router = express.Router();

const notificationThrottle = createRequestThrottle({
  scope: "notifications:v1",
  maxRequests: 120,
  windowMs: 60 * 1000,
});

router.get(
  "/",
  notificationThrottle,
  requireAccessToken,
  validateQuery(validateNotificationList),
  notificationController.listNotifications,
);

router.get(
  "/unread-count",
  notificationThrottle,
  requireAccessToken,
  notificationController.getUnreadCount,
);

module.exports = router;
