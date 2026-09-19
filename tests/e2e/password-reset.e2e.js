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

const TEST_EMAIL = "password-reset@example.com";
const TEST_PASSWORD = "correct-horse-battery-11";
const NEW_PASSWORD = "updated-horse-battery-12";
const FRONTEND_ORIGIN = "https://account-e2e.example";
const JWT_SECRET = "reset-e2e-jwt-secret-with-at-least-32-bytes";
const LOGIN_THROTTLE_SECRET =
  "reset-e2e-login-throttle-secret-with-at-least-32-bytes";
const REQUEST_THROTTLE_SECRET =
  "reset-e2e-request-throttle-secret-with-at-least-32-bytes";

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
  "password reset consumes its token and revokes existing sessions",
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

    const resetEmails = [];
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
        sendPasswordResetEmail: async (email, userId, token) => {
          resetEmails.push({
            email,
            token,
            userId: userId.toString(),
          });

          return {
            messageId: "password-reset-test-message",
            previewUrl: null,
          };
        },
      },
    });

    const User = require(fromProject("models/user.model.js"));
    const PasswordResetToken = require(
      fromProject("models/passwordResetToken.model.js"),
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

    const unknownAccountRequest = await postJson(baseUrl, "/password/reset", {
      email: "unknown-password-reset@example.com",
    });

    assert.equal(unknownAccountRequest.response.status, 200);
    assert.deepEqual(unknownAccountRequest.payload, {
      detail: "Password reset e-mail has been sent.",
    });
    assert.equal(resetEmails.length, 0);
    assert.equal(await PasswordResetToken.countDocuments(), 0);
    assert.equal(await AccountEmailJob.countDocuments(), 1);

    const unknownJob = await processNextAccountEmailJob();

    assert.equal(unknownJob.outcome, "discarded");
    assert.equal(resetEmails.length, 0);
    assert.equal(await PasswordResetToken.countDocuments(), 0);
    assert.equal(await AccountEmailJob.countDocuments(), 0);

    const resetRequest = await postJson(baseUrl, "/password/reset", {
      email: TEST_EMAIL,
    });

    assert.equal(resetRequest.response.status, 200);
    assert.deepEqual(resetRequest.payload, unknownAccountRequest.payload);
    assert.equal(resetEmails.length, 0);
    assert.equal(await AccountEmailJob.countDocuments(), 1);

    const sentJob = await processNextAccountEmailJob();

    assert.equal(sentJob.outcome, "sent");
    assert.equal(resetEmails.length, 1);
    assert.equal(await AccountEmailJob.countDocuments(), 0);

    const resetEmail = resetEmails[0];

    assert.equal(resetEmail.email, TEST_EMAIL);
    assert.equal(resetEmail.userId, user._id.toString());
    assert.match(resetEmail.token, /^[A-Za-z0-9_-]{43}$/);

    const storedResetToken = await PasswordResetToken.findOne({
      user: user._id,
    }).lean();

    assert.ok(storedResetToken);
    assert.equal(storedResetToken.tokenHash, hashToken(resetEmail.token));
    assert.notEqual(storedResetToken.tokenHash, resetEmail.token);

    const rejectedConfirmation = await postJson(
      baseUrl,
      "/password/reset/confirm",
      {
        uid: user._id.toString(),
        token: "incorrect-reset-token",
        new_password: NEW_PASSWORD,
      },
    );

    assert.equal(rejectedConfirmation.response.status, 400);
    assert.equal(rejectedConfirmation.payload.code, "validation_error");
    assert.equal(
      rejectedConfirmation.payload.fields.token[0].message,
      "Invalid value",
    );

    const userAfterRejectedConfirmation = await User.findById(user._id).lean();

    assert.equal(userAfterRejectedConfirmation.password, originalPasswordHash);
    assert.ok(await PasswordResetToken.exists({ _id: storedResetToken._id }));
    assert.equal(
      await RefreshSession.countDocuments({ user: user._id, revokedAt: null }),
      2,
    );

    const confirmation = await postJson(
      baseUrl,
      "/password/reset/confirm",
      {
        uid: user._id.toString(),
        token: resetEmail.token,
        new_password: NEW_PASSWORD,
      },
    );

    assert.equal(confirmation.response.status, 200);
    assert.deepEqual(confirmation.payload, {
      detail: "Password has been reset with the new password.",
    });
    assert.deepEqual(changedEmails, [TEST_EMAIL]);
    assert.equal(
      await PasswordResetToken.exists({ _id: storedResetToken._id }),
      null,
    );

    const userAfterReset = await User.findById(user._id).lean();
    const sessionsAfterReset = await RefreshSession.find({
      user: user._id,
    }).lean();

    assert.notEqual(userAfterReset.password, originalPasswordHash);
    assert.equal(await bcrypt.compare(TEST_PASSWORD, userAfterReset.password), false);
    assert.equal(await bcrypt.compare(NEW_PASSWORD, userAfterReset.password), true);
    assert.equal(sessionsAfterReset.length, 2);
    assert.ok(
      sessionsAfterReset.every((session) => session.revokedAt instanceof Date),
    );

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

    const reusedConfirmation = await postJson(
      baseUrl,
      "/password/reset/confirm",
      {
        uid: user._id.toString(),
        token: resetEmail.token,
        new_password: "third-horse-battery-13",
      },
    );

    assert.equal(reusedConfirmation.response.status, 400);
    assert.equal(reusedConfirmation.payload.code, "validation_error");
    assert.equal(
      reusedConfirmation.payload.fields.token[0].message,
      "Invalid value",
    );
  },
);
