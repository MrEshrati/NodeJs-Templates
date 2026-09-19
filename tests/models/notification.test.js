const test = require("node:test");
const assert = require("node:assert/strict");
const { isDeepStrictEqual } = require("node:util");
const mongoose = require("mongoose");
const DeviceToken = require("../../models/deviceToken.model");
const Notification = require("../../models/notification.model");
const NotificationPreference = require(
  "../../models/notificationPreference.model",
);

const objectId = () => new mongoose.Types.ObjectId();

const getValidationError = async (document) => {
  try {
    await document.validate();
    return null;
  } catch (error) {
    return error;
  }
};

const findIndex = (model, expectedKeys) =>
  model.schema
    .indexes()
    .find(([keys]) => isDeepStrictEqual(keys, expectedKeys));

test("notification schema validates content and applies feed defaults", async () => {
  const notification = new Notification({
    user: objectId(),
    type: "  payment_succeeded  ",
    title: "  Payment received  ",
    body: "  Your payment was successful.  ",
  });
  const anotherNotification = new Notification({
    user: objectId(),
    type: "account_updated",
    title: "Account updated",
    body: "Your account was updated.",
  });

  assert.equal(notification.type, "payment_succeeded");
  assert.equal(notification.title, "Payment received");
  assert.equal(notification.body, "Your payment was successful.");
  assert.deepEqual(notification.data, {});
  assert.notEqual(notification.data, anotherNotification.data);
  assert.equal(notification.read, false);
  assert.equal(notification.readAt, null);
  await assert.doesNotReject(notification.validate());
});

test("notification schema requires feed content", async () => {
  const error = await getValidationError(new Notification({}));

  assert.ok(error.errors.user);
  assert.ok(error.errors.type);
  assert.ok(error.errors.title);
  assert.ok(error.errors.body);
});

test("notification schema declares feed and unread indexes", () => {
  const feedIndex = findIndex(Notification, {
    user: 1,
    createdAt: -1,
    _id: -1,
  });
  const unreadIndex = findIndex(Notification, {
    user: 1,
    read: 1,
    createdAt: -1,
    _id: -1,
  });

  assert.equal(feedIndex[1].name, "notification_feed_idx");
  assert.equal(unreadIndex[1].name, "notification_unread_feed_idx");
  assert.deepEqual(unreadIndex[1].partialFilterExpression, { read: false });
});

test("notification-preference schema defaults both channels on", async () => {
  const preference = new NotificationPreference({ user: objectId() });
  const disabledPreference = new NotificationPreference({
    user: objectId(),
    pushEnabled: false,
    emailEnabled: false,
  });

  assert.equal(preference.pushEnabled, true);
  assert.equal(preference.emailEnabled, true);
  assert.equal(disabledPreference.pushEnabled, false);
  assert.equal(disabledPreference.emailEnabled, false);
  await assert.doesNotReject(preference.validate());
  await assert.doesNotReject(disabledPreference.validate());
});

test("notification-preference schema requires one immutable unique user", async () => {
  const error = await getValidationError(new NotificationPreference({}));
  const userPath = NotificationPreference.schema.path("user");
  const userIndex = findIndex(NotificationPreference, { user: 1 });

  assert.ok(error.errors.user);
  assert.equal(userPath.options.required, true);
  assert.equal(userPath.options.immutable, true);
  assert.equal(userPath.options.unique, true);
  assert.equal(userIndex[1].unique, true);
});

test("device-token schema accepts supported platforms and boundary length", async () => {
  for (const platform of ["ios", "android"]) {
    const deviceToken = new DeviceToken({
      user: objectId(),
      token: `${platform}-${"x".repeat(512 - platform.length - 1)}`,
      platform,
    });

    assert.equal(deviceToken.token.length, 512);
    await assert.doesNotReject(deviceToken.validate());
  }
});

test("device-token schema enforces required fields and supported values", async () => {
  const missingError = await getValidationError(new DeviceToken({}));
  assert.ok(missingError.errors.user);
  assert.ok(missingError.errors.token);
  assert.ok(missingError.errors.platform);

  const invalidError = await getValidationError(
    new DeviceToken({
      user: objectId(),
      token: "x".repeat(513),
      platform: "windows",
    }),
  );
  assert.ok(invalidError.errors.token);
  assert.ok(invalidError.errors.platform);
});

test("device-token schema supports rebinding and eviction queries", () => {
  const userPath = DeviceToken.schema.path("user");
  const tokenPath = DeviceToken.schema.path("token");
  const tokenIndex = findIndex(DeviceToken, { token: 1 });
  const evictionIndex = findIndex(DeviceToken, {
    user: 1,
    updatedAt: 1,
    _id: 1,
  });

  assert.notEqual(userPath.options.immutable, true);
  assert.equal(tokenPath.options.immutable, true);
  assert.equal(tokenPath.options.unique, true);
  assert.equal(tokenIndex[1].unique, true);
  assert.equal(evictionIndex[1].name, "device_token_eviction_idx");
});
