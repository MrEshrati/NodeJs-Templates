const test = require("node:test");
const assert = require("node:assert/strict");
const validateRegistration = require("../../validators/register.validator");
const validateLogin = require("../../validators/login.validator");
const validateRefreshToken = require("../../validators/refreshToken.validator");
const validateVerifyEmail = require("../../validators/verifyEmail.validator");
const validateResendVerification = require("../../validators/resendVerification.validator");
const validateGoogleLogin = require("../../validators/googleLogin.validator");

test("registration normalizes valid input", () => {
  const result = validateRegistration({
    email: "  USER@Example.COM ",
    password: "Correct-Horse-7",
  });

  assert.deepEqual(result.fields, {});
  assert.deepEqual(result.data, {
    email: "user@example.com",
    password: "Correct-Horse-7",
  });
});

test("registration reports required fields and password weaknesses", () => {
  const missing = validateRegistration();
  assert.equal(missing.fields.email[0].code, "required");
  assert.equal(missing.fields.password[0].code, "required");

  const weak = validateRegistration({
    email: "not-an-email",
    password: "12345678",
  });
  assert.equal(weak.fields.email[0].code, "invalid");
  assert.deepEqual(
    weak.fields.password.map(({ code }) => code),
    ["password_entirely_numeric", "password_too_common"],
  );
});

test("login normalizes email without changing the password", () => {
  const result = validateLogin({
    email: " USER@EXAMPLE.COM ",
    password: " password with spaces ",
  });

  assert.deepEqual(result.fields, {});
  assert.deepEqual(result.data, {
    email: "user@example.com",
    password: " password with spaces ",
  });
});

test("login rejects missing and invalid credentials", () => {
  const missing = validateLogin({});
  assert.equal(missing.fields.non_field_errors[0].code, "invalid");
  assert.equal(missing.fields.password[0].code, "required");

  const invalid = validateLogin({ email: 42, password: {} });
  assert.equal(invalid.fields.email[0].code, "invalid");
  assert.equal(invalid.fields.password[0].code, "invalid");
});

test("refresh-token validator requires refresh and preserves valid input", () => {
  assert.equal(validateRefreshToken({}).fields.refresh[0].code, "required");
  assert.deepEqual(validateRefreshToken({ refresh: "token" }), {
    data: { refresh: "token" },
    fields: {},
  });
});

test("email verification validator trims a key and rejects bad values", () => {
  assert.deepEqual(validateVerifyEmail({ key: "  key  " }), {
    data: { key: "key" },
    fields: {},
  });
  assert.equal(validateVerifyEmail({}).fields.key[0].code, "required");
  assert.equal(validateVerifyEmail({ key: 12 }).fields.key[0].code, "invalid");
  assert.equal(validateVerifyEmail({ key: "   " }).fields.key[0].code, "invalid");
});

test("resend-verification validator normalizes email", () => {
  assert.deepEqual(validateResendVerification({ email: " USER@Example.com " }), {
    data: { email: "user@example.com" },
    fields: {},
  });
  assert.equal(validateResendVerification({}).fields.email[0].code, "required");
  assert.equal(
    validateResendVerification({ email: "bad" }).fields.email[0].code,
    "invalid",
  );
});

test("Google-login validator accepts only a non-empty string token", () => {
  assert.deepEqual(validateGoogleLogin({ id_token: "  google-token  " }), {
    data: { id_token: "google-token" },
    fields: {},
  });
  assert.equal(validateGoogleLogin(null).fields.id_token[0].code, "required");
  assert.equal(validateGoogleLogin({ id_token: [] }).fields.id_token[0].code, "invalid");
});
