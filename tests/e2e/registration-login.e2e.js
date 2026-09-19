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

const TEST_EMAIL = "registration-flow@example.com";
const TEST_PASSWORD = "correct-horse-battery-7";
const FRONTEND_ORIGIN = "https://account-e2e.example";
const JWT_SECRET = "account-e2e-jwt-secret-with-at-least-32-bytes";
const LOGIN_THROTTLE_SECRET =
  "account-e2e-login-throttle-secret-with-at-least-32-bytes";
const REQUEST_THROTTLE_SECRET =
  "account-e2e-request-throttle-secret-with-at-least-32-bytes";

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
  "registration, email verification, and password login work together",
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

    let verificationToken = null;
    let verificationRecipient = null;
    let server;

    const emailServicePath = fromProject("services/email.service.js");
    const { app } = loadWithMocks(fromProject("app.js"), {
      [emailServicePath]: {
        sendAccountExistsEmail: async () => ({
          messageId: "account-exists-test-message",
          previewUrl: null,
        }),
        sendVerificationEmail: async (email, token) => {
          verificationRecipient = email;
          verificationToken = token;

          return {
            messageId: "verification-test-message",
            previewUrl: null,
          };
        },
      },
    });

    const User = require(fromProject("models/user.model.js"));
    const EmailVerificationToken = require(
      fromProject("models/emailVerificationToken.model.js"),
    );
    const RefreshSession = require(
      fromProject("models/refreshSession.model.js"),
    );
    const { verifyJwt } = require(fromProject("utils/jwt.utils.js"));
    const { hashToken } = require(fromProject("utils/token.utils.js"));

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

    const registration = await postJson(baseUrl, "/auth/register", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    assert.equal(registration.response.status, 201);
    assert.deepEqual(registration.payload, {
      detail: "Verification e-mail sent.",
    });
    assert.equal(verificationRecipient, TEST_EMAIL);
    assert.match(verificationToken, /^[A-Za-z0-9_-]{43}$/);

    const registeredUser = await User.findOne({ email: TEST_EMAIL }).lean();

    assert.ok(registeredUser);
    assert.equal(registeredUser.emailVerified, false);
    assert.notEqual(registeredUser.password, TEST_PASSWORD);
    assert.equal(
      await bcrypt.compare(TEST_PASSWORD, registeredUser.password),
      true,
    );

    const storedVerification = await EmailVerificationToken.findOne({
      user: registeredUser._id,
    }).lean();

    assert.ok(storedVerification);
    assert.equal(storedVerification.tokenHash, hashToken(verificationToken));
    assert.notEqual(storedVerification.tokenHash, verificationToken);

    const loginBeforeVerification = await postJson(baseUrl, "/auth/login", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    assert.equal(loginBeforeVerification.response.status, 400);
    assert.equal(loginBeforeVerification.payload.code, "validation_error");
    assert.equal(
      loginBeforeVerification.payload.fields.non_field_errors[0].message,
      "E-mail is not verified.",
    );

    const verification = await postJson(baseUrl, "/auth/verify-email", {
      key: verificationToken,
    });

    assert.equal(verification.response.status, 200);
    assert.deepEqual(verification.payload, { detail: "ok" });

    const verifiedUser = await User.findById(registeredUser._id).lean();

    assert.equal(verifiedUser.emailVerified, true);
    assert.equal(
      await EmailVerificationToken.exists({ user: registeredUser._id }),
      null,
    );

    const reusedVerification = await postJson(baseUrl, "/auth/verify-email", {
      key: verificationToken,
    });

    assert.equal(reusedVerification.response.status, 400);
    assert.equal(reusedVerification.payload.code, "validation_error");
    assert.equal(
      reusedVerification.payload.fields.key[0].message,
      "Invalid or expired confirmation key.",
    );

    const login = await postJson(baseUrl, "/auth/login", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    assert.equal(login.response.status, 200);
    assert.deepEqual(Object.keys(login.payload).sort(), ["access", "refresh"]);

    const accessPayload = verifyJwt(login.payload.access, "access");
    const refreshPayload = verifyJwt(login.payload.refresh, "refresh");

    assert.ok(accessPayload);
    assert.ok(refreshPayload);
    assert.equal(accessPayload.sub, registeredUser._id.toString());
    assert.equal(refreshPayload.sub, registeredUser._id.toString());

    const refreshSession = await RefreshSession.findOne({
      user: registeredUser._id,
    }).lean();

    assert.ok(refreshSession);
    assert.equal(refreshSession.jtiHash, hashToken(refreshPayload.jti));
    assert.notEqual(refreshSession.jtiHash, refreshPayload.jti);
    assert.equal(refreshSession.revokedAt, null);
  },
);
