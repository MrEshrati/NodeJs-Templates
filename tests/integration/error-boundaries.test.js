const test = require("node:test");
const assert = require("node:assert/strict");
const FRONTEND_ORIGIN = "https://frontend.example";
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

process.env.FRONTEND_URL = `${FRONTEND_ORIGIN}/application`;

const { app } = require("../../app");

let server;
let baseUrl;

test.before(async () => {
  server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => {
      resolve(listeningServer);
    });

    listeningServer.once("error", reject);
  });

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

const assertJsonAndCors = (response) => {
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    FRONTEND_ORIGIN,
  );
  assert.equal(response.headers.get("vary"), "Origin");
  assert.equal(
    response.headers.get("access-control-allow-methods"),
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  assert.equal(
    response.headers.get("access-control-allow-headers"),
    "Content-Type,Authorization",
  );
  assert.equal(
    response.headers.get("access-control-expose-headers"),
    "X-Request-Id",
  );
  assert.equal(response.headers.get("access-control-max-age"), "600");
  assert.match(response.headers.get("x-request-id") ?? "", UUID_PATTERN);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-powered-by"), null);
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    response.headers.get("content-security-policy"),
    "default-src 'none'",
  );
};

test("unknown routes return the JSON not-found contract", async () => {
  const response = await fetch(`${baseUrl}/route-that-does-not-exist`, {
    headers: { Origin: FRONTEND_ORIGIN },
  });
  const payload = await response.json();

  assert.equal(response.status, 404);
  assertJsonAndCors(response);
  assert.deepEqual(payload, {
    error: true,
    code: "not_found",
    message: "The requested resource was not found.",
  });
});

test("malformed JSON returns a safe client error", async () => {
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: FRONTEND_ORIGIN,
    },
    body: '{"email":"user@example.com",',
  });
  const payload = await response.json();

  assert.equal(response.status, 400);
  assertJsonAndCors(response);
  assert.deepEqual(payload, {
    error: true,
    code: "invalid_json",
    message: "Request body contains invalid JSON.",
  });
  assert.equal(JSON.stringify(payload).includes("Unexpected"), false);
});

test("oversized JSON returns a safe payload-too-large error", async () => {
  const oversizedValue = "sensitive-value".repeat(1_500);
  const response = await fetch(`${baseUrl}/auth/register`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: FRONTEND_ORIGIN,
    },
    body: JSON.stringify({ email: oversizedValue }),
  });
  const payload = await response.json();

  assert.equal(response.status, 413);
  assertJsonAndCors(response);
  assert.deepEqual(payload, {
    error: true,
    code: "payload_too_large",
    message: "Request body is too large.",
  });
  assert.equal(JSON.stringify(payload).includes(oversizedValue), false);
});
