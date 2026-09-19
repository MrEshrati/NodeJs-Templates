const test = require("node:test");
const assert = require("node:assert/strict");
const validateEmailChangeRequest = require("../../validators/emailChangeRequest.validator");
const validateEmailChangeConfirm = require("../../validators/emailChangeConfirm.validator");

test("email-change request accepts a normalized email and password", () => {
  assert.deepEqual(
    validateEmailChangeRequest({
      new_email: " NEW@Example.COM ",
      password: "current password",
    }),
    {
      data: {
        new_email: "new@example.com",
        password: "current password",
        code: null,
      },
      fields: {},
    },
  );
});

test("email-change request accepts an OTP instead of a password", () => {
  assert.deepEqual(
    validateEmailChangeRequest({
      new_email: "new@example.com",
      code: " 012345 ",
    }),
    {
      data: {
        new_email: "new@example.com",
        password: null,
        code: "012345",
      },
      fields: {},
    },
  );
});

test("email-change request validates email and reauthentication", () => {
  const result = validateEmailChangeRequest({ new_email: "bad" });
  assert.equal(result.fields.new_email[0].code, "invalid");
  assert.equal(result.fields.non_field_errors[0].code, "reauth_required");
});

test("email-change request rejects invalid credential types", () => {
  const password = validateEmailChangeRequest({
    new_email: "new@example.com",
    password: 1,
  });
  assert.equal(password.fields.password[0].code, "reauth_required");

  const code = validateEmailChangeRequest({
    new_email: "new@example.com",
    code: [],
  });
  assert.equal(code.fields.code[0].code, "reauth_required");
});

test("email-change confirmation trims its key", () => {
  assert.deepEqual(validateEmailChangeConfirm({ key: "  key  " }), {
    data: { key: "key" },
    fields: {},
  });
});

test("email-change confirmation rejects missing and invalid keys", () => {
  assert.equal(validateEmailChangeConfirm({}).fields.key[0].code, "required");
  assert.equal(validateEmailChangeConfirm({ key: {} }).fields.key[0].code, "invalid");
});
