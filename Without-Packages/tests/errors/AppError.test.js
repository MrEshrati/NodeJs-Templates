const test = require("node:test");
const assert = require("node:assert/strict");
const AppError = require("../../errors/AppError");

test("AppError stores API error metadata", () => {
  const fields = { email: [{ code: "invalid", message: "Invalid" }] };
  const error = new AppError("Validation failed.", 400, "validation_error", fields);

  assert.ok(error instanceof Error);
  assert.equal(error.message, "Validation failed.");
  assert.equal(error.statusCode, 400);
  assert.equal(error.code, "validation_error");
  assert.deepEqual(error.fields, fields);
});

test("AppError defaults fields to null", () => {
  const error = new AppError("Failure", 500, "internal_error");
  assert.equal(error.fields, null);
});
