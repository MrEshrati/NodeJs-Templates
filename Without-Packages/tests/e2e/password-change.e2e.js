require("dotenv").config({ quiet: true });

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const { fromProject, loadWithMocks } = require("../helpers/module");
const {
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} = require("../helpers/database");

const TEST_EMAIL = "password-change@example.com";
const TEST_PASSWORD = "correct-horse-battery-14";
const NEW_PASSWORD = "updated-horse-battery-15";
const FRONTEND_ORIGIN = "https://account-e2e.example";
const JWT_SECRET = "change-e2e-jwt-secret-with-at-least-32-bytes";
const LOGIN_THROTTLE_SECRET =
  "change-e2e-login-throttle-secret-with-at-least-32-bytes";
const REQUEST_THROTTLE_SECRET =
  "change-e2e-request-throttle-secret-with-at-least-32-bytes";

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

const postJson = async (baseUrl, path, body, token) => {
  const headers = {
    "Content-Type": "application/json",
    Origin: FRONTEND_ORIGIN,
  };

  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  return {
    response,
    payload: await response.json(),
  };
};

test(
  "authenticated password change replaces credentials and revokes sessions",
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

    const changedEmails = [];
    const emailServicePath = fromProject("services/email.service.js");
    const { app } = loadWithMocks(fromProject("app.js"), {
      [emailServicePath]: {
        sendPasswordChangedEmail: async (email) => {
          changedEmails.push(email);

          return {
            messageId: "password-changed-test-message",
            previewUrl: null,
          };
        },
      },
    });

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

    const originalPasswordHash = await bcrypt.hash(TEST_PASSWORD, 12);
    const user = await User.create({
      email: TEST_EMAIL,
      password: originalPasswordHash,
      emailVerified: true,
      isActive: true,
    });

    server = await startServer(app);

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const firstLogin = await postJson(baseUrl, "/auth/login", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    const secondLogin = await postJson(baseUrl, "/auth/login", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    assert.equal(firstLogin.response.status, 200);
    assert.equal(secondLogin.response.status, 200);
    assert.equal(
      await RefreshSession.countDocuments({ user: user._id, revokedAt: null }),
      2,
    );

    const rejectedChange = await postJson(
      baseUrl,
      "/password/change",
      {
        old_password: "incorrect-password",
        new_password: NEW_PASSWORD,
      },
      firstLogin.payload.access,
    );

    assert.equal(rejectedChange.response.status, 400);
    assert.equal(rejectedChange.payload.code, "validation_error");
    assert.equal(
      rejectedChange.payload.fields.old_password[0].message,
      "Your old password was entered incorrectly. Please enter it again.",
    );

    const userAfterRejectedChange = await User.findById(user._id).lean();

    assert.equal(userAfterRejectedChange.password, originalPasswordHash);
    assert.equal(
      await RefreshSession.countDocuments({ user: user._id, revokedAt: null }),
      2,
    );
    assert.equal(changedEmails.length, 0);

    const passwordChange = await postJson(
      baseUrl,
      "/password/change",
      {
        old_password: TEST_PASSWORD,
        new_password: NEW_PASSWORD,
      },
      secondLogin.payload.access,
    );

    assert.equal(passwordChange.response.status, 200);
    assert.deepEqual(passwordChange.payload, {
      detail: "New password has been saved.",
    });
    assert.deepEqual(changedEmails, [TEST_EMAIL]);

    const userAfterChange = await User.findById(user._id).lean();
    const sessionsAfterChange = await RefreshSession.find({
      user: user._id,
    }).lean();

    assert.notEqual(userAfterChange.password, originalPasswordHash);
    assert.equal(
      await bcrypt.compare(TEST_PASSWORD, userAfterChange.password),
      false,
    );
    assert.equal(
      await bcrypt.compare(NEW_PASSWORD, userAfterChange.password),
      true,
    );
    assert.equal(sessionsAfterChange.length, 2);
    assert.ok(
      sessionsAfterChange.every(
        (session) => session.revokedAt instanceof Date,
      ),
    );

    for (const refresh of [
      firstLogin.payload.refresh,
      secondLogin.payload.refresh,
    ]) {
      const refreshAfterChange = await postJson(
        baseUrl,
        "/auth/token/refresh",
        { refresh },
      );

      assert.equal(refreshAfterChange.response.status, 401);
      assert.equal(refreshAfterChange.payload.code, "token_not_valid");
    }

    const oldPasswordLogin = await postJson(baseUrl, "/auth/login", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    assert.equal(oldPasswordLogin.response.status, 400);
    assert.equal(oldPasswordLogin.payload.code, "validation_error");

    const newPasswordLogin = await postJson(baseUrl, "/auth/login", {
      email: TEST_EMAIL,
      password: NEW_PASSWORD,
    });

    assert.equal(newPasswordLogin.response.status, 200);
    assert.equal(typeof newPasswordLogin.payload.access, "string");
    assert.equal(typeof newPasswordLogin.payload.refresh, "string");
  },
);
