const Notification = require("../models/notification.model");

const notify = async ({ userId, type, title, body, data = {} }) => {
  const notification = await Notification.create({
    user: userId,
    type,
    title,
    body,
    data,
  });

  return notification.toObject();
};

module.exports = {
  notify,
};
