const test = require("node:test");
const assert = require("node:assert/strict");
const validateProfileUpdate = require("../../validators/profileUpdate.validator");
const validateAccountDelete = require("../../validators/accountDelete.validator");

test("profile-update validator maps and trims supported names", () => {
  assert.deepEqual(
    validateProfileUpdate({
      first_name: "  Ada ",
      last_name: " Lovelace  ",
      ignored: "value",
    }),
    {
      data: { firstName: "Ada", lastName: "Lovelace" },
      fields: {},
    },
  );
});

test("profile-update validator allows a partial or empty update", () => {
  assert.deepEqual(validateProfileUpdate({ first_name: "Grace" }), {
    data: { firstName: "Grace" },
    fields: {},
  });
  assert.deepEqual(validateProfileUpdate(null), { data: {}, fields: {} });
});

test("profile-update validator rejects null, non-string, and long names", () => {
  assert.equal(validateProfileUpdate({ first_name: null }).fields.first_name[0].code, "null");
  assert.equal(validateProfileUpdate({ first_name: 1 }).fields.first_name[0].code, "invalid");
  assert.equal(
    validateProfileUpdate({ last_name: "a".repeat(151) }).fields.last_name[0].code,
    "max_length",
  );
});

test("account-delete validator accepts either reauthentication credential", () => {
  assert.deepEqual(validateAccountDelete({ password: "secret" }), {
    data: { password: "secret", code: null },
    fields: {},
  });
  assert.deepEqual(validateAccountDelete({ code: "012345" }), {
    data: { password: null, code: "012345" },
    fields: {},
  });
});

test("account-delete validator requires a credential", () => {
  const result = validateAccountDelete({});
  assert.equal(result.fields.password[0].code, "reauth_required");
});
