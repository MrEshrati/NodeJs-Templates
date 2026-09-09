const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");

const { app, startServer } = require("../../app");

const validEnvironment = {
  PORT: "4321",
  DB_URL: "mongodb://127.0.0.1:27017/test-database",
  FRONTEND_URL: "http://localhost:5173",
  GOOGLE_CLIENT_ID: "google-client-id",
  JWT_SECRET: "j".repeat(32),
  OTP_SECRET: "o".repeat(32),
  LOGIN_THROTTLE_SECRET: "l".repeat(32),
  REQUEST_THROTTLE_SECRET: "r".repeat(32),
};

const withEnvironment = async (values, callback) => {
  const originals = new Map();

  for (const [name, value] of Object.entries(values)) {
    originals.set(name, process.env[name]);

    if (value === undefined) {
      delete process.env[name];
    } else {
      process.env[name] = value;
    }
  }

  try {
    return await callback();
  } finally {
    for (const [name, value] of originals) {
      if (value === undefined) {
        delete process.env[name];
      } else {
        process.env[name] = value;
      }
    }
  }
};

test("app module exports a configured Express application without starting it", () => {
  assert.equal(typeof app, "function");
  assert.equal(typeof app.listen, "function");
  assert.equal(typeof startServer, "function");
  assert.equal(mongoose.connection.readyState, 0);
});

test("startServer connects to MongoDB before listening", async (t) => {
  const events = [];
  const fakeServer = { close() {} };

  t.mock.method(mongoose, "connect", async (databaseUrl) => {
    events.push(["connect", databaseUrl]);
  });
  t.mock.method(app, "listen", (port, callback) => {
    events.push(["listen", port]);
    callback();
    return fakeServer;
  });
  t.mock.method(console, "log", () => {});

  await withEnvironment(validEnvironment, async () => {
    const server = await startServer();
    assert.equal(server, fakeServer);
  });

  assert.deepEqual(events, [
    ["connect", "mongodb://127.0.0.1:27017/test-database"],
    ["listen", 4321],
  ]);
});

test("startServer rejects missing configuration before connecting", async (t) => {
  const connect = t.mock.method(mongoose, "connect", async () => {});

  await withEnvironment(
    { ...validEnvironment, PORT: undefined },
    async () => {
      await assert.rejects(startServer(), /PORT environment variable is required/);
    },
  );

  await withEnvironment(
    { ...validEnvironment, DB_URL: undefined },
    async () => {
      await assert.rejects(startServer(), /DB_URL environment variable is required/);
    },
  );

  await withEnvironment(
    { ...validEnvironment, JWT_SECRET: "short" },
    async () => {
      await assert.rejects(startServer(), /JWT_SECRET must contain at least 32 bytes/);
    },
  );

  assert.equal(connect.mock.callCount(), 0);
});
