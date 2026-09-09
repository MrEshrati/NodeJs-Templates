const test = require("node:test");
const assert = require("node:assert/strict");
const cors = require("../../middlewares/cors.middleware");
const { createResponse, captureNext } = require("../helpers/http");

const expectedHeaders = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "Content-Type,Authorization",
  "access-control-max-age": "600",
};

test("CORS middleware adds its policy and continues normal requests", () => {
  const res = createResponse();
  const next = captureNext();

  cors({ method: "POST" }, res, next);

  assert.deepEqual(res.headers, expectedHeaders);
  assert.equal(res.statusCode, null);
  assert.equal(res.ended, false);
  assert.deepEqual(next.calls, [undefined]);
});

test("CORS middleware completes preflight requests without continuing", () => {
  const res = createResponse();
  const next = captureNext();

  cors({ method: "OPTIONS" }, res, next);

  assert.deepEqual(res.headers, expectedHeaders);
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.deepEqual(next.calls, []);
});
