const serializeNotification = (notification) => ({
  id: String(notification._id),
  type: notification.type,
  title: notification.title,
  body: notification.body,
  data: notification.data,
  read: notification.read,
  read_at:
    notification.readAt === null ? null : notification.readAt.toISOString(),
  created_at: notification.createdAt.toISOString(),
});

module.exports = {
  serializeNotification,
};
