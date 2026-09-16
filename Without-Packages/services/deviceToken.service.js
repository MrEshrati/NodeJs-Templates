const mongoose = require("mongoose");
const DeviceToken = require("../models/deviceToken.model");

const MAX_DEVICE_TOKENS = 20;

const removeExcessDeviceTokens = async ({
  userId,
  registeredDeviceTokenId,
  session,
}) => {
  const excessDeviceTokens = await DeviceToken.find({
    user: userId,
    _id: { $ne: registeredDeviceTokenId },
  })
    .sort({ updatedAt: -1, _id: -1 })
    .skip(MAX_DEVICE_TOKENS - 1)
    .select("_id")
    .session(session)
    .lean();

  if (excessDeviceTokens.length === 0) {
    return;
  }

  const excessDeviceTokenIds = excessDeviceTokens.map(({ _id }) => _id);
  const deletion = await DeviceToken.deleteMany(
    { _id: { $in: excessDeviceTokenIds } },
    { session },
  );

  if (deletion.deletedCount !== excessDeviceTokenIds.length) {
    throw new Error("Unexpected device-token eviction result.");
  }
};

const registerDeviceToken = async ({ userId, token, platform } = {}) => {
  await DeviceToken.init();

  const deviceToken = await mongoose.connection.transaction(
    async (session) => {
      const registeredDeviceToken = await DeviceToken.findOneAndUpdate(
        { token },
        {
          $set: {
            user: userId,
            platform,
          },
          $setOnInsert: { token },
        },
        {
          upsert: true,
          returnDocument: "after",
          runValidators: true,
          setDefaultsOnInsert: true,
          session,
        },
      ).lean();

      if (!registeredDeviceToken) {
        throw new Error("Unexpected device-token registration result.");
      }

      await removeExcessDeviceTokens({
        userId,
        registeredDeviceTokenId: registeredDeviceToken._id,
        session,
      });

      return registeredDeviceToken;
    },
  );

  if (!deviceToken) {
    throw new Error("Unexpected device-token transaction result.");
  }

  return {
    status: "registered",
    deviceToken,
  };
};

const unregisterDeviceToken = async ({ userId, token } = {}) => {
  const deletion = await DeviceToken.deleteOne({
    user: userId,
    token,
  });

  if (deletion.deletedCount !== 0 && deletion.deletedCount !== 1) {
    throw new Error("Unexpected device-token deletion result.");
  }

  return { status: "unregistered" };
};

module.exports = {
  registerDeviceToken,
  unregisterDeviceToken,
};
