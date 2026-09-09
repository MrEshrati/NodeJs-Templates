const test = require("node:test");
const assert = require("node:assert/strict");
const validateRequest = require("../../middlewares/validation.middleware");
const errorHandler = require("../../middlewares/errorHandler.middleware");
const AppError = require("../../errors/AppError");
const { createResponse, captureNext } = require("../helpers/http");

test("validation middleware stores normalized data and continues", () => {
  const middleware = validateRequest(() => ({
    data: { email: "user@example.com" },
    fields: {},
  }));
  const req = { body: { email: " USER@EXAMPLE.COM " } };
  const next = captureNext();

  middleware(req, {}, next);

  assert.deepEqual(req.validatedBody, { email: "user@example.com" });
  assert.deepEqual(next.calls, [undefined]);
});

test("validation middleware forwards structured validation errors", () => {
  const fields = { email: [{ code: "required", message: "Required" }] };
  const middleware = validateRequest(() => ({ data: {}, fields }));
  const next = captureNext();

  middleware({ body: {} }, {}, next);

  assert.equal(next.calls.length, 1);
  assert.ok(next.calls[0] instanceof AppError);
  assert.equal(next.calls[0].statusCode, 400);
  assert.equal(next.calls[0].code, "validation_error");
  assert.deepEqual(next.calls[0].fields, fields);
});

test("validation middleware forwards unexpected validator errors", () => {
  const expected = new Error("validator failed");
  const middleware = validateRequest(() => {
    throw expected;
  });
  const next = captureNext();

  middleware({ body: {} }, {}, next);
  assert.equal(next.calls[0], expected);
});

test("error handler serializes an AppError including fields", () => {
  const res = createResponse();
  const fields = { key: [{ code: "invalid", message: "Invalid" }] };

  errorHandler(
    new AppError("Validation failed.", 400, "validation_error", fields),
    {},
    res,
    () => {},
  );

  assert.equal(res.statusCode, 400);
  assert.deepEqual(res.body, {
    error: true,
    code: "validation_error",
    message: "Validation failed.",
    fields,
  });
});

test("error handler supplies safe defaults for ordinary errors", () => {
  const res = createResponse();
  errorHandler(new Error(), {}, res, () => {});

  assert.equal(res.statusCode, 500);
  assert.deepEqual(res.body, {
    error: true,
    code: "internal_error",
    message: "Something went wrong",
  });
});
