const NotificationPreference = require(
  "../models/notificationPreference.model",
);

const PREFERENCE_FIELDS = ["pushEnabled", "emailEnabled"];

const findOrCreatePreference = async (userId, update = {}) => {
  const updateOperations = {
    $setOnInsert: { user: userId },
  };

  if (Object.keys(update).length > 0) {
    updateOperations.$set = update;
  }

  return NotificationPreference.findOneAndUpdate(
    { user: userId },
    updateOperations,
    {
      upsert: true,
      returnDocument: "after",
      runValidators: true,
      setDefaultsOnInsert: true,
    },
  ).lean();
};

const getNotificationPreferences = async (userId) => {
  const preference = await findOrCreatePreference(userId);

  return {
    status: "retrieved",
    preference,
  };
};

const updateNotificationPreferences = async (userId, changes = {}) => {
  const update = {};
  const validatedChanges =
    changes !== null && typeof changes === "object" && !Array.isArray(changes)
      ? changes
      : {};

  for (const field of PREFERENCE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(validatedChanges, field)) {
      continue;
    }

    update[field] = validatedChanges[field];
  }

  const preference = await findOrCreatePreference(userId, update);

  return {
    status: "updated",
    preference,
  };
};

module.exports = {
  getNotificationPreferences,
  updateNotificationPreferences,
};
