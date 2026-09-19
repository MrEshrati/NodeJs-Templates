require("dotenv").config({ quiet: true });

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const { fromProject } = require("../helpers/module");
const {
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} = require("../helpers/database");

const OWNER_EMAIL = "notification-owner@example.com";
const OTHER_EMAIL = "notification-other@example.com";
const TEST_PASSWORD = "correct-horse-battery-18";
const FRONTEND_ORIGIN = "https://account-e2e.example";
const JWT_SECRET = "notification-e2e-jwt-secret-with-at-least-32-bytes";
const LOGIN_THROTTLE_SECRET =
  "notification-e2e-login-throttle-secret-with-at-least-32-bytes";
const REQUEST_THROTTLE_SECRET =
  "notification-e2e-request-throttle-secret-with-at-least-32-bytes";

const testDatabaseConfigured =
  typeof process.env.TEST_DB_URL === "string" &&
  process.env.TEST_DB_URL.trim() !== "";

const closeServer = async (server) => {
  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
};

const startServer = async (app) =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });

const requestJson = async (
  baseUrl,
  path,
  { method = "GET", body, token } = {},
) => {
  const headers = {
    Origin: FRONTEND_ORIGIN,
  };

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseText = await response.text();

  return {
    response,
    payload: responseText === "" ? null : JSON.parse(responseText),
  };
};

const login = async (baseUrl, email) => {
  const result = await requestJson(baseUrl, "/auth/login", {
    method: "POST",
    body: {
      email,
      password: TEST_PASSWORD,
    },
  });

  assert.equal(result.response.status, 200);

  return result.payload;
};

const toPath = (url) => {
  const parsedUrl = new URL(url);

  return `${parsedUrl.pathname}${parsedUrl.search}`;
};

test(
  "notification endpoints enforce ownership and complete the user workflow",
  {
    skip:
      !testDatabaseConfigured &&
      "Set TEST_DB_URL to a dedicated database ending in _test.",
  },
  async (t) => {
    process.env.FRONTEND_URL = FRONTEND_ORIGIN;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.LOGIN_THROTTLE_SECRET = LOGIN_THROTTLE_SECRET;
    process.env.REQUEST_THROTTLE_SECRET = REQUEST_THROTTLE_SECRET;

    const { app } = require(fromProject("app.js"));
    const DeviceToken = require(fromProject("models/deviceToken.model.js"));
    const Notification = require(
      fromProject("models/notification.model.js"),
    );
    const NotificationPreference = require(
      fromProject("models/notificationPreference.model.js"),
    );
    const User = require(fromProject("models/user.model.js"));

    let server;

    await connectTestDatabase();

    t.after(async () => {
      await closeServer(server);
      await clearTestDatabase();
      await disconnectTestDatabase();
    });

    await clearTestDatabase();

    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
    const [owner, otherUser] = await User.create([
      {
        email: OWNER_EMAIL,
        password: passwordHash,
        emailVerified: true,
        isActive: true,
      },
      {
        email: OTHER_EMAIL,
        password: passwordHash,
        emailVerified: true,
        isActive: true,
      },
    ]);

    server = await startServer(app);

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;
    const ownerTokens = await login(baseUrl, OWNER_EMAIL);
    const otherTokens = await login(baseUrl, OTHER_EMAIL);

    const unauthorizedFeed = await requestJson(baseUrl, "/notifications");

    assert.equal(unauthorizedFeed.response.status, 401);
    assert.equal(unauthorizedFeed.payload.code, "not_authenticated");

    const [oldest, middle, newest, otherNotification] =
      await Notification.create([
        {
          user: owner._id,
          type: "account.oldest",
          title: "Oldest notification",
          body: "Oldest body",
          data: { position: 1 },
          createdAt: new Date("2026-01-01T00:00:01.000Z"),
          updatedAt: new Date("2026-01-01T00:00:01.000Z"),
        },
        {
          user: owner._id,
          type: "account.middle",
          title: "Middle notification",
          body: "Middle body",
          data: { position: 2 },
          read: true,
          readAt: new Date("2026-01-01T00:00:03.000Z"),
          createdAt: new Date("2026-01-01T00:00:02.000Z"),
          updatedAt: new Date("2026-01-01T00:00:03.000Z"),
        },
        {
          user: owner._id,
          type: "account.newest",
          title: "Newest notification",
          body: "Newest body",
          data: { position: 3 },
          createdAt: new Date("2026-01-01T00:00:04.000Z"),
          updatedAt: new Date("2026-01-01T00:00:04.000Z"),
        },
        {
          user: otherUser._id,
          type: "account.private",
          title: "Other user's notification",
          body: "This must remain private",
          createdAt: new Date("2026-01-01T00:00:05.000Z"),
          updatedAt: new Date("2026-01-01T00:00:05.000Z"),
        },
      ]);

    const firstPage = await requestJson(
      baseUrl,
      "/notifications?page_size=2",
      { token: ownerTokens.access },
    );

    assert.equal(firstPage.response.status, 200);
    assert.equal(firstPage.payload.previous, null);
    assert.equal(typeof firstPage.payload.next, "string");
    assert.deepEqual(
      firstPage.payload.results.map(({ id }) => id),
      [newest._id.toString(), middle._id.toString()],
    );
    assert.equal(
      firstPage.payload.results.some(
        ({ id }) => id === otherNotification._id.toString(),
      ),
      false,
    );
    assert.deepEqual(firstPage.payload.results[0].data, { position: 3 });
    assert.equal(firstPage.payload.results[0].read, false);
    assert.equal(firstPage.payload.results[0].read_at, null);

    const nextPage = await requestJson(
      baseUrl,
      toPath(firstPage.payload.next),
      { token: ownerTokens.access },
    );

    assert.equal(nextPage.response.status, 200);
    assert.equal(nextPage.payload.next, null);
    assert.equal(typeof nextPage.payload.previous, "string");
    assert.deepEqual(
      nextPage.payload.results.map(({ id }) => id),
      [oldest._id.toString()],
    );

    const previousPage = await requestJson(
      baseUrl,
      toPath(nextPage.payload.previous),
      { token: ownerTokens.access },
    );

    assert.equal(previousPage.response.status, 200);
    assert.deepEqual(
      previousPage.payload.results.map(({ id }) => id),
      [newest._id.toString(), middle._id.toString()],
    );

    const unreadFeed = await requestJson(
      baseUrl,
      "/notifications?unread=true&page_size=10",
      { token: ownerTokens.access },
    );

    assert.equal(unreadFeed.response.status, 200);
    assert.deepEqual(
      unreadFeed.payload.results.map(({ id }) => id),
      [newest._id.toString(), oldest._id.toString()],
    );

    const invalidCursor = await requestJson(
      baseUrl,
      "/notifications?cursor=not-a-valid-cursor",
      { token: ownerTokens.access },
    );

    assert.equal(invalidCursor.response.status, 404);
    assert.equal(invalidCursor.payload.code, "not_found");

    const initialUnreadCount = await requestJson(
      baseUrl,
      "/notifications/unread-count",
      { token: ownerTokens.access },
    );

    assert.equal(initialUnreadCount.response.status, 200);
    assert.deepEqual(initialUnreadCount.payload, { count: 2 });

    const crossUserRead = await requestJson(
      baseUrl,
      `/notifications/${otherNotification._id}/read`,
      {
        method: "POST",
        token: ownerTokens.access,
      },
    );

    assert.equal(crossUserRead.response.status, 404);
    assert.equal(crossUserRead.payload.code, "not_found");

    const crossUserDelete = await requestJson(
      baseUrl,
      `/notifications/${otherNotification._id}`,
      {
        method: "DELETE",
        token: ownerTokens.access,
      },
    );

    assert.equal(crossUserDelete.response.status, 404);
    assert.equal(crossUserDelete.payload.code, "not_found");

    const otherNotificationAfterOwnerRequests =
      await Notification.findById(otherNotification._id).lean();

    assert.ok(otherNotificationAfterOwnerRequests);
    assert.equal(otherNotificationAfterOwnerRequests.read, false);

    const markOneRead = await requestJson(
      baseUrl,
      `/notifications/${newest._id}/read`,
      {
        method: "POST",
        token: ownerTokens.access,
      },
    );

    assert.equal(markOneRead.response.status, 200);
    assert.equal(markOneRead.payload.id, newest._id.toString());
    assert.equal(markOneRead.payload.read, true);
    assert.equal(typeof markOneRead.payload.read_at, "string");

    const storedNewest = await Notification.findById(newest._id).lean();

    assert.equal(storedNewest.read, true);
    assert.ok(storedNewest.readAt instanceof Date);

    const markAllRead = await requestJson(
      baseUrl,
      "/notifications/read-all",
      {
        method: "POST",
        token: ownerTokens.access,
      },
    );

    assert.equal(markAllRead.response.status, 200);
    assert.deepEqual(markAllRead.payload, { marked_read: 1 });
    assert.equal(
      await Notification.countDocuments({ user: owner._id, read: false }),
      0,
    );

    const finalUnreadCount = await requestJson(
      baseUrl,
      "/notifications/unread-count",
      { token: ownerTokens.access },
    );

    assert.equal(finalUnreadCount.response.status, 200);
    assert.deepEqual(finalUnreadCount.payload, { count: 0 });

    const deletion = await requestJson(
      baseUrl,
      `/notifications/${middle._id}`,
      {
        method: "DELETE",
        token: ownerTokens.access,
      },
    );

    assert.equal(deletion.response.status, 204);
    assert.equal(deletion.payload, null);
    assert.equal(await Notification.exists({ _id: middle._id }), null);

    const initialPreferences = await requestJson(
      baseUrl,
      "/notifications/preferences",
      { token: ownerTokens.access },
    );

    assert.equal(initialPreferences.response.status, 200);
    assert.deepEqual(initialPreferences.payload, {
      push_enabled: true,
      email_enabled: true,
    });

    const preferenceUpdate = await requestJson(
      baseUrl,
      "/notifications/preferences",
      {
        method: "PATCH",
        token: ownerTokens.access,
        body: {
          push_enabled: false,
          email_enabled: false,
        },
      },
    );

    assert.equal(preferenceUpdate.response.status, 200);
    assert.deepEqual(preferenceUpdate.payload, {
      push_enabled: false,
      email_enabled: false,
    });

    const storedPreference = await NotificationPreference.findOne({
      user: owner._id,
    }).lean();

    assert.ok(storedPreference);
    assert.equal(storedPreference.pushEnabled, false);
    assert.equal(storedPreference.emailEnabled, false);

    const invalidPreference = await requestJson(
      baseUrl,
      "/notifications/preferences",
      {
        method: "PATCH",
        token: ownerTokens.access,
        body: { push_enabled: "false" },
      },
    );

    assert.equal(invalidPreference.response.status, 400);
    assert.equal(invalidPreference.payload.code, "validation_error");
    assert.equal(
      invalidPreference.payload.fields.push_enabled[0].code,
      "invalid",
    );

    const rejectedPreferencePut = await requestJson(
      baseUrl,
      "/notifications/preferences",
      {
        method: "PUT",
        token: ownerTokens.access,
        body: { push_enabled: true },
      },
    );

    assert.equal(rejectedPreferencePut.response.status, 405);
    assert.equal(rejectedPreferencePut.payload.code, "method_not_allowed");
    assert.equal(
      rejectedPreferencePut.response.headers.get("allow"),
      "GET, PATCH",
    );

    const invalidDevice = await requestJson(
      baseUrl,
      "/notifications/devices",
      {
        method: "POST",
        token: ownerTokens.access,
        body: {
          token: "notification-device-token",
          platform: "desktop",
        },
      },
    );

    assert.equal(invalidDevice.response.status, 400);
    assert.equal(invalidDevice.payload.code, "validation_error");
    assert.equal(
      invalidDevice.payload.fields.platform[0].code,
      "invalid_choice",
    );

    const deviceRegistration = await requestJson(
      baseUrl,
      "/notifications/devices",
      {
        method: "POST",
        token: ownerTokens.access,
        body: {
          token: "notification-device-token",
          platform: "android",
        },
      },
    );

    assert.equal(deviceRegistration.response.status, 200);
    assert.equal(
      deviceRegistration.payload.token,
      "notification-device-token",
    );
    assert.equal(deviceRegistration.payload.platform, "android");
    assert.equal(typeof deviceRegistration.payload.created_at, "string");
    assert.equal(typeof deviceRegistration.payload.updated_at, "string");

    const storedDevice = await DeviceToken.findById(
      deviceRegistration.payload.id,
    ).lean();

    assert.ok(storedDevice);
    assert.equal(storedDevice.user.toString(), owner._id.toString());
    assert.equal(storedDevice.platform, "android");

    const deviceRemoval = await requestJson(
      baseUrl,
      "/notifications/devices",
      {
        method: "DELETE",
        token: ownerTokens.access,
        body: { token: "notification-device-token" },
      },
    );

    assert.equal(deviceRemoval.response.status, 204);
    assert.equal(deviceRemoval.payload, null);
    assert.equal(
      await DeviceToken.exists({ token: "notification-device-token" }),
      null,
    );

    const invalidDeviceRemoval = await requestJson(
      baseUrl,
      "/notifications/devices",
      {
        method: "DELETE",
        token: ownerTokens.access,
        body: { token: "" },
      },
    );

    assert.equal(invalidDeviceRemoval.response.status, 400);
    assert.equal(invalidDeviceRemoval.payload.code, "validation_error");
    assert.equal(
      invalidDeviceRemoval.payload.fields.token[0].code,
      "required",
    );

    const otherUserFeed = await requestJson(baseUrl, "/notifications", {
      token: otherTokens.access,
    });

    assert.equal(otherUserFeed.response.status, 200);
    assert.deepEqual(
      otherUserFeed.payload.results.map(({ id }) => id),
      [otherNotification._id.toString()],
    );
  },
);
