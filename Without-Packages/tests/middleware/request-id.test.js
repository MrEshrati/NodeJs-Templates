const test = require("node:test");
const assert = require("node:assert/strict");
const requestId = require("../../middlewares/requestId.middleware");
const { createResponse, captureNext } = require("../helpers/http");

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const runMiddleware = (incomingId) => {
  const req = {
    headers: {
      "x-request-id": incomingId,
    },
  };
  const res = createResponse();
  const next = captureNext();

  requestId(req, res, next);

  return { next, req, res };
};

test("request ID middleware assigns and returns a UUID", () => {
  const { next, req, res } = runMiddleware(undefined);

  assert.match(req.requestId, UUID_PATTERN);
  assert.equal(res.headers["x-request-id"], req.requestId);
  assert.deepEqual(next.calls, [undefined]);
});

test("request ID middleware ignores client IDs and generates fresh values", () => {
  const clientId = "client-controlled-value";
  const first = runMiddleware(clientId);
  const second = runMiddleware(clientId);

  assert.notEqual(first.req.requestId, clientId);
  assert.notEqual(second.req.requestId, clientId);
  assert.notEqual(first.req.requestId, second.req.requestId);
});
