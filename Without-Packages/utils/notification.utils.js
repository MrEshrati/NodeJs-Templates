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

const serializeNotificationPreference = (preference) => ({
  push_enabled: preference.pushEnabled,
  email_enabled: preference.emailEnabled,
});

const serializeDeviceToken = (deviceToken) => ({
  id: String(deviceToken._id),
  token: deviceToken.token,
  platform: deviceToken.platform,
  created_at: deviceToken.createdAt.toISOString(),
  updated_at: deviceToken.updatedAt.toISOString(),
});

module.exports = {
  serializeDeviceToken,
  serializeNotification,
  serializeNotificationPreference,
};
