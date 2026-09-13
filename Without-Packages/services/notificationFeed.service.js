const Notification = require("../models/notification.model");
const {
  decodeNotificationCursor,
  encodeNotificationCursor,
} = require("../utils/notificationCursor.utils");

const FEED_SORT = Object.freeze({ createdAt: -1, _id: -1 });
const REVERSE_FEED_SORT = Object.freeze({ createdAt: 1, _id: 1 });

const createPositionFilter = ({ createdAt, id, direction }) => {
  const comparison = direction === "next" ? "$lt" : "$gt";

  return [
    { createdAt: { [comparison]: createdAt } },
    {
      createdAt,
      _id: { [comparison]: id },
    },
  ];
};

const createPageCursors = ({ notifications, direction, hasExtra }) => {
  if (notifications.length === 0) {
    return {
      nextCursor: null,
      previousCursor: null,
    };
  }

  const hasNext = direction === "previous" ? true : hasExtra;
  const hasPrevious =
    direction === "next"
      ? true
      : direction === "previous"
        ? hasExtra
        : false;
  const first = notifications[0];
  const last = notifications[notifications.length - 1];

  return {
    nextCursor: hasNext
      ? encodeNotificationCursor({
          createdAt: last.createdAt,
          id: last._id,
          direction: "next",
        })
      : null,
    previousCursor: hasPrevious
      ? encodeNotificationCursor({
          createdAt: first.createdAt,
          id: first._id,
          direction: "previous",
        })
      : null,
  };
};

const listNotifications = async ({
  userId,
  unread = false,
  pageSize,
  cursor = null,
} = {}) => {
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    throw new TypeError("pageSize must be an integer from 1 to 100.");
  }

  const decodedCursor =
    cursor === null ? null : decodeNotificationCursor(cursor);

  if (cursor !== null && decodedCursor === null) {
    return { status: "invalid_cursor" };
  }

  const filter = { user: userId };

  if (unread === true) {
    filter.read = false;
  }

  if (decodedCursor) {
    filter.$or = createPositionFilter(decodedCursor);
  }

  const direction = decodedCursor?.direction ?? null;
  const sort = direction === "previous" ? REVERSE_FEED_SORT : FEED_SORT;
  const notifications = await Notification.find(filter)
    .sort(sort)
    .limit(pageSize + 1)
    .lean();
  const hasExtra = notifications.length > pageSize;

  if (hasExtra) {
    notifications.pop();
  }

  if (direction === "previous") {
    notifications.reverse();
  }

  const { nextCursor, previousCursor } = createPageCursors({
    notifications,
    direction,
    hasExtra,
  });

  return {
    status: "listed",
    notifications,
    nextCursor,
    previousCursor,
  };
};

const getUnreadNotificationCount = async (userId) => {
  const count = await Notification.countDocuments({
    user: userId,
    read: false,
  });

  return {
    status: "counted",
    count,
  };
};

module.exports = {
  getUnreadNotificationCount,
  listNotifications,
};
