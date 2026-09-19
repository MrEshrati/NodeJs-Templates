const mongoose = require("mongoose");
const Notification = require("../models/notification.model");

const deleteNotification = async ({ userId, notificationId } = {}) => {
  if (!mongoose.isObjectIdOrHexString(notificationId)) {
    return { status: "not_found" };
  }

  const result = await Notification.deleteOne({
    _id: notificationId,
    user: userId,
  });

  if (result.deletedCount === 1) {
    return { status: "deleted" };
  }

  if (result.deletedCount === 0) {
    return { status: "not_found" };
  }

  throw new Error("Unexpected notification deletion result.");
};

const markAllNotificationsRead = async (userId) => {
  const readAt = new Date();
  const result = await Notification.updateMany(
    {
      user: userId,
      read: false,
    },
    {
      $set: {
        read: true,
        readAt,
      },
    },
  );

  return {
    status: "updated",
    markedRead: result.modifiedCount,
  };
};

const markNotificationRead = async ({ userId, notificationId } = {}) => {
  if (!mongoose.isObjectIdOrHexString(notificationId)) {
    return { status: "not_found" };
  }

  const wasUnread = { $eq: ["$read", false] };
  const notification = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      user: userId,
    },
    [
      {
        $set: {
          read: true,
          readAt: { $cond: [wasUnread, "$$NOW", "$readAt"] },
          updatedAt: { $cond: [wasUnread, "$$NOW", "$updatedAt"] },
        },
      },
    ],
    {
      returnDocument: "after",
      updatePipeline: true,
      timestamps: false,
    },
  ).lean();

  if (!notification) {
    return { status: "not_found" };
  }

  return {
    status: "updated",
    notification,
  };
};

module.exports = {
  deleteNotification,
  markAllNotificationsRead,
  markNotificationRead,
};
