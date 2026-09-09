const test = require("node:test");
const assert = require("node:assert/strict");
const validateEmail = require("../../validators/email.validator");
const validatePassword = require("../../validators/password.validator");

test("email validator accepts a normal address and surrounding whitespace", () => {
  assert.equal(validateEmail("user@example.com"), true);
  assert.equal(validateEmail("  user@example.com  "), true);
});

test("email validator accepts common local-part characters and subdomains", () => {
  const validEmails = [
    "user+tag@example.com",
    "first.last@mail.example.com",
    "user@example.co.uk",
    "customer/department=shipping@example.com",
    "user_name@example.museum",
  ];

  for (const email of validEmails) {
    assert.equal(validateEmail(email), true, email);
  }
});

test("email validator rejects malformed addresses", () => {
  const invalidEmails = [
    "example.com",
    "@example.com",
    "user@@example.com",
    ".user@example.com",
    "user.@example.com",
    "user..name@example.com",
    "user@example",
    "user@example.c",
    "user@exa mple.com",
    "user@-example.com",
    "user@example-.com",
    "user@example..com",
    "user name@example.com",
    "user@example.12",
    "user@exam_ple.com",
  ];

  for (const email of invalidEmails) {
    assert.equal(validateEmail(email), false, email);
  }
});

test("email validator returns false for non-string values", () => {
  const invalidValues = [undefined, null, 42, {}, []];

  for (const value of invalidValues) {
    assert.equal(validateEmail(value), false);
  }
});

test("email validator enforces address, local-part, and domain-label limits", () => {
  assert.equal(validateEmail(`${"a".repeat(65)}@example.com`), false);
  assert.equal(validateEmail(`${"a".repeat(243)}@example.com`), false);
  assert.equal(validateEmail(`user@${"a".repeat(64)}.com`), false);
});

test("password validator accepts a non-common password of sufficient length", () => {
  assert.deepEqual(validatePassword("Correct-Horse-7"), []);
});

test("password validator reports every applicable weakness", () => {
  assert.deepEqual(
    validatePassword("12345678").map(({ code }) => code),
    ["password_entirely_numeric", "password_too_common"],
  );
  assert.deepEqual(
    validatePassword("short").map(({ code }) => code),
    ["password_too_short"],
  );
});

test("password validator applies bcrypt's 72-byte UTF-8 limit", () => {
  assert.deepEqual(validatePassword("a".repeat(72)), []);
  assert.deepEqual(
    validatePassword("é".repeat(37)).map(({ code }) => code),
    ["password_too_long"],
  );
});
