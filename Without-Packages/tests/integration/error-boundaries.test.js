const test = require("node:test");
const assert = require("node:assert/strict");
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
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(
    response.headers.get("access-control-allow-methods"),
    "GET,POST,PUT,DELETE,PATCH",
  );
  assert.equal(
    response.headers.get("access-control-allow-headers"),
    "Content-Type,Authorization",
  );
};

test("unknown routes return the JSON not-found contract", async () => {
  const response = await fetch(`${baseUrl}/route-that-does-not-exist`);
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
