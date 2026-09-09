const test = require("node:test");
const assert = require("node:assert/strict");
const validateOtpRequest = require("../../validators/otpRequest.validator");
const validateOtpVerify = require("../../validators/otpVerify.validator");

test("OTP request normalizes a valid email", () => {
  assert.deepEqual(validateOtpRequest({ email: " USER@Example.COM " }), {
    data: { email: "user@example.com" },
    fields: {},
  });
});

test("OTP request reports missing, non-string, and malformed email", () => {
  assert.equal(validateOtpRequest({}).fields.email[0].code, "required");
  assert.equal(validateOtpRequest({ email: 10 }).fields.email[0].code, "invalid");
  assert.equal(validateOtpRequest({ email: "bad" }).fields.email[0].code, "invalid");
});

test("OTP verification normalizes email and preserves its code", () => {
  assert.deepEqual(
    validateOtpVerify({ email: " USER@Example.COM ", code: "012345" }),
    {
      data: { email: "user@example.com", code: "012345" },
      fields: {},
    },
  );
});

test("OTP verification reports missing fields", () => {
  const result = validateOtpVerify({});
  assert.equal(result.fields.email[0].code, "required");
  assert.equal(result.fields.code[0].code, "required");
});
