require("dotenv").config({ quiet: true });

const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");
const {
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} = require("../helpers/database");

const EMAIL_CHANGE_USER = "passwordless-email-change@example.com";
const CHANGED_EMAIL = "passwordless-email-updated@example.com";
const DELETION_USER = "passwordless-deletion@example.com";
const FRONTEND_ORIGIN = "https://account-e2e.example";
const JWT_SECRET = "passwordless-e2e-jwt-secret-with-at-least-32-bytes";
const OTP_SECRET = "passwordless-e2e-otp-secret-with-at-least-32-bytes";
const LOGIN_THROTTLE_SECRET =
  "passwordless-e2e-login-secret-with-at-least-32-bytes";
const REQUEST_THROTTLE_SECRET =
  "passwordless-e2e-request-secret-with-at-least-32-bytes";

const testDatabaseConfigured =
  typeof process.env.TEST_DB_URL === "string" &&
  process.env.TEST_DB_URL.trim() !== "";

const differentOtp = (code) => (code === "000000" ? "000001" : "000000");

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
  const responseText = await response.text();

  return {
    response,
    payload: responseText === "" ? null : JSON.parse(responseText),
  };
};

test(
  "passwordless users reauthenticate sensitive actions with one-time codes",
  {
    skip:
      !testDatabaseConfigured &&
      "Set TEST_DB_URL to a dedicated database ending in _test.",
  },
  async (t) => {
    process.env.FRONTEND_URL = FRONTEND_ORIGIN;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.OTP_SECRET = OTP_SECRET;
    process.env.LOGIN_THROTTLE_SECRET = LOGIN_THROTTLE_SECRET;
    process.env.REQUEST_THROTTLE_SECRET = REQUEST_THROTTLE_SECRET;

    const otpEmails = [];
    const confirmationEmails = [];
    const changedEmails = [];
    const emailServicePath = fromProject("services/email.service.js");
    const { app } = loadWithMocks(fromProject("app.js"), {
      [emailServicePath]: {
        sendEmailChangeConfirmationEmail: async (email, token) => {
          confirmationEmails.push({ email, token });

          return {
            messageId: "passwordless-email-change-test-message",
            previewUrl: null,
          };
        },
        sendEmailChangedEmail: async (email) => {
          changedEmails.push(email);

          return {
            messageId: "passwordless-email-changed-test-message",
            previewUrl: null,
          };
        },
        sendOtpCodeEmail: async (email, code) => {
          otpEmails.push({ email, code });

          return {
            messageId: "passwordless-otp-test-message",
            previewUrl: null,
          };
        },
      },
    });

    const User = require(fromProject("models/user.model.js"));
    const OtpCode = require(fromProject("models/otpCode.model.js"));
    const EmailChangeToken = require(
      fromProject("models/emailChangeToken.model.js"),
    );
    const RefreshSession = require(
      fromProject("models/refreshSession.model.js"),
    );
    const { issueTokenPair } = require(
      fromProject("services/token.service.js"),
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

    const emailChangeUser = await User.create({
      email: EMAIL_CHANGE_USER,
      googleSubject: "passwordless-email-change-subject",
      password: null,
      emailVerified: true,
      isActive: true,
    });
    const deletionUser = await User.create({
      email: DELETION_USER,
      googleSubject: "passwordless-deletion-subject",
      password: null,
      emailVerified: true,
      isActive: true,
    });

    const emailChangeTokens = await issueTokenPair(emailChangeUser._id);
    const deletionTokens = await issueTokenPair(deletionUser._id);

    server = await startServer(app);

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const emailChangeOtpRequest = await postJson(
      baseUrl,
      "/auth/otp/request",
      { email: EMAIL_CHANGE_USER },
    );

    assert.equal(emailChangeOtpRequest.response.status, 200);
    assert.equal(otpEmails.length, 1);

    const emailChangeOtp = otpEmails[0];

    assert.equal(emailChangeOtp.email, EMAIL_CHANGE_USER);
    assert.match(emailChangeOtp.code, /^[0-9]{6}$/);

    const rejectedEmailChange = await postJson(
      baseUrl,
      "/email/change",
      {
        new_email: CHANGED_EMAIL,
        code: differentOtp(emailChangeOtp.code),
      },
      emailChangeTokens.access,
    );

    assert.equal(rejectedEmailChange.response.status, 400);
    assert.equal(rejectedEmailChange.payload.code, "validation_error");
    assert.equal(
      rejectedEmailChange.payload.fields.code[0].message,
      "Invalid or expired code.",
    );
    assert.equal(confirmationEmails.length, 0);
    assert.equal(await EmailChangeToken.countDocuments(), 0);

    const emailOtpAfterRejection = await OtpCode.findOne({
      user: emailChangeUser._id,
    }).lean();

    assert.equal(emailOtpAfterRejection.failedAttempts, 1);
    assert.equal(emailOtpAfterRejection.consumedAt, null);

    const emailChangeRequest = await postJson(
      baseUrl,
      "/email/change",
      {
        new_email: CHANGED_EMAIL,
        code: emailChangeOtp.code,
      },
      emailChangeTokens.access,
    );

    assert.equal(emailChangeRequest.response.status, 200);
    assert.equal(confirmationEmails.length, 1);

    const consumedEmailOtp = await OtpCode.findById(
      emailOtpAfterRejection._id,
    ).lean();
    const changeToken = await EmailChangeToken.findOne({
      user: emailChangeUser._id,
    }).lean();
    const confirmationEmail = confirmationEmails[0];

    assert.ok(consumedEmailOtp.consumedAt instanceof Date);
    assert.equal(confirmationEmail.email, CHANGED_EMAIL);
    assert.ok(changeToken);
    assert.equal(changeToken.tokenHash, hashToken(confirmationEmail.token));
    assert.notEqual(changeToken.tokenHash, confirmationEmail.token);

    const emailConfirmation = await postJson(
      baseUrl,
      "/email/change/confirm",
      { key: confirmationEmail.token },
    );

    assert.equal(emailConfirmation.response.status, 200);
    assert.deepEqual(emailConfirmation.payload, {
      detail: "Email address updated.",
    });

    const changedUser = await User.findById(emailChangeUser._id).lean();
    const emailChangeSession = await RefreshSession.findOne({
      user: emailChangeUser._id,
    }).lean();

    assert.equal(changedUser.email, CHANGED_EMAIL);
    assert.deepEqual(changedEmails, [EMAIL_CHANGE_USER]);
    assert.ok(emailChangeSession.revokedAt instanceof Date);

    const deletionOtpRequest = await postJson(
      baseUrl,
      "/auth/otp/request",
      { email: DELETION_USER },
    );

    assert.equal(deletionOtpRequest.response.status, 200);
    assert.equal(otpEmails.length, 2);

    const deletionOtp = otpEmails[1];

    assert.equal(deletionOtp.email, DELETION_USER);
    assert.match(deletionOtp.code, /^[0-9]{6}$/);

    const rejectedDeletion = await postJson(
      baseUrl,
      "/delete",
      { code: differentOtp(deletionOtp.code) },
      deletionTokens.access,
    );

    assert.equal(rejectedDeletion.response.status, 400);
    assert.equal(rejectedDeletion.payload.code, "validation_error");

    const userAfterRejectedDeletion = await User.findById(
      deletionUser._id,
    ).lean();
    const deletionOtpAfterRejection = await OtpCode.findOne({
      user: deletionUser._id,
    }).lean();

    assert.equal(userAfterRejectedDeletion.isActive, true);
    assert.equal(deletionOtpAfterRejection.failedAttempts, 1);
    assert.equal(deletionOtpAfterRejection.consumedAt, null);

    const deletion = await postJson(
      baseUrl,
      "/delete",
      { code: deletionOtp.code },
      deletionTokens.access,
    );

    assert.equal(deletion.response.status, 204);
    assert.equal(deletion.payload, null);

    const deactivatedUser = await User.findById(deletionUser._id).lean();
    const consumedDeletionOtp = await OtpCode.findById(
      deletionOtpAfterRejection._id,
    ).lean();
    const deletionSession = await RefreshSession.findOne({
      user: deletionUser._id,
    }).lean();

    assert.equal(deactivatedUser.isActive, false);
    assert.ok(consumedDeletionOtp.consumedAt instanceof Date);
    assert.ok(deletionSession.revokedAt instanceof Date);
  },
);
