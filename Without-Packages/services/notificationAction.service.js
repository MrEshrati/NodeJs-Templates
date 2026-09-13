const Notification = require("../models/notification.model");

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

module.exports = {
  markAllNotificationsRead,
};
