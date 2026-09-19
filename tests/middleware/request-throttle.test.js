const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");
const { createResponse, captureNext } = require("../helpers/http");

const target = fromProject("middlewares", "requestThrottle.middleware.js");
const service = fromProject("services", "requestThrottle.service.js");

const loadFactory = (consumeRequestThrottle) =>
  loadWithMocks(target, {
    [service]: { consumeRequestThrottle },
  });

test("request-throttle factory validates its configuration", () => {
  const createRequestThrottle = loadFactory(async () => ({ throttled: false }));

  assert.throws(() => createRequestThrottle(), /scope/);
  assert.throws(
    () => createRequestThrottle({ scope: "scope", maxRequests: 0, windowMs: 1 }),
    /maxRequests/,
  );
  assert.throws(
    () => createRequestThrottle({ scope: "scope", maxRequests: 1, windowMs: 0 }),
    /windowMs/,
  );
});

test("request-throttle middleware continues for an allowed request", async () => {
  let received;
  const createRequestThrottle = loadFactory(async (options) => {
    received = options;
    return { throttled: false, retryAfterSeconds: 0 };
  });
  const middleware = createRequestThrottle({
    scope: "  login:v1  ",
    maxRequests: 10,
    windowMs: 60_000,
  });
  const next = captureNext();

  await middleware({ ip: "127.0.0.1" }, createResponse(), next);

  assert.deepEqual(received, {
    scope: "login:v1",
    clientKey: "127.0.0.1",
    maxRequests: 10,
    windowMs: 60_000,
  });
  assert.deepEqual(next.calls, [undefined]);
});

test("request-throttle middleware sets Retry-After and forwards a 429 error", async () => {
  const createRequestThrottle = loadFactory(async () => ({
    throttled: true,
    retryAfterSeconds: 37,
  }));
  const middleware = createRequestThrottle({
    scope: "login:v1",
    maxRequests: 10,
    windowMs: 60_000,
  });
  const res = createResponse();
  const next = captureNext();

  await middleware({ ip: "127.0.0.1" }, res, next);

  assert.equal(res.headers["retry-after"], "37");
  assert.equal(next.calls[0].statusCode, 429);
  assert.equal(next.calls[0].code, "throttled");
  assert.match(next.calls[0].message, /60 seconds/);
});

test("request-throttle middleware rejects an invalid service result", async () => {
  const createRequestThrottle = loadFactory(async () => ({ throttled: true }));
  const middleware = createRequestThrottle({
    scope: "login:v1",
    maxRequests: 10,
    windowMs: 60_000,
  });
  const next = captureNext();

  await middleware({ ip: "127.0.0.1" }, createResponse(), next);
  assert.match(next.calls[0].message, /Unexpected request throttle/);
});
