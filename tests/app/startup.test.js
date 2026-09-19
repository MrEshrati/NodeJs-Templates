const test = require("node:test");
const assert = require("node:assert/strict");
const mongoose = require("mongoose");
const accountEmailWorker = require("../../workers/accountEmail.worker");

const {
  app,
  registerShutdownHandlers,
  startServer,
  stopServer,
} = require("../../app");

const validEnvironment = {
  PORT: "4321",
  NODE_ENV: "test",
  DB_URL: "mongodb://127.0.0.1:27017/test-database",
  FRONTEND_URL: "http://localhost:5173",
  GOOGLE_CLIENT_ID: "google-client-id",
  JWT_SECRET: "j".repeat(32),
  OTP_SECRET: "o".repeat(32),
  LOGIN_THROTTLE_SECRET: "l".repeat(32),
  REQUEST_THROTTLE_SECRET: "r".repeat(32),
  PAYMENT_IDEMPOTENCY_SECRET: "p".repeat(32),
  PAYMENT_PROVIDER: "stripe",
  PAYMENT_FAKE_MODE: "true",
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
  const fakeWorker = { async stop() {} };

  t.mock.method(mongoose, "connect", async (databaseUrl) => {
    events.push(["connect", databaseUrl]);
  });
  t.mock.method(app, "listen", (port, callback) => {
    events.push(["listen", port]);
    callback();
    return fakeServer;
  });
  t.mock.method(console, "log", () => {});
  t.mock.method(accountEmailWorker, "startAccountEmailWorker", () => {
    events.push(["start email worker"]);
    return fakeWorker;
  });

  await withEnvironment(validEnvironment, async () => {
    const server = await startServer();
    assert.equal(server, fakeServer);
  });

  assert.equal(fakeServer.headersTimeout, 10_000);
  assert.equal(fakeServer.keepAliveTimeout, 5_000);
  assert.equal(fakeServer.requestTimeout, 30_000);
  assert.equal(fakeServer.timeout, 30_000);
  assert.equal(fakeServer.accountEmailWorker, fakeWorker);

  assert.deepEqual(events, [
    ["connect", "mongodb://127.0.0.1:27017/test-database"],
    ["listen", 4321],
    ["start email worker"],
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

test("startServer refuses Ethereal email in production", async (t) => {
  const connect = t.mock.method(mongoose, "connect", async () => {});

  await withEnvironment(
    { ...validEnvironment, NODE_ENV: "production" },
    async () => {
      await assert.rejects(startServer(), /email delivery uses Ethereal/);
    },
  );

  assert.equal(connect.mock.callCount(), 0);
});

test("stopServer closes HTTP before disconnecting MongoDB", async (t) => {
  const events = [];
  const server = {
    close(callback) {
      events.push("close HTTP");
      callback();
    },
    accountEmailWorker: {
      async stop() {
        events.push("stop email worker");
      },
    },
  };

  t.mock.method(mongoose, "disconnect", async () => {
    events.push("disconnect MongoDB");
  });

  await stopServer(server);

  assert.deepEqual(events, [
    "close HTTP",
    "stop email worker",
    "disconnect MongoDB",
  ]);
});

test("stopServer still disconnects MongoDB when HTTP closing fails", async (t) => {
  const closeError = new Error("HTTP close failed");
  const events = [];
  const server = {
    close(callback) {
      events.push("close HTTP");
      callback(closeError);
    },
  };

  t.mock.method(mongoose, "disconnect", async () => {
    events.push("disconnect MongoDB");
  });

  await assert.rejects(stopServer(server), closeError);
  assert.deepEqual(events, ["close HTTP", "disconnect MongoDB"]);
});

test("stopServer force-closes HTTP connections after its deadline", async (t) => {
  const events = [];
  const server = {
    close() {
      events.push("close HTTP");
    },
    closeAllConnections() {
      events.push("force close HTTP");
    },
  };

  const disconnect = t.mock.method(mongoose, "disconnect", async () => {
    events.push("disconnect MongoDB");
  });

  await assert.rejects(
    stopServer(server, { shutdownTimeoutMs: 5 }),
    /Server shutdown exceeded 5 milliseconds/,
  );

  assert.deepEqual(events, ["close HTTP", "force close HTTP"]);
  assert.equal(disconnect.mock.callCount(), 0);
});

test("shutdown signal handling is registered once and is idempotent", async (t) => {
  const handlers = new Map();
  const events = [];
  let finishClosing;
  const server = {
    close(callback) {
      events.push("close HTTP");
      finishClosing = callback;
    },
  };
  const runtime = {
    exitCode: undefined,
    once(signal, handler) {
      handlers.set(signal, handler);
    },
  };
  const logger = {
    error(error) {
      events.push(["error", error]);
    },
    log(message) {
      events.push(["log", message]);
    },
  };

  t.mock.method(mongoose, "disconnect", async () => {
    events.push("disconnect MongoDB");
  });

  const shutdown = registerShutdownHandlers(server, { runtime, logger });

  assert.equal(handlers.get("SIGINT"), shutdown);
  assert.equal(handlers.get("SIGTERM"), shutdown);

  const firstShutdown = handlers.get("SIGINT")("SIGINT");
  const secondShutdown = handlers.get("SIGTERM")("SIGTERM");

  assert.equal(firstShutdown, secondShutdown);
  assert.equal(events.filter((event) => event === "close HTTP").length, 1);

  finishClosing();
  await firstShutdown;

  assert.equal(
    events.filter((event) => event === "disconnect MongoDB").length,
    1,
  );
  assert.equal(runtime.exitCode, undefined);
  assert.deepEqual(events[0], [
    "log",
    "Received SIGINT. Shutting down gracefully.",
  ]);
});

test("shutdown signal handling reports cleanup failures", async (t) => {
  const databaseError = new Error("MongoDB disconnect failed");
  const reportedErrors = [];
  const runtime = {
    exitCode: undefined,
    once() {},
  };
  const logger = {
    error(error) {
      reportedErrors.push(error);
    },
    log() {},
  };
  const server = {
    close(callback) {
      callback();
    },
  };

  t.mock.method(mongoose, "disconnect", async () => {
    throw databaseError;
  });

  const shutdown = registerShutdownHandlers(server, { runtime, logger });
  await shutdown("SIGTERM");

  assert.deepEqual(reportedErrors, [databaseError]);
  assert.equal(runtime.exitCode, 1);
});
