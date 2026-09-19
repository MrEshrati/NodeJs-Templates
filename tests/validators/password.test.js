const test = require("node:test");
const assert = require("node:assert/strict");
const validatePasswordResetRequest = require("../../validators/passwordResetRequest.validator");
const validatePasswordResetConfirm = require("../../validators/passwordResetConfirm.validator");
const validatePasswordChange = require("../../validators/passwordChange.validator");

const validUid = "0123456789abcdef01234567";

test("password-reset request normalizes a valid email", () => {
  assert.deepEqual(validatePasswordResetRequest({ email: " USER@Example.COM " }), {
    data: { email: "user@example.com" },
    fields: {},
  });
});

test("password-reset request rejects absent or unusable email", () => {
  assert.equal(validatePasswordResetRequest(null).fields.email[0].code, "required");
  assert.equal(
    validatePasswordResetRequest({ email: "invalid" }).fields.email[0].code,
    "required",
  );
});

test("password-reset confirmation accepts valid normalized data", () => {
  assert.deepEqual(
    validatePasswordResetConfirm({
      uid: `  ${validUid}  `,
      token: "  reset-token  ",
      new_password: "Correct-Horse-7",
    }),
    {
      data: {
        uid: validUid,
        token: "reset-token",
        new_password: "Correct-Horse-7",
      },
      fields: {},
    },
  );
});

test("password-reset confirmation validates uid, token, and password", () => {
  const result = validatePasswordResetConfirm({
    uid: "bad-id",
    token: "",
    new_password: "short",
  });

  assert.equal(result.fields.uid[0].code, "invalid");
  assert.equal(result.fields.token[0].code, "required");
  assert.equal(result.fields.new_password[0].code, "invalid");
});

test("password-change validator preserves valid passwords", () => {
  assert.deepEqual(
    validatePasswordChange({
      old_password: "Old Password",
      new_password: "Correct-Horse-7",
    }),
    {
      data: {
        old_password: "Old Password",
        new_password: "Correct-Horse-7",
      },
      fields: {},
    },
  );
});

test("password-change validator reports missing and weak values", () => {
  const missing = validatePasswordChange({});
  assert.equal(missing.fields.old_password[0].code, "required");
  assert.equal(missing.fields.new_password[0].code, "required");

  const weak = validatePasswordChange({
    old_password: 1,
    new_password: "12345678",
  });
  assert.equal(weak.fields.old_password[0].code, "invalid");
  assert.ok(weak.fields.new_password.every(({ code }) => code === "invalid"));
});
