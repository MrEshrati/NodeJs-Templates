const express = require("express");
const notificationController = require("../controllers/notification.controller");
const requireAccessToken = require("../middlewares/accessAuth.middleware");
const createRequestThrottle = require("../middlewares/requestThrottle.middleware");
const validateQuery = require("../middlewares/queryValidation.middleware");
const validateRequest = require("../middlewares/validation.middleware");
const validateNotificationList = require("../validators/notificationList.validator");
const validateNotificationPreference = require(
  "../validators/notificationPreference.validator",
);

const AppError = require("../errors/AppError");
const router = express.Router();

const notificationThrottle = createRequestThrottle({
  scope: "notifications:v1",
  maxRequests: 120,
  windowMs: 60 * 1000,
});

const rejectPreferencePut = (req, res, next) => {
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
  "/preferences",
  notificationThrottle,
  requireAccessToken,
  notificationController.getNotificationPreferences,
);

router.patch(
  "/preferences",
  notificationThrottle,
  requireAccessToken,
  validateRequest(validateNotificationPreference),
  notificationController.updateNotificationPreferences,
);

router.put(
  "/preferences",
  notificationThrottle,
  requireAccessToken,
  rejectPreferencePut,
);

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

router.post(
  "/read-all",
  notificationThrottle,
  requireAccessToken,
  notificationController.markAllRead,
);

router.post(
  "/:notificationId/read",
  notificationThrottle,
  requireAccessToken,
  notificationController.markNotificationRead,
);

router.delete(
  "/:notificationId",
  notificationThrottle,
  requireAccessToken,
  notificationController.deleteNotification,
);

module.exports = router;
