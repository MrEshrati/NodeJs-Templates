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

const TEST_EMAIL = "account-deletion@example.com";
const TEST_PASSWORD = "correct-horse-battery-10";
const FRONTEND_ORIGIN = "https://account-e2e.example";
const JWT_SECRET = "deletion-e2e-jwt-secret-with-at-least-32-bytes";
const LOGIN_THROTTLE_SECRET =
  "deletion-e2e-login-throttle-secret-with-at-least-32-bytes";
const REQUEST_THROTTLE_SECRET =
  "deletion-e2e-request-throttle-secret-with-at-least-32-bytes";

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

test(
  "account deletion deactivates the user and revokes every refresh session",
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
    const User = require(fromProject("models/user.model.js"));
    const RefreshSession = require(
      fromProject("models/refreshSession.model.js"),
    );

    let server;

    await connectTestDatabase();

    t.after(async () => {
      await closeServer(server);
      await clearTestDatabase();
      await disconnectTestDatabase();
    });

    await clearTestDatabase();

    const user = await User.create({
      email: TEST_EMAIL,
      password: await bcrypt.hash(TEST_PASSWORD, 12),
      emailVerified: true,
      isActive: true,
    });

    server = await startServer(app);

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const firstLogin = await requestJson(baseUrl, "/auth/login", {
      method: "POST",
      body: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      },
    });
    const secondLogin = await requestJson(baseUrl, "/auth/login", {
      method: "POST",
      body: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      },
    });

    assert.equal(firstLogin.response.status, 200);
    assert.equal(secondLogin.response.status, 200);
    assert.notEqual(firstLogin.payload.refresh, secondLogin.payload.refresh);

    const activeSessions = await RefreshSession.find({
      user: user._id,
      revokedAt: null,
    }).lean();

    assert.equal(activeSessions.length, 2);

    const rejectedDeletion = await requestJson(baseUrl, "/delete", {
      method: "POST",
      token: firstLogin.payload.access,
      body: {
        password: "incorrect-password",
      },
    });

    assert.equal(rejectedDeletion.response.status, 400);
    assert.equal(rejectedDeletion.payload.code, "validation_error");
    assert.equal(
      rejectedDeletion.payload.fields.password[0].message,
      "Incorrect password.",
    );

    const userAfterRejectedDeletion = await User.findById(user._id).lean();
    const sessionsAfterRejectedDeletion = await RefreshSession.find({
      user: user._id,
    }).lean();

    assert.equal(userAfterRejectedDeletion.isActive, true);
    assert.equal(sessionsAfterRejectedDeletion.length, 2);
    assert.ok(
      sessionsAfterRejectedDeletion.every(
        (session) => session.revokedAt === null,
      ),
    );

    const deletion = await requestJson(baseUrl, "/delete", {
      method: "POST",
      token: firstLogin.payload.access,
      body: {
        password: TEST_PASSWORD,
      },
    });

    assert.equal(deletion.response.status, 204);
    assert.equal(deletion.payload, null);

    const deactivatedUser = await User.findById(user._id).lean();
    const revokedSessions = await RefreshSession.find({
      user: user._id,
    }).lean();

    assert.ok(deactivatedUser);
    assert.equal(deactivatedUser.isActive, false);
    assert.equal(revokedSessions.length, 2);
    assert.ok(
      revokedSessions.every(
        (session) => session.revokedAt instanceof Date,
      ),
    );

    const profileAfterDeletion = await requestJson(baseUrl, "/profile", {
      token: secondLogin.payload.access,
    });

    assert.equal(profileAfterDeletion.response.status, 401);
    assert.equal(profileAfterDeletion.payload.code, "user_inactive");

    for (const refresh of [
      firstLogin.payload.refresh,
      secondLogin.payload.refresh,
    ]) {
      const refreshAfterDeletion = await requestJson(
        baseUrl,
        "/auth/token/refresh",
        {
          method: "POST",
          body: { refresh },
        },
      );

      assert.equal(refreshAfterDeletion.response.status, 401);
      assert.equal(refreshAfterDeletion.payload.code, "token_not_valid");
    }

    const loginAfterDeletion = await requestJson(baseUrl, "/auth/login", {
      method: "POST",
      body: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      },
    });

    assert.equal(loginAfterDeletion.response.status, 400);
    assert.equal(loginAfterDeletion.payload.code, "validation_error");
    assert.equal(
      loginAfterDeletion.payload.fields.non_field_errors[0].message,
      "User account is disabled.",
    );
  },
);
