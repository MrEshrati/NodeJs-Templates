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

const TEST_EMAIL = "profile-workflow@example.com";
const TEST_PASSWORD = "correct-horse-battery-9";
const FRONTEND_ORIGIN = "https://account-e2e.example";
const JWT_SECRET = "profile-e2e-jwt-secret-with-at-least-32-bytes";
const LOGIN_THROTTLE_SECRET =
  "profile-e2e-login-throttle-secret-with-at-least-32-bytes";
const REQUEST_THROTTLE_SECRET =
  "profile-e2e-request-throttle-secret-with-at-least-32-bytes";

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

  return {
    response,
    payload: await response.json(),
  };
};

test(
  "access authentication protects profile retrieval and modification",
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
      firstName: "Initial",
      lastName: "Profile",
      isActive: true,
    });

    server = await startServer(app);

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const unauthenticatedProfile = await requestJson(baseUrl, "/profile");

    assert.equal(unauthenticatedProfile.response.status, 401);
    assert.equal(unauthenticatedProfile.payload.code, "not_authenticated");

    const login = await requestJson(baseUrl, "/auth/login", {
      method: "POST",
      body: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      },
    });

    assert.equal(login.response.status, 200);

    const initialProfile = await requestJson(baseUrl, "/profile", {
      token: login.payload.access,
    });

    assert.equal(initialProfile.response.status, 200);
    assert.deepEqual(initialProfile.payload, {
      email: TEST_EMAIL,
      first_name: "Initial",
      last_name: "Profile",
    });

    const profileUpdate = await requestJson(baseUrl, "/profile", {
      method: "PATCH",
      token: login.payload.access,
      body: {
        first_name: "Updated",
        last_name: "Account",
      },
    });

    assert.equal(profileUpdate.response.status, 200);
    assert.deepEqual(profileUpdate.payload, {
      email: TEST_EMAIL,
      first_name: "Updated",
      last_name: "Account",
    });

    const storedUser = await User.findById(user._id).lean();

    assert.equal(storedUser.firstName, "Updated");
    assert.equal(storedUser.lastName, "Account");

    const updatedProfile = await requestJson(baseUrl, "/profile", {
      token: login.payload.access,
    });

    assert.equal(updatedProfile.response.status, 200);
    assert.deepEqual(updatedProfile.payload, profileUpdate.payload);

    const refreshAsAccess = await requestJson(baseUrl, "/profile", {
      token: login.payload.refresh,
    });

    assert.equal(refreshAsAccess.response.status, 401);
    assert.equal(refreshAsAccess.payload.code, "token_not_valid");

    const rejectedPut = await requestJson(baseUrl, "/profile", {
      method: "PUT",
      token: login.payload.access,
      body: {
        first_name: "Ignored",
      },
    });

    assert.equal(rejectedPut.response.status, 405);
    assert.equal(rejectedPut.payload.code, "method_not_allowed");
    assert.equal(rejectedPut.response.headers.get("allow"), "GET, PATCH");

    const userAfterRejectedPut = await User.findById(user._id).lean();

    assert.equal(userAfterRejectedPut.firstName, "Updated");
    assert.equal(userAfterRejectedPut.lastName, "Account");
  },
);
