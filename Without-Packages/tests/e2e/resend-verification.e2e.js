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

const TEST_EMAIL = "resend-verification@example.com";
const TEST_PASSWORD = "correct-horse-battery-19";
const FRONTEND_ORIGIN = "https://account-e2e.example";
const JWT_SECRET = "resend-e2e-jwt-secret-with-at-least-32-bytes";
const LOGIN_THROTTLE_SECRET =
  "resend-e2e-login-throttle-secret-with-at-least-32-bytes";
const REQUEST_THROTTLE_SECRET =
  "resend-e2e-request-throttle-secret-with-at-least-32-bytes";

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
  "verification resend is private, throttled, and stops after confirmation",
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

    const verificationEmails = [];
    const emailServicePath = fromProject("services/email.service.js");
    const { app } = loadWithMocks(fromProject("app.js"), {
      [emailServicePath]: {
        sendVerificationEmail: async (email, token) => {
          verificationEmails.push({ email, token });

          return {
            messageId: "resend-verification-test-message",
            previewUrl: null,
          };
        },
      },
    });

    const User = require(fromProject("models/user.model.js"));
    const EmailVerificationToken = require(
      fromProject("models/emailVerificationToken.model.js"),
    );
    const AccountEmailJob = require(
      fromProject("models/accountEmailJob.model.js"),
    );
    const { processNextAccountEmailJob } = require(
      fromProject("workers/accountEmail.worker.js"),
    );
    const RefreshSession = require(
      fromProject("models/refreshSession.model.js"),
    );
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
      emailVerified: false,
      isActive: true,
    });

    server = await startServer(app);

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const unknownAccountRequest = await postJson(
      baseUrl,
      "/auth/resend-verification",
      { email: "unknown-resend-verification@example.com" },
    );

    assert.equal(unknownAccountRequest.response.status, 200);
    assert.deepEqual(unknownAccountRequest.payload, { detail: "ok" });
    assert.equal(verificationEmails.length, 0);
    assert.equal(await EmailVerificationToken.countDocuments(), 0);
    assert.equal(await AccountEmailJob.countDocuments(), 1);

    const unknownJob = await processNextAccountEmailJob();

    assert.equal(unknownJob.outcome, "discarded");
    assert.equal(verificationEmails.length, 0);
    assert.equal(await EmailVerificationToken.countDocuments(), 0);
    assert.equal(await AccountEmailJob.countDocuments(), 0);

    const resendRequest = await postJson(
      baseUrl,
      "/auth/resend-verification",
      { email: TEST_EMAIL },
    );

    assert.equal(resendRequest.response.status, 200);
    assert.deepEqual(resendRequest.payload, unknownAccountRequest.payload);
    assert.equal(verificationEmails.length, 0);
    assert.equal(await AccountEmailJob.countDocuments(), 1);

    const sentJob = await processNextAccountEmailJob();

    assert.equal(sentJob.outcome, "sent");
    assert.equal(verificationEmails.length, 1);
    assert.equal(await AccountEmailJob.countDocuments(), 0);

    const verificationEmail = verificationEmails[0];

    assert.equal(verificationEmail.email, TEST_EMAIL);
    assert.match(verificationEmail.token, /^[A-Za-z0-9_-]{43}$/);

    const storedToken = await EmailVerificationToken.findOne({
      user: user._id,
    }).lean();

    assert.ok(storedToken);
    assert.equal(storedToken.tokenHash, hashToken(verificationEmail.token));
    assert.notEqual(storedToken.tokenHash, verificationEmail.token);

    const cooldownRequest = await postJson(
      baseUrl,
      "/auth/resend-verification",
      { email: TEST_EMAIL },
    );

    assert.equal(cooldownRequest.response.status, 200);
    assert.deepEqual(cooldownRequest.payload, resendRequest.payload);
    assert.equal(await AccountEmailJob.countDocuments(), 1);

    const cooldownJob = await processNextAccountEmailJob();

    assert.equal(cooldownJob.outcome, "discarded");
    assert.equal(verificationEmails.length, 1);
    assert.equal(await AccountEmailJob.countDocuments(), 0);

    const tokenAfterCooldownRequest = await EmailVerificationToken.findById(
      storedToken._id,
    ).lean();

    assert.equal(tokenAfterCooldownRequest.tokenHash, storedToken.tokenHash);
    assert.equal(
      tokenAfterCooldownRequest.updatedAt.getTime(),
      storedToken.updatedAt.getTime(),
    );

    const verification = await postJson(baseUrl, "/auth/verify-email", {
      key: verificationEmail.token,
    });

    assert.equal(verification.response.status, 200);
    assert.deepEqual(verification.payload, { detail: "ok" });

    const verifiedUser = await User.findById(user._id).lean();

    assert.equal(verifiedUser.emailVerified, true);
    assert.equal(
      await EmailVerificationToken.exists({ _id: storedToken._id }),
      null,
    );

    const verifiedAccountRequest = await postJson(
      baseUrl,
      "/auth/resend-verification",
      { email: TEST_EMAIL },
    );

    assert.equal(verifiedAccountRequest.response.status, 200);
    assert.deepEqual(verifiedAccountRequest.payload, resendRequest.payload);
    assert.equal(await AccountEmailJob.countDocuments(), 1);

    const verifiedJob = await processNextAccountEmailJob();

    assert.equal(verifiedJob.outcome, "discarded");
    assert.equal(verificationEmails.length, 1);
    assert.equal(await EmailVerificationToken.countDocuments(), 0);
    assert.equal(await AccountEmailJob.countDocuments(), 0);

    const login = await postJson(baseUrl, "/auth/login", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    assert.equal(login.response.status, 200);
    assert.equal(typeof login.payload.access, "string");
    assert.equal(typeof login.payload.refresh, "string");
    assert.equal(
      await RefreshSession.countDocuments({ user: user._id, revokedAt: null }),
      1,
    );
  },
);
