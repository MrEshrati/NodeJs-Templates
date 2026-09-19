const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const FRONTEND_ORIGIN = "https://health.example";

process.env.FRONTEND_URL = FRONTEND_ORIGIN;

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

const getHealth = async (path) => {
  const response = await fetch(`${baseUrl}${path}`, {
    headers: {
      Origin: FRONTEND_ORIGIN,
    },
  });

  return {
    payload: await response.json(),
    response,
  };
};

const assertHealthHeaders = (response) => {
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(
    response.headers.get("access-control-allow-origin"),
    FRONTEND_ORIGIN,
  );
  assert.match(response.headers.get("content-type") ?? "", /^application\/json/);
};

test("liveness reports a running process without authentication", async () => {
  const { payload, response } = await getHealth("/health/live");

  assert.equal(response.status, 200);
  assertHealthHeaders(response);
  assert.deepEqual(payload, { status: "ok" });
});

test("readiness follows the MongoDB connection state", async () => {
  const originalReadyState = mongoose.connection.readyState;

  try {
    mongoose.connection.readyState = mongoose.Connection.STATES.disconnected;

    const unavailable = await getHealth("/health/ready");

    assert.equal(unavailable.response.status, 503);
    assertHealthHeaders(unavailable.response);
    assert.deepEqual(unavailable.payload, { status: "unavailable" });

    mongoose.connection.readyState = mongoose.Connection.STATES.connected;

    const ready = await getHealth("/health/ready");

    assert.equal(ready.response.status, 200);
    assertHealthHeaders(ready.response);
    assert.deepEqual(ready.payload, { status: "ready" });
  } finally {
    mongoose.connection.readyState = originalReadyState;
  }
});
