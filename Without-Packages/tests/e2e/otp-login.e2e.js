require("dotenv").config({ quiet: true });

const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");
const {
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} = require("../helpers/database");

const TEST_EMAIL = "otp-login@example.com";
const FRONTEND_ORIGIN = "https://account-e2e.example";
const JWT_SECRET = "otp-e2e-jwt-secret-with-at-least-32-bytes";
const OTP_SECRET = "otp-e2e-code-secret-with-at-least-32-bytes";
const LOGIN_THROTTLE_SECRET =
  "otp-e2e-login-throttle-secret-with-at-least-32-bytes";
const REQUEST_THROTTLE_SECRET =
  "otp-e2e-request-throttle-secret-with-at-least-32-bytes";

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
  "OTP login protects the code and authenticates it only once",
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
    const emailServicePath = fromProject("services/email.service.js");
    const { app } = loadWithMocks(fromProject("app.js"), {
      [emailServicePath]: {
        sendOtpCodeEmail: async (email, code) => {
          otpEmails.push({ email, code });

          return {
            messageId: "otp-test-message",
            previewUrl: null,
          };
        },
      },
    });

    const User = require(fromProject("models/user.model.js"));
    const OtpCode = require(fromProject("models/otpCode.model.js"));
    const RefreshSession = require(
      fromProject("models/refreshSession.model.js"),
    );
    const { hashOtpCode } = require(fromProject("utils/otp.utils.js"));
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
      emailVerified: false,
      isActive: true,
    });

    server = await startServer(app);

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const unknownAccountRequest = await postJson(baseUrl, "/auth/otp/request", {
      email: "unknown-otp-login@example.com",
    });

    assert.equal(unknownAccountRequest.response.status, 200);
    assert.deepEqual(unknownAccountRequest.payload, {
      detail:
        "If an account exists for that address, a sign-in code has been sent to it.",
    });
    assert.equal(otpEmails.length, 0);
    assert.equal(await OtpCode.countDocuments(), 0);

    const otpRequest = await postJson(baseUrl, "/auth/otp/request", {
      email: TEST_EMAIL,
    });

    assert.equal(otpRequest.response.status, 200);
    assert.deepEqual(otpRequest.payload, unknownAccountRequest.payload);
    assert.equal(otpEmails.length, 1);

    const otpEmail = otpEmails[0];

    assert.equal(otpEmail.email, TEST_EMAIL);
    assert.match(otpEmail.code, /^[0-9]{6}$/);

    const storedOtp = await OtpCode.findOne({ user: user._id }).lean();

    assert.ok(storedOtp);
    assert.equal(storedOtp.codeHash, hashOtpCode(user._id, otpEmail.code));
    assert.notEqual(storedOtp.codeHash, otpEmail.code);
    assert.equal(storedOtp.failedAttempts, 0);
    assert.equal(storedOtp.consumedAt, null);

    const cooldownRequest = await postJson(baseUrl, "/auth/otp/request", {
      email: TEST_EMAIL,
    });

    assert.equal(cooldownRequest.response.status, 200);
    assert.deepEqual(cooldownRequest.payload, otpRequest.payload);
    assert.equal(otpEmails.length, 1);

    const otpAfterCooldownRequest = await OtpCode.findById(storedOtp._id).lean();

    assert.equal(otpAfterCooldownRequest.codeHash, storedOtp.codeHash);
    assert.equal(
      otpAfterCooldownRequest.sentAt.getTime(),
      storedOtp.sentAt.getTime(),
    );

    const wrongCode = otpEmail.code === "000000" ? "000001" : "000000";
    const rejectedVerification = await postJson(
      baseUrl,
      "/auth/otp/verify",
      {
        email: TEST_EMAIL,
        code: wrongCode,
      },
    );

    assert.equal(rejectedVerification.response.status, 401);
    assert.equal(rejectedVerification.payload.code, "otp_invalid");

    const otpAfterRejectedVerification = await OtpCode.findById(
      storedOtp._id,
    ).lean();

    assert.equal(otpAfterRejectedVerification.failedAttempts, 1);
    assert.equal(otpAfterRejectedVerification.consumedAt, null);
    assert.equal(await RefreshSession.countDocuments({ user: user._id }), 0);

    const verification = await postJson(baseUrl, "/auth/otp/verify", {
      email: TEST_EMAIL,
      code: otpEmail.code,
    });

    assert.equal(verification.response.status, 200);
    assert.deepEqual(Object.keys(verification.payload).sort(), [
      "access",
      "refresh",
    ]);

    const accessPayload = verifyJwt(verification.payload.access, "access");
    const refreshPayload = verifyJwt(verification.payload.refresh, "refresh");

    assert.ok(accessPayload);
    assert.ok(refreshPayload);
    assert.equal(accessPayload.sub, user._id.toString());
    assert.equal(refreshPayload.sub, user._id.toString());

    const authenticatedUser = await User.findById(user._id).lean();
    const consumedOtp = await OtpCode.findById(storedOtp._id).lean();
    const refreshSession = await RefreshSession.findOne({
      user: user._id,
    }).lean();

    assert.equal(authenticatedUser.emailVerified, true);
    assert.ok(consumedOtp.consumedAt instanceof Date);
    assert.equal(consumedOtp.failedAttempts, 1);
    assert.ok(refreshSession);
    assert.equal(refreshSession.jtiHash, hashToken(refreshPayload.jti));
    assert.notEqual(refreshSession.jtiHash, refreshPayload.jti);

    const reusedVerification = await postJson(baseUrl, "/auth/otp/verify", {
      email: TEST_EMAIL,
      code: otpEmail.code,
    });

    assert.equal(reusedVerification.response.status, 401);
    assert.equal(reusedVerification.payload.code, "otp_invalid");
    assert.equal(
      await RefreshSession.countDocuments({ user: user._id }),
      1,
    );
  },
);
