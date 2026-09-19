const test = require("node:test");
const assert = require("node:assert/strict");
const cors = require("../../middlewares/cors.middleware");
const { createResponse, captureNext } = require("../helpers/http");

const FRONTEND_URL = "https://frontend.example/application";
const FRONTEND_ORIGIN = "https://frontend.example";

const expectedCommonHeaders = {
  vary: "Origin",
  "access-control-allow-methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "access-control-allow-headers": "Content-Type,Authorization",
  "access-control-expose-headers": "X-Request-Id",
  "access-control-max-age": "600",
};

const withFrontendUrl = (frontendUrl, callback) => {
  const original = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = frontendUrl;

  try {
    return callback();
  } finally {
    if (original === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = original;
  }
};

const createRequest = (method, origin) => ({
  method,
  get(name) {
    assert.equal(name, "origin");
    return origin;
  },
});

test("CORS middleware allows the configured frontend origin", () => {
  const res = createResponse();
  const next = captureNext();

  withFrontendUrl(FRONTEND_URL, () => {
    cors(createRequest("POST", FRONTEND_ORIGIN), res, next);
  });

  assert.deepEqual(res.headers, {
    ...expectedCommonHeaders,
    "access-control-allow-origin": FRONTEND_ORIGIN,
  });
  assert.equal(res.statusCode, null);
  assert.equal(res.ended, false);
  assert.deepEqual(next.calls, [undefined]);
});

test("CORS middleware derives the origin when the frontend URL has a path", () => {
  const res = createResponse();
  const next = captureNext();

  withFrontendUrl("https://frontend.example/application/login", () => {
    cors(createRequest("GET", FRONTEND_ORIGIN), res, next);
  });

  assert.equal(res.headers["access-control-allow-origin"], FRONTEND_ORIGIN);
  assert.deepEqual(next.calls, [undefined]);
});

test("CORS middleware never reflects disallowed, missing, or null origins", () => {
  for (const origin of ["https://attacker.example", undefined, "null"]) {
    const res = createResponse();
    const next = captureNext();

    withFrontendUrl(FRONTEND_URL, () => {
      cors(createRequest("GET", origin), res, next);
    });

    assert.equal(res.headers["access-control-allow-origin"], undefined);
    assert.deepEqual(res.headers, expectedCommonHeaders);
    assert.deepEqual(next.calls, [undefined]);
  }
});

test("CORS middleware completes allowed preflight without continuing", () => {
  const res = createResponse();
  const next = captureNext();

  withFrontendUrl(FRONTEND_URL, () => {
    cors(createRequest("OPTIONS", FRONTEND_ORIGIN), res, next);
  });

  assert.deepEqual(res.headers, {
    ...expectedCommonHeaders,
    "access-control-allow-origin": FRONTEND_ORIGIN,
  });
  assert.equal(res.statusCode, 204);
  assert.equal(res.ended, true);
  assert.deepEqual(next.calls, []);
});

test("CORS middleware forwards invalid server configuration", () => {
  const res = createResponse();
  const next = captureNext();

  withFrontendUrl("not-a-url", () => {
    cors(createRequest("GET", FRONTEND_ORIGIN), res, next);
  });

  assert.equal(next.calls.length, 1);
  assert.match(next.calls[0].message, /FRONTEND_URL/);
  assert.deepEqual(res.headers, {});
});
