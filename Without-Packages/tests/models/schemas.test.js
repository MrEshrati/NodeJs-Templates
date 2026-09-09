const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const User = require("../../models/user.model");
const RefreshSession = require("../../models/refreshSession.model");
const EmailVerificationToken = require("../../models/emailVerificationToken.model");
const OtpCode = require("../../models/otpCode.model");
const PasswordResetToken = require("../../models/passwordResetToken.model");
const EmailChangeToken = require("../../models/emailChangeToken.model");
const LoginThrottle = require("../../models/loginThrottle.model");
const RequestThrottle = require("../../models/requestThrottle.model");

const objectId = () => new mongoose.Types.ObjectId();

const getValidationError = async (document) => {
  try {
    await document.validate();
    return null;
  } catch (error) {
    return error;
  }
};

const hasTtlIndex = (model) =>
  model.schema.indexes().some(
    ([keys, options]) => keys.expiresAt === 1 && options.expireAfterSeconds === 0,
  );

test("User schema normalizes email and applies safe defaults", async () => {
  const user = new User({ email: "  USER@Example.COM  " });
  assert.equal(user.email, "user@example.com");
  assert.equal(user.password, null);
  assert.equal(user.emailVerified, false);
  assert.equal(user.firstName, "");
  assert.equal(user.lastName, "");
  assert.equal(user.isActive, true);
  await assert.doesNotReject(user.validate());
});

test("User schema validates names and Google subjects", async () => {
  const longName = new User({ email: "user@example.com", firstName: "a".repeat(151) });
  assert.ok((await getValidationError(longName)).errors.firstName);

  const blankSubject = new User({ email: "user@example.com", googleSubject: "   " });
  assert.ok((await getValidationError(blankSubject)).errors.googleSubject);
});

test("refresh-session schema requires its identity and has a TTL index", async () => {
  const valid = new RefreshSession({
    user: objectId(),
    jtiHash: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
  });
  assert.equal(valid.revokedAt, null);
  await assert.doesNotReject(valid.validate());
  assert.equal(hasTtlIndex(RefreshSession), true);

  const invalid = new RefreshSession({});
  const errors = (await getValidationError(invalid)).errors;
  assert.ok(errors.user);
  assert.ok(errors.jtiHash);
  assert.ok(errors.expiresAt);
});

test("temporary token schemas have zero-delay TTL indexes", () => {
  assert.equal(hasTtlIndex(EmailVerificationToken), true);
  assert.equal(hasTtlIndex(PasswordResetToken), true);
  assert.equal(hasTtlIndex(EmailChangeToken), true);
  assert.equal(hasTtlIndex(OtpCode), true);
  assert.equal(hasTtlIndex(LoginThrottle), true);
  assert.equal(hasTtlIndex(RequestThrottle), true);
});

test("OTP schema limits failed attempts", async () => {
  const otp = new OtpCode({
    user: objectId(),
    codeHash: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
    failedAttempts: 6,
  });
  assert.ok((await getValidationError(otp)).errors.failedAttempts);
});

test("email-change token normalizes both addresses", async () => {
  const token = new EmailChangeToken({
    user: objectId(),
    oldEmail: " OLD@Example.COM ",
    newEmail: " NEW@Example.COM ",
    tokenHash: "a".repeat(64),
    expiresAt: new Date(Date.now() + 60_000),
  });

  assert.equal(token.oldEmail, "old@example.com");
  assert.equal(token.newEmail, "new@example.com");
  await assert.doesNotReject(token.validate());
});

test("throttle schemas require integer counters and hexadecimal HMACs", async () => {
  const loginThrottle = new LoginThrottle({
    emailHmac: "not-a-hash",
    failedAttempts: 1.5,
    windowStartedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  });
  const loginErrors = (await getValidationError(loginThrottle)).errors;
  assert.ok(loginErrors.emailHmac);
  assert.ok(loginErrors.failedAttempts);

  const requestThrottle = new RequestThrottle({
    keyHmac: "a".repeat(64),
    requestCount: 2,
    windowStartedAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  });
  await assert.doesNotReject(requestThrottle.validate());
});
