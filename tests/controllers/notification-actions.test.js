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
  const state = {
    listResult: {
      status: "listed",
      notifications: [{ _id: "notification-1" }],
      nextCursor: "next-cursor",
      previousCursor: "previous-cursor",
    },
    countResult: { status: "counted", count: 3 },
    markAllResult: { status: "updated", markedRead: 2 },
    markOneResult: {
      status: "updated",
      notification: { _id: "notification-1" },
    },
    deleteResult: { status: "deleted" },
  };
  const controller = loadWithMocks(target, {
    [deviceService]: {
      registerDeviceToken: async () => ({}),
      unregisterDeviceToken: async () => ({}),
    },
    [actionService]: {
      async deleteNotification(input) {
        calls.delete = input;
        return state.deleteResult;
      },
      async markAllNotificationsRead(userId) {
        calls.markAll = userId;
        return state.markAllResult;
      },
      async markNotificationRead(input) {
        calls.markOne = input;
        return state.markOneResult;
      },
    },
    [feedService]: {
      async getUnreadNotificationCount(userId) {
        calls.count = userId;
        return state.countResult;
      },
      async listNotifications(input) {
        calls.list = input;
        return state.listResult;
      },
    },
    [preferenceService]: {
      getNotificationPreferences: async () => ({}),
      updateNotificationPreferences: async () => ({}),
    },
    [notificationUtils]: {
      serializeDeviceToken: (value) => value,
      serializeNotification: (value) => ({ id: value._id }),
      serializeNotificationPreference: (value) => value,
    },
  });

  return { calls, controller, state };
};

test("feed controller returns serialized results and pagination URLs", async () => {
  const { calls, controller } = loadController();
  const req = {
    user: { _id: "user-1" },
    validatedQuery: {
      unread: true,
      pageSize: 2,
      cursor: "input-cursor",
    },
    originalUrl: "/notifications?discarded=true",
    protocol: "https",
    get(name) {
      assert.equal(name, "host");
      return "api.example";
    },
  };
  const res = createResponse();
  let forwarded;

  await controller.listNotifications(req, res, (error) => {
    forwarded = error;
  });

  assert.equal(forwarded, undefined);
  assert.deepEqual(calls.list, {
    userId: "user-1",
    unread: true,
    pageSize: 2,
    cursor: "input-cursor",
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    next:
      "https://api.example/notifications?unread=true&page_size=2&cursor=next-cursor",
    previous:
      "https://api.example/notifications?unread=true&page_size=2&cursor=previous-cursor",
    results: [{ id: "notification-1" }],
  });
});

test("feed controller maps invalid cursors and unexpected statuses", async () => {
  const { controller, state } = loadController();
  const req = {
    user: { _id: "user-1" },
    validatedQuery: { unread: false, pageSize: 20, cursor: null },
    originalUrl: "/notifications",
    protocol: "https",
    get: () => "api.example",
  };

  state.listResult = { status: "invalid_cursor" };
  let forwarded;
  await controller.listNotifications(req, createResponse(), (error) => {
    forwarded = error;
  });
  assert.equal(forwarded.statusCode, 404);
  assert.equal(forwarded.code, "not_found");
  assert.equal(forwarded.message, "Invalid cursor.");

  state.listResult = { status: "unexpected" };
  forwarded = undefined;
  await controller.listNotifications(req, createResponse(), (error) => {
    forwarded = error;
  });
  assert.match(forwarded.message, /Unexpected notification feed service status/);
});

test("unread-count controller validates and returns a safe count", async () => {
  const { calls, controller, state } = loadController();
  const req = { user: { _id: "user-1" } };
  const res = createResponse();
  let forwarded;

  await controller.getUnreadCount(req, res, (error) => {
    forwarded = error;
  });
  assert.equal(forwarded, undefined);
  assert.equal(calls.count, "user-1");
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { count: 3 });

  const invalidResults = [
    { status: "counted", count: -1 },
    { status: "counted", count: 1.5 },
    { status: "counted", count: Number.MAX_SAFE_INTEGER + 1 },
    { status: "unexpected", count: 1 },
  ];

  for (const result of invalidResults) {
    state.countResult = result;
    forwarded = undefined;
    await controller.getUnreadCount(req, createResponse(), (error) => {
      forwarded = error;
    });
    assert.match(
      forwarded.message,
      /Unexpected unread notification count service result/,
    );
  }
});

test("mark-all controller returns valid counts and rejects invalid results", async () => {
  const { calls, controller, state } = loadController();
  const req = { user: { _id: "user-1" } };

  for (const markedRead of [2, 0]) {
    state.markAllResult = { status: "updated", markedRead };
    const res = createResponse();
    let forwarded;
    await controller.markAllRead(req, res, (error) => {
      forwarded = error;
    });

    assert.equal(forwarded, undefined);
    assert.equal(calls.markAll, "user-1");
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, { marked_read: markedRead });
  }

  for (const result of [
    { status: "updated", markedRead: -1 },
    { status: "updated", markedRead: 1.5 },
    { status: "unexpected", markedRead: 1 },
  ]) {
    state.markAllResult = result;
    let forwarded;
    await controller.markAllRead(req, createResponse(), (error) => {
      forwarded = error;
    });
    assert.match(forwarded.message, /Unexpected mark-all-read service result/);
  }
});

test("mark-one controller serializes success and maps service errors", async () => {
  const { calls, controller, state } = loadController();
  const req = {
    user: { _id: "user-1" },
    params: { notificationId: "notification-1" },
  };
  const res = createResponse();
  let forwarded;

  await controller.markNotificationRead(req, res, (error) => {
    forwarded = error;
  });
  assert.equal(forwarded, undefined);
  assert.deepEqual(calls.markOne, {
    userId: "user-1",
    notificationId: "notification-1",
  });
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, { id: "notification-1" });

  state.markOneResult = { status: "not_found" };
  await controller.markNotificationRead(req, createResponse(), (error) => {
    forwarded = error;
  });
  assert.equal(forwarded.statusCode, 404);
  assert.equal(forwarded.code, "not_found");

  state.markOneResult = { status: "unexpected" };
  await controller.markNotificationRead(req, createResponse(), (error) => {
    forwarded = error;
  });
  assert.match(
    forwarded.message,
    /Unexpected mark-notification-read service status/,
  );
});

test("delete controller returns no content and maps service errors", async () => {
  const { calls, controller, state } = loadController();
  const req = {
    user: { _id: "user-1" },
    params: { notificationId: "notification-1" },
  };
  const res = createResponse();
  let forwarded;

  await controller.deleteNotification(req, res, (error) => {
    forwarded = error;
  });
  assert.equal(forwarded, undefined);
  assert.deepEqual(calls.delete, {
    userId: "user-1",
    notificationId: "notification-1",
  });
  assert.equal(res.statusCode, 204);
  assert.equal(res.sent, true);
  assert.equal(res.payload, undefined);

  state.deleteResult = { status: "not_found" };
  await controller.deleteNotification(req, createResponse(), (error) => {
    forwarded = error;
  });
  assert.equal(forwarded.statusCode, 404);
  assert.equal(forwarded.code, "not_found");

  state.deleteResult = { status: "unexpected" };
  await controller.deleteNotification(req, createResponse(), (error) => {
    forwarded = error;
  });
  assert.match(
    forwarded.message,
    /Unexpected notification deletion service status/,
  );
});
