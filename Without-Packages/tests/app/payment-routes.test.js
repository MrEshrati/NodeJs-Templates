const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const mongoose = require("mongoose");
const { fromProject, loadWithMocks } = require("../helpers/module");

const appPath = fromProject("app.js");
const environmentPath = fromProject("config", "environment.js");
const paymentRouterPath = fromProject("routes", "payment.route.js");

const DEFAULT_PAYMENT_CONFIG = Object.freeze({
  provider: "stripe",
  fakeMode: true,
});

const loadApplication = ({
  paymentConfig = DEFAULT_PAYMENT_CONFIG,
  events = [],
} = {}) => {
  const calls = {
    paymentRouter: [],
    environment: 0,
  };
  const application = loadWithMocks(appPath, {
    [environmentPath]: {
      validateEnvironment() {
        calls.environment += 1;
        events.push("validate environment");
        return {
          port: 4321,
          databaseUrl: "mongodb://127.0.0.1:27017/payment-test",
          payment: paymentConfig,
        };
      },
    },
    [paymentRouterPath]: (config) => {
      calls.paymentRouter.push(config);
      events.push("configure payment routes");

      if (
        config === null ||
        typeof config !== "object" ||
        Array.isArray(config)
      ) {
        throw new TypeError("paymentConfig must be an object.");
      }

      if (config.provider !== "stripe" && config.provider !== "zarinpal") {
        throw new TypeError('provider must be "stripe" or "zarinpal".');
      }

      if (typeof config.fakeMode !== "boolean") {
        throw new TypeError("fakeMode must be a boolean.");
      }

      const router = express.Router();

      router.post("/create-payment", (_req, res) =>
        res.status(200).json({
          route: "create-payment",
          provider: config.provider,
        }),
      );

      if (config.fakeMode) {
        router.post("/dev/simulate", (_req, res) =>
          res.status(200).json({
            route: "simulate-payment",
            provider: config.provider,
          }),
        );
      }

      return router;
    },
  });

  return { application, calls };
};

const startHttpServer = async (app) =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });

const closeHttpServer = async (server) =>
  new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });

const getBaseUrl = (server) => {
  const address = server.address();

  return `http://127.0.0.1:${address.port}`;
};

const post = async (baseUrl, path) => {
  const response = await fetch(`${baseUrl}${path}`, { method: "POST" });
  const responseText = await response.text();

  return {
    response,
    payload: responseText === "" ? null : JSON.parse(responseText),
  };
};

test("payment endpoints become reachable only after configuration", async (t) => {
  const { application, calls } = loadApplication();
  const server = await startHttpServer(application.app);
  const baseUrl = getBaseUrl(server);

  t.after(() => closeHttpServer(server));

  const beforeConfiguration = await post(baseUrl, "/create-payment");

  assert.equal(beforeConfiguration.response.status, 404);
  assert.equal(beforeConfiguration.payload.code, "not_found");

  application.configurePaymentRoutes({
    provider: "stripe",
    fakeMode: true,
  });

  const creation = await post(baseUrl, "/create-payment");
  const simulation = await post(baseUrl, "/dev/simulate");

  assert.equal(creation.response.status, 200);
  assert.deepEqual(creation.payload, {
    route: "create-payment",
    provider: "stripe",
  });
  assert.equal(simulation.response.status, 200);
  assert.deepEqual(simulation.payload, {
    route: "simulate-payment",
    provider: "stripe",
  });
  assert.deepEqual(calls.paymentRouter, [
    { provider: "stripe", fakeMode: true },
  ]);
});

test("live payment configuration never exposes simulation", async (t) => {
  const { application, calls } = loadApplication();

  application.configurePaymentRoutes({
    provider: "zarinpal",
    fakeMode: false,
  });

  const server = await startHttpServer(application.app);
  const baseUrl = getBaseUrl(server);

  t.after(() => closeHttpServer(server));

  const creation = await post(baseUrl, "/create-payment");
  const simulation = await post(baseUrl, "/dev/simulate");

  assert.equal(creation.response.status, 200);
  assert.deepEqual(creation.payload, {
    route: "create-payment",
    provider: "zarinpal",
  });
  assert.equal(simulation.response.status, 404);
  assert.equal(simulation.payload.code, "not_found");
  assert.deepEqual(calls.paymentRouter, [
    { provider: "zarinpal", fakeMode: false },
  ]);
});

test("payment route configuration is idempotent but cannot be replaced", () => {
  const { application, calls } = loadApplication();
  const originalConfig = { provider: "stripe", fakeMode: true };

  application.configurePaymentRoutes(originalConfig);
  application.configurePaymentRoutes({ provider: "stripe", fakeMode: true });
  application.configurePaymentRoutes(originalConfig);

  assert.equal(calls.paymentRouter.length, 1);
  assert.equal(calls.paymentRouter[0], originalConfig);

  for (const conflictingConfig of [
    { provider: "zarinpal", fakeMode: true },
    { provider: "stripe", fakeMode: false },
    { provider: "zarinpal", fakeMode: false },
  ]) {
    assert.throws(
      () => application.configurePaymentRoutes(conflictingConfig),
      /Payment routes are already configured with different settings/,
    );
  }

  assert.equal(calls.paymentRouter.length, 1);
});

test("server startup configures payments before database and HTTP startup", async (t) => {
  const events = [];
  const paymentConfig = { provider: "stripe", fakeMode: true };
  const { application, calls } = loadApplication({ paymentConfig, events });
  const fakeServer = {};

  t.mock.method(mongoose, "connect", async (databaseUrl) => {
    events.push(["connect database", databaseUrl]);
  });
  t.mock.method(application.app, "listen", (port, callback) => {
    events.push(["listen", port]);
    callback();
    return fakeServer;
  });
  t.mock.method(console, "log", () => {});

  const result = await application.startServer();

  assert.equal(result, fakeServer);
  assert.equal(calls.environment, 1);
  assert.deepEqual(calls.paymentRouter, [paymentConfig]);
  assert.deepEqual(events, [
    "validate environment",
    "configure payment routes",
    [
      "connect database",
      "mongodb://127.0.0.1:27017/payment-test",
    ],
    ["listen", 4321],
  ]);
  assert.equal(fakeServer.headersTimeout, 10_000);
  assert.equal(fakeServer.keepAliveTimeout, 5_000);
  assert.equal(fakeServer.requestTimeout, 30_000);
  assert.equal(fakeServer.timeout, 30_000);
});

test("invalid payment configuration stops startup before external work", async (t) => {
  const invalidConfigs = [
    null,
    { provider: "paypal", fakeMode: true },
    { provider: "stripe", fakeMode: "true" },
  ];

  for (const paymentConfig of invalidConfigs) {
    const events = [];
    const { application } = loadApplication({ paymentConfig, events });
    const connect = t.mock.method(mongoose, "connect", async () => {
      events.push("connect database");
    });
    const listen = t.mock.method(application.app, "listen", () => {
      events.push("listen");
    });

    await assert.rejects(application.startServer(), TypeError);
    assert.equal(connect.mock.callCount(), 0);
    assert.equal(listen.mock.callCount(), 0);
    assert.deepEqual(events, [
      "validate environment",
      "configure payment routes",
    ]);

    connect.mock.restore();
    listen.mock.restore();
  }
});

test("failed startup keeps its selected payment configuration", async (t) => {
  const databaseError = new Error("database unavailable");
  const paymentConfig = { provider: "stripe", fakeMode: true };
  const { application, calls } = loadApplication({ paymentConfig });
  const connect = t.mock.method(mongoose, "connect", async () => {
    throw databaseError;
  });
  const listen = t.mock.method(application.app, "listen", () => {
    throw new Error("HTTP server must not start.");
  });

  await assert.rejects(application.startServer(), databaseError);
  assert.equal(connect.mock.callCount(), 1);
  assert.equal(listen.mock.callCount(), 0);
  assert.equal(calls.paymentRouter.length, 1);

  application.configurePaymentRoutes({ provider: "stripe", fakeMode: true });
  assert.equal(calls.paymentRouter.length, 1);

  assert.throws(
    () =>
      application.configurePaymentRoutes({
        provider: "zarinpal",
        fakeMode: false,
      }),
    /Payment routes are already configured with different settings/,
  );
  assert.equal(calls.paymentRouter.length, 1);
});
