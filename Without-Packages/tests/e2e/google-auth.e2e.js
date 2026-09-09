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

const FRONTEND_ORIGIN = "https://account-e2e.example";
const GOOGLE_CLIENT_ID = "account-e2e-google-client-id";
const JWT_SECRET = "google-e2e-jwt-secret-with-at-least-32-bytes";
const REQUEST_THROTTLE_SECRET =
  "google-e2e-request-throttle-secret-with-at-least-32-bytes";

const GOOGLE_PAYLOADS = new Map([
  [
    "unverified-google-token",
    {
      sub: "unverified-google-subject",
      email: "unverified-google@example.com",
      email_verified: false,
    },
  ],
  [
    "new-google-token",
    {
      sub: "new-google-subject",
      email: "New.Google@Example.COM",
      email_verified: true,
    },
  ],
  [
    "link-google-token",
    {
      sub: "linked-google-subject",
      email: "local-account@example.com",
      email_verified: true,
    },
  ],
  [
    "conflict-google-token",
    {
      sub: "attempted-google-subject",
      email: "google-conflict@example.com",
      email_verified: true,
    },
  ],
  [
    "inactive-google-token",
    {
      sub: "inactive-google-subject",
      email: "inactive-google@example.com",
      email_verified: true,
    },
  ],
]);

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

const postGoogleToken = async (baseUrl, idToken) => {
  const response = await fetch(`${baseUrl}/google`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: FRONTEND_ORIGIN,
    },
    body: JSON.stringify({ id_token: idToken }),
  });

  return {
    response,
    payload: await response.json(),
  };
};

test(
  "Google authentication creates, reuses, and safely links accounts",
  {
    skip:
      !testDatabaseConfigured &&
      "Set TEST_DB_URL to a dedicated database ending in _test.",
  },
  async (t) => {
    process.env.FRONTEND_URL = FRONTEND_ORIGIN;
    process.env.GOOGLE_CLIENT_ID = GOOGLE_CLIENT_ID;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.REQUEST_THROTTLE_SECRET = REQUEST_THROTTLE_SECRET;

    const verificationCalls = [];

    class MockOAuth2Client {
      async verifyIdToken(options) {
        verificationCalls.push({ ...options });

        if (options.idToken === "invalid-google-token") {
          throw new Error("Invalid Google token");
        }

        const payload = GOOGLE_PAYLOADS.get(options.idToken);

        if (!payload) {
          throw new Error("Unknown Google test token");
        }

        return {
          getPayload: () => ({ ...payload }),
        };
      }
    }

    const { app } = loadWithMocks(fromProject("app.js"), {
      [require.resolve("google-auth-library")]: {
        OAuth2Client: MockOAuth2Client,
      },
    });

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
    server = await startServer(app);

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const invalidAuthentication = await postGoogleToken(
      baseUrl,
      "invalid-google-token",
    );

    assert.equal(invalidAuthentication.response.status, 401);
    assert.equal(invalidAuthentication.payload.code, "authentication_failed");
    assert.equal(await User.countDocuments(), 0);
    assert.equal(await RefreshSession.countDocuments(), 0);

    const unverifiedAuthentication = await postGoogleToken(
      baseUrl,
      "unverified-google-token",
    );

    assert.equal(unverifiedAuthentication.response.status, 401);
    assert.equal(
      unverifiedAuthentication.payload.code,
      "social_email_unverified",
    );
    assert.equal(await User.countDocuments(), 0);
    assert.equal(await RefreshSession.countDocuments(), 0);

    const newAuthentication = await postGoogleToken(
      baseUrl,
      "new-google-token",
    );

    assert.equal(newAuthentication.response.status, 200);
    assert.equal(newAuthentication.payload.created, true);

    const newUser = await User.findOne({
      googleSubject: "new-google-subject",
    }).lean();

    assert.ok(newUser);
    assert.equal(newUser.email, "new.google@example.com");
    assert.equal(newUser.password, null);
    assert.equal(newUser.emailVerified, true);
    assert.equal(newUser.isActive, true);

    const newAccessPayload = verifyJwt(
      newAuthentication.payload.access,
      "access",
    );
    const newRefreshPayload = verifyJwt(
      newAuthentication.payload.refresh,
      "refresh",
    );

    assert.ok(newAccessPayload);
    assert.ok(newRefreshPayload);
    assert.equal(newAccessPayload.sub, newUser._id.toString());
    assert.equal(newRefreshPayload.sub, newUser._id.toString());

    const newUserSession = await RefreshSession.findOne({
      user: newUser._id,
    }).lean();

    assert.ok(newUserSession);
    assert.equal(newUserSession.jtiHash, hashToken(newRefreshPayload.jti));
    assert.notEqual(newUserSession.jtiHash, newRefreshPayload.jti);

    const repeatedAuthentication = await postGoogleToken(
      baseUrl,
      "new-google-token",
    );

    assert.equal(repeatedAuthentication.response.status, 200);
    assert.equal(repeatedAuthentication.payload.created, false);
    assert.equal(
      await User.countDocuments({ googleSubject: "new-google-subject" }),
      1,
    );
    assert.equal(
      await RefreshSession.countDocuments({ user: newUser._id }),
      2,
    );

    const localPasswordHash = await bcrypt.hash(
      "local-horse-battery-18",
      12,
    );
    const localUser = await User.create({
      email: "local-account@example.com",
      password: localPasswordHash,
      emailVerified: false,
      isActive: true,
    });

    const linkedAuthentication = await postGoogleToken(
      baseUrl,
      "link-google-token",
    );

    assert.equal(linkedAuthentication.response.status, 200);
    assert.equal(linkedAuthentication.payload.created, false);

    const linkedUser = await User.findById(localUser._id).lean();

    assert.equal(linkedUser.googleSubject, "linked-google-subject");
    assert.equal(linkedUser.emailVerified, true);
    assert.equal(linkedUser.password, localPasswordHash);
    assert.equal(
      await User.countDocuments({ email: "local-account@example.com" }),
      1,
    );
    assert.equal(
      await RefreshSession.countDocuments({ user: localUser._id }),
      1,
    );

    const conflictingUser = await User.create({
      email: "google-conflict@example.com",
      googleSubject: "existing-google-subject",
      emailVerified: true,
      isActive: true,
    });

    const conflictingAuthentication = await postGoogleToken(
      baseUrl,
      "conflict-google-token",
    );

    assert.equal(conflictingAuthentication.response.status, 401);
    assert.equal(
      conflictingAuthentication.payload.code,
      "authentication_failed",
    );

    const unchangedConflictingUser = await User.findById(
      conflictingUser._id,
    ).lean();

    assert.equal(
      unchangedConflictingUser.googleSubject,
      "existing-google-subject",
    );
    assert.equal(
      await RefreshSession.countDocuments({ user: conflictingUser._id }),
      0,
    );

    const inactiveUser = await User.create({
      email: "inactive-google@example.com",
      googleSubject: "inactive-google-subject",
      emailVerified: true,
      isActive: false,
    });

    const inactiveAuthentication = await postGoogleToken(
      baseUrl,
      "inactive-google-token",
    );

    assert.equal(inactiveAuthentication.response.status, 401);
    assert.equal(inactiveAuthentication.payload.code, "user_inactive");
    assert.equal(
      await RefreshSession.countDocuments({ user: inactiveUser._id }),
      0,
    );

    assert.equal(verificationCalls.length, 7);

    for (const call of verificationCalls) {
      assert.equal(call.audience, GOOGLE_CLIENT_ID);
      assert.equal(typeof call.idToken, "string");
      assert.notEqual(call.idToken, "");
    }
  },
);
