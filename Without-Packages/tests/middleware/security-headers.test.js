const test = require("node:test");
const assert = require("node:assert/strict");
const securityHeaders = require("../../middlewares/securityHeaders.middleware");
const { createResponse, captureNext } = require("../helpers/http");

test("security-header middleware sets the complete API policy", () => {
  const res = createResponse();
  const next = captureNext();

  securityHeaders({}, res, next);

  assert.deepEqual(res.headers, {
    "cache-control": "no-store",
    pragma: "no-cache",
    "x-content-type-options": "nosniff",
    "x-frame-options": "DENY",
    "referrer-policy": "no-referrer",
    "content-security-policy": "default-src 'none'",
  });
  assert.deepEqual(next.calls, [undefined]);
});
