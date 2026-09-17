const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const target = fromProject("controllers", "notification.controller.js");
const deviceService = fromProject("services", "deviceToken.service.js");
const actionService = fromProject(
  "services",
  "notificationAction.service.js",
);
const feedService = fromProject(
  "services",
  "notificationFeed.service.js",
);
const preferenceService = fromProject(
  "services",
  "notificationPreference.service.js",
);
const notificationUtils = fromProject("utils", "notification.utils.js");

const createResponse = () => ({
  statusCode: null,
  payload: undefined,
  sent: false,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
  send() {
    this.sent = true;
    return this;
  },
});

const loadController = () => {
  const calls = {};
  const preference = {
    _id: "preference-1",
    user: "user-1",
    pushEnabled: false,
    emailEnabled: true,
  };
  const deviceToken = {
    _id: "device-1",
    user: "user-1",
    token: "token-1",
    platform: "ios",
  };
  const state = {
    retrieveResult: { status: "retrieved", preference },
    updateResult: { status: "updated", preference },
    registerResult: { status: "registered", deviceToken },
    unregisterResult: { status: "unregistered" },
  };
  const controller = loadWithMocks(target, {
    [deviceService]: {
      async registerDeviceToken(input) {
        calls.register = input;
        return state.registerResult;
      },
      async unregisterDeviceToken(input) {
        calls.unregister = input;
        return state.unregisterResult;
      },
    },
    [actionService]: {
      deleteNotification: async () => ({}),
      markAllNotificationsRead: async () => ({}),
      markNotificationRead: async () => ({}),
    },
    [feedService]: {
      getUnreadNotificationCount: async () => ({}),
      listNotifications: async () => ({}),
    },
    [preferenceService]: {
      async getNotificationPreferences(userId) {
        calls.retrieve = userId;
        return state.retrieveResult;
      },
      async updateNotificationPreferences(userId, changes) {
        calls.update = { userId, changes };
        return state.updateResult;
      },
    },
    [notificationUtils]: {
      serializeDeviceToken: (value) => ({
        id: String(value._id),
        token: value.token,
        platform: value.platform,
      }),
      serializeNotification: (value) => value,
      serializeNotificationPreference: (value) => ({
        push_enabled: value.pushEnabled,
        email_enabled: value.emailEnabled,
      }),
    },
  });

  return { calls, controller, deviceToken, preference, state };
};

test("preference retrieval returns only serialized channel settings", async () => {
  const { calls, controller } = loadController();
  const req = { user: { _id: "user-1" } };
  const res = createResponse();
  let forwarded;

  await controller.getNotificationPreferences(req, res, (error) => {
    forwarded = error;
  });

  assert.equal(forwarded, undefined);
  assert.equal(calls.retrieve, "user-1");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    push_enabled: false,
    email_enabled: true,
  });
  assert.equal(Object.hasOwn(res.payload, "user"), false);
  assert.equal(Object.hasOwn(res.payload, "id"), false);
});

test("preference retrieval forwards missing or unexpected results", async () => {
  const { controller, state } = loadController();
  const req = { user: { _id: "user-1" } };

  for (const result of [
    { status: "unexpected", preference: {} },
    { status: "retrieved", preference: null },
  ]) {
    state.retrieveResult = result;
    let forwarded;
    await controller.getNotificationPreferences(
      req,
      createResponse(),
      (error) => {
        forwarded = error;
      },
    );
    assert.match(
      forwarded.message,
      /Unexpected notification preference retrieval service result/,
    );
  }
});

test("preference update passes validated changes and preserves false", async () => {
  const { calls, controller, state } = loadController();
  state.updateResult = {
    status: "updated",
    preference: {
      _id: "preference-1",
      user: "user-1",
      pushEnabled: false,
      emailEnabled: false,
    },
  };
  const validatedBody = {
    pushEnabled: false,
    emailEnabled: false,
  };
  const req = {
    user: { _id: "user-1" },
    validatedBody,
  };
  const res = createResponse();
  let forwarded;

  await controller.updateNotificationPreferences(req, res, (error) => {
    forwarded = error;
  });

  assert.equal(forwarded, undefined);
  assert.equal(calls.update.userId, "user-1");
  assert.equal(calls.update.changes, validatedBody);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    push_enabled: false,
    email_enabled: false,
  });
});

test("preference update forwards missing or unexpected results", async () => {
  const { controller, state } = loadController();
  const req = {
    user: { _id: "user-1" },
    validatedBody: { pushEnabled: false },
  };

  for (const result of [
    { status: "unexpected", preference: {} },
    { status: "updated", preference: null },
  ]) {
    state.updateResult = result;
    let forwarded;
    await controller.updateNotificationPreferences(
      req,
      createResponse(),
      (error) => {
        forwarded = error;
      },
    );
    assert.match(
      forwarded.message,
      /Unexpected notification preference update service result/,
    );
  }
});

test("device registration passes validated values and serializes success", async () => {
  const { calls, controller } = loadController();
  const req = {
    user: { _id: "user-1" },
    validatedBody: {
      token: "token-1",
      platform: "ios",
    },
  };
  const res = createResponse();
  let forwarded;

  await controller.registerDeviceToken(req, res, (error) => {
    forwarded = error;
  });

  assert.equal(forwarded, undefined);
  assert.deepEqual(calls.register, {
    userId: "user-1",
    token: "token-1",
    platform: "ios",
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    id: "device-1",
    token: "token-1",
    platform: "ios",
  });
  assert.equal(Object.hasOwn(res.payload, "user"), false);
});

test("device registration forwards missing or unexpected results", async () => {
  const { controller, state } = loadController();
  const req = {
    user: { _id: "user-1" },
    validatedBody: { token: "token-1", platform: "ios" },
  };

  for (const result of [
    { status: "unexpected", deviceToken: {} },
    { status: "registered", deviceToken: null },
  ]) {
    state.registerResult = result;
    let forwarded;
    await controller.registerDeviceToken(req, createResponse(), (error) => {
      forwarded = error;
    });
    assert.match(
      forwarded.message,
      /Unexpected device-token registration service result/,
    );
  }
});

test("device unregistration is bodyless and forwards unexpected results", async () => {
  const { calls, controller, state } = loadController();
  const req = {
    user: { _id: "user-1" },
    validatedBody: { token: "token-1" },
  };
  const res = createResponse();
  let forwarded;

  await controller.unregisterDeviceToken(req, res, (error) => {
    forwarded = error;
  });
  assert.equal(forwarded, undefined);
  assert.deepEqual(calls.unregister, {
    userId: "user-1",
    token: "token-1",
  });
  assert.equal(res.statusCode, 204);
  assert.equal(res.sent, true);
  assert.equal(res.payload, undefined);

  state.unregisterResult = { status: "unexpected" };
  await controller.unregisterDeviceToken(
    req,
    createResponse(),
    (error) => {
      forwarded = error;
    },
  );
  assert.match(
    forwarded.message,
    /Unexpected device-token unregistration service result/,
  );
});
