const AppError = require("../errors/AppError");
const {
  markAllNotificationsRead: markAllNotificationsReadService,
  markNotificationRead: markNotificationReadService,
} = require("../services/notificationAction.service");
const {
  getUnreadNotificationCount: getUnreadNotificationCountService,
  listNotifications: listNotificationsService,
} = require("../services/notificationFeed.service");
const {
  serializeNotification,
} = require("../utils/notification.utils");

const DEFAULT_PAGE_SIZE = 20;

const createPaginationUrl = (
  req,
  { cursor, unread = false, pageSize = DEFAULT_PAGE_SIZE },
) => {
  if (cursor === null) {
    return null;
  }

  const url = new URL(
    req.originalUrl,
    `${req.protocol}://${req.get("host")}`,
  );

  url.search = "";

  if (unread === true) {
    url.searchParams.set("unread", "true");
  }

  if (pageSize !== DEFAULT_PAGE_SIZE) {
    url.searchParams.set("page_size", String(pageSize));
  }

  url.searchParams.set("cursor", cursor);

  return url.toString();
};

exports.listNotifications = async (req, res, next) => {
  try {
    const { unread, pageSize, cursor } = req.validatedQuery;
    const result = await listNotificationsService({
      userId: req.user._id,
      unread,
      pageSize,
      cursor,
    });

    if (result?.status === "invalid_cursor") {
      throw new AppError("Invalid cursor.", 404, "not_found");
    }

    if (result?.status !== "listed") {
      throw new Error("Unexpected notification feed service status.");
    }

    const paginationOptions = { unread, pageSize };

    return res.status(200).json({
      next: createPaginationUrl(req, {
        ...paginationOptions,
        cursor: result.nextCursor,
      }),
      previous: createPaginationUrl(req, {
        ...paginationOptions,
        cursor: result.previousCursor,
      }),
      results: result.notifications.map(serializeNotification),
    });
  } catch (error) {
    return next(error);
  }
};

exports.getUnreadCount = async (req, res, next) => {
  try {
    const result = await getUnreadNotificationCountService(req.user._id);

    if (
      result?.status !== "counted" ||
      !Number.isSafeInteger(result.count) ||
      result.count < 0
    ) {
      throw new Error(
        "Unexpected unread notification count service result.",
      );
    }

    return res.status(200).json({ count: result.count });
  } catch (error) {
    return next(error);
  }
};

exports.markAllRead = async (req, res, next) => {
  try {
    const result = await markAllNotificationsReadService(req.user._id);

    if (
      result?.status !== "updated" ||
      !Number.isSafeInteger(result.markedRead) ||
      result.markedRead < 0
    ) {
      throw new Error("Unexpected mark-all-read service result.");
    }

    return res.status(200).json({ marked_read: result.markedRead });
  } catch (error) {
    return next(error);
  }
};

exports.markNotificationRead = async (req, res, next) => {
  try {
    const result = await markNotificationReadService({
      userId: req.user._id,
      notificationId: req.params.notificationId,
    });

    if (result?.status === "not_found") {
      throw new AppError(
        "No Notification matches the given query.",
        404,
        "not_found",
      );
    }

    if (result?.status !== "updated") {
      throw new Error(
        "Unexpected mark-notification-read service status.",
      );
    }

    return res.status(200).json(serializeNotification(result.notification));
  } catch (error) {
    return next(error);
  }
};
