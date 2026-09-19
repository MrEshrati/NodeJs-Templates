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

const TEST_EMAIL = "token-lifecycle@example.com";
const TEST_PASSWORD = "correct-horse-battery-8";
const FRONTEND_ORIGIN = "https://account-e2e.example";
const JWT_SECRET = "account-e2e-jwt-secret-with-32-bytes";
const LOGIN_THROTTLE_SECRET =
  "account-e2e-login-throttle-secret-with-32-bytes";
const REQUEST_THROTTLE_SECRET =
  "account-e2e-request-throttle-secret-with-32-bytes";

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

const postJson = async (baseUrl, path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: FRONTEND_ORIGIN,
    },
    body: JSON.stringify(body),
  });

  return {
    response,
    payload: await response.json(),
  };
};

test(
  "refresh rotation and logout invalidate every consumed refresh token",
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
    const { verifyJwt } = require(fromProject("utils/jwt.utils.js"));
    const { hashToken } = require(fromProject("utils/token.utils.js"));

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

    const login = await postJson(baseUrl, "/auth/login", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    assert.equal(login.response.status, 200);

    const originalRefresh = login.payload.refresh;
    const originalPayload = verifyJwt(originalRefresh, "refresh");

    assert.ok(originalPayload);

    const originalSession = await RefreshSession.findOne({
      user: user._id,
    }).lean();

    assert.ok(originalSession);
    assert.equal(originalSession.jtiHash, hashToken(originalPayload.jti));
    assert.equal(originalSession.revokedAt, null);

    const rotation = await postJson(baseUrl, "/auth/token/refresh", {
      refresh: originalRefresh,
    });

    assert.equal(rotation.response.status, 200);
    assert.deepEqual(Object.keys(rotation.payload).sort(), [
      "access",
      "refresh",
    ]);
    assert.notEqual(rotation.payload.access, login.payload.access);
    assert.notEqual(rotation.payload.refresh, originalRefresh);

    const rotatedAccessPayload = verifyJwt(rotation.payload.access, "access");
    const rotatedRefreshPayload = verifyJwt(
      rotation.payload.refresh,
      "refresh",
    );

    assert.ok(rotatedAccessPayload);
    assert.ok(rotatedRefreshPayload);
    assert.equal(rotatedAccessPayload.sub, user._id.toString());
    assert.equal(rotatedRefreshPayload.sub, user._id.toString());

    const sessionsAfterRotation = await RefreshSession.find({
      user: user._id,
    }).lean();

    assert.equal(sessionsAfterRotation.length, 1);

    const rotatedSession = sessionsAfterRotation[0];

    assert.equal(rotatedSession._id.toString(), originalSession._id.toString());
    assert.equal(
      rotatedSession.jtiHash,
      hashToken(rotatedRefreshPayload.jti),
    );
    assert.notEqual(rotatedSession.jtiHash, originalSession.jtiHash);
    assert.equal(rotatedSession.revokedAt, null);
    assert.equal(rotatedSession.replacedByJtiHash, null);

    const originalTokenReplay = await postJson(
      baseUrl,
      "/auth/token/refresh",
      { refresh: originalRefresh },
    );

    assert.equal(originalTokenReplay.response.status, 401);
    assert.equal(originalTokenReplay.payload.code, "token_not_valid");

    const logout = await postJson(baseUrl, "/auth/logout", {
      refresh: rotation.payload.refresh,
    });

    assert.equal(logout.response.status, 200);
    assert.deepEqual(logout.payload, { detail: "Successfully logged out." });

    const loggedOutSession = await RefreshSession.findById(
      rotatedSession._id,
    ).lean();

    assert.ok(loggedOutSession.revokedAt instanceof Date);
    assert.equal(
      loggedOutSession.jtiHash,
      hashToken(rotatedRefreshPayload.jti),
    );

    const loggedOutTokenReplay = await postJson(
      baseUrl,
      "/auth/token/refresh",
      { refresh: rotation.payload.refresh },
    );

    assert.equal(loggedOutTokenReplay.response.status, 401);
    assert.equal(loggedOutTokenReplay.payload.code, "token_not_valid");
  },
);
