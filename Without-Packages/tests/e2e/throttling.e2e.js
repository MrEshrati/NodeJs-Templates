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

const TEST_EMAIL = "throttling@example.com";
const TEST_PASSWORD = "correct-horse-battery-20";
const FRONTEND_ORIGIN = "https://account-e2e.example";
const JWT_SECRET = "throttle-e2e-jwt-secret-with-at-least-32-bytes";
const LOGIN_THROTTLE_SECRET =
  "throttle-e2e-login-secret-with-at-least-32-bytes";
const REQUEST_THROTTLE_SECRET =
  "throttle-e2e-request-secret-with-at-least-32-bytes";

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
  "request and failed-login throttles enforce independent security windows",
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
    const RequestThrottle = require(
      fromProject("models/requestThrottle.model.js"),
    );
    const LoginThrottle = require(
      fromProject("models/loginThrottle.model.js"),
    );

    let server;

    await connectTestDatabase();

    t.after(async () => {
      await closeServer(server);
      await clearTestDatabase();
      await disconnectTestDatabase();
    });

    await clearTestDatabase();

    await User.create({
      email: TEST_EMAIL,
      password: await bcrypt.hash(TEST_PASSWORD, 12),
      emailVerified: true,
      firstName: "Throttle",
      lastName: "Test",
      isActive: true,
    });

    server = await startServer(app);

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const login = await requestJson(baseUrl, "/auth/login", {
      method: "POST",
      body: {
        email: TEST_EMAIL,
        password: TEST_PASSWORD,
      },
    });

    assert.equal(login.response.status, 200);

    for (let requestNumber = 1; requestNumber <= 10; requestNumber += 1) {
      const profile = await requestJson(baseUrl, "/profile", {
        token: login.payload.access,
      });

      assert.equal(profile.response.status, 200, `profile request ${requestNumber}`);
      assert.equal(profile.payload.email, TEST_EMAIL);
    }

    const throttledProfile = await requestJson(baseUrl, "/profile", {
      token: login.payload.access,
    });

    assert.equal(throttledProfile.response.status, 429);
    assert.equal(throttledProfile.payload.code, "throttled");

    const retryAfter = throttledProfile.response.headers.get("retry-after");

    assert.match(retryAfter, /^[1-9][0-9]*$/);
    assert.ok(Number(retryAfter) <= 60);

    const retrievalThrottle = await RequestThrottle.findOne({
      requestCount: 11,
    }).lean();

    assert.ok(retrievalThrottle);
    assert.match(retrievalThrottle.keyHmac, /^[a-f0-9]{64}$/);
    assert.notEqual(retrievalThrottle.keyHmac, "127.0.0.1");
    assert.equal(Object.hasOwn(retrievalThrottle, "clientKey"), false);
    assert.equal(Object.hasOwn(retrievalThrottle, "scope"), false);

    const profileUpdate = await requestJson(baseUrl, "/profile", {
      method: "PATCH",
      token: login.payload.access,
      body: {
        first_name: "Separate",
      },
    });

    assert.equal(profileUpdate.response.status, 200);
    assert.equal(profileUpdate.payload.first_name, "Separate");

    for (let attempt = 1; attempt <= 4; attempt += 1) {
      const failedLogin = await requestJson(baseUrl, "/auth/login", {
        method: "POST",
        body: {
          email: TEST_EMAIL,
          password: "incorrect-password",
        },
      });

      assert.equal(failedLogin.response.status, 400, `login attempt ${attempt}`);
      assert.equal(failedLogin.payload.code, "validation_error");
    }

    const blockingAttempt = await requestJson(baseUrl, "/auth/login", {
      method: "POST",
      body: {
        email: TEST_EMAIL,
        password: "incorrect-password",
      },
    });

    assert.equal(blockingAttempt.response.status, 429);
    assert.equal(blockingAttempt.payload.code, "throttled");
    assert.equal(
      blockingAttempt.payload.message,
      "Too many failed login attempts. Try again later.",
    );

    const correctPasswordWhileBlocked = await requestJson(
      baseUrl,
      "/auth/login",
      {
        method: "POST",
        body: {
          email: TEST_EMAIL,
          password: TEST_PASSWORD,
        },
      },
    );

    assert.equal(correctPasswordWhileBlocked.response.status, 429);
    assert.equal(correctPasswordWhileBlocked.payload.code, "throttled");

    const loginThrottle = await LoginThrottle.findOne().lean();

    assert.ok(loginThrottle);
    assert.equal(loginThrottle.failedAttempts, 5);
    assert.ok(loginThrottle.blockedUntil instanceof Date);
    assert.ok(loginThrottle.blockedUntil.getTime() > Date.now());
    assert.match(loginThrottle.emailHmac, /^[a-f0-9]{64}$/);
    assert.notEqual(loginThrottle.emailHmac, TEST_EMAIL);
    assert.equal(Object.hasOwn(loginThrottle, "email"), false);
  },
);
