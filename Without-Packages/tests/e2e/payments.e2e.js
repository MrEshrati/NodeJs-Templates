require("dotenv").config({ quiet: true });

const test = require("node:test");
const assert = require("node:assert/strict");
const express = require("express");
const { fromProject } = require("../helpers/module");
const {
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} = require("../helpers/database");

const JWT_SECRET = "payment-e2e-jwt-secret-with-at-least-32-bytes";
const REQUEST_THROTTLE_SECRET =
  "payment-e2e-request-throttle-secret-with-at-least-32-bytes";
const PAYMENT_IDEMPOTENCY_SECRET =
  "payment-e2e-idempotency-secret-with-at-least-32-bytes";

const testDatabaseConfigured =
  typeof process.env.TEST_DB_URL === "string" &&
  process.env.TEST_DB_URL.trim() !== "";

const closeServer = async (server) => {
  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
};

const startServer = async (app) =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });

const requestJson = async (
  baseUrl,
  path,
  { body, token } = {},
) => {
  const headers = {};

  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }

  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const responseText = await response.text();

  return {
    response,
    payload: responseText === "" ? null : JSON.parse(responseText),
  };
};

const createTestApplication = (paymentConfig) => {
  const createPaymentRouter = require(
    fromProject("routes", "payment.route.js"),
  );
  const notFound = require(
    fromProject("middlewares", "notFound.middleware.js"),
  );
  const errorHandler = require(
    fromProject("middlewares", "errorHandler.middleware.js"),
  );
  const app = express();

  app.use(express.json({ limit: "16kb" }));
  app.use("/", createPaymentRouter(paymentConfig));
  app.use(notFound);
  app.use(errorHandler);

  return app;
};

const getBaseUrl = (server) => {
  const address = server.address();

  return `http://127.0.0.1:${address.port}`;
};

test(
  "fake payment endpoints complete Stripe and ZarinPal workflows",
  {
    skip:
      !testDatabaseConfigured &&
      "Set TEST_DB_URL to a dedicated database ending in _test.",
  },
  async (t) => {
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.REQUEST_THROTTLE_SECRET = REQUEST_THROTTLE_SECRET;
    process.env.PAYMENT_IDEMPOTENCY_SECRET = PAYMENT_IDEMPOTENCY_SECRET;

    const Payment = require(fromProject("models", "payment.model.js"));
    const PaymentCreation = require(
      fromProject("models", "paymentCreation.model.js"),
    );
    const User = require(fromProject("models", "user.model.js"));
    const { createJwt } = require(fromProject("utils", "jwt.utils.js"));
    const servers = [];

    await connectTestDatabase();

    t.after(async () => {
      await Promise.all(servers.map(closeServer));
      await clearTestDatabase();
      await disconnectTestDatabase();
    });

    await clearTestDatabase();

    const [owner, otherUser] = await User.create([
      {
        email: "payment-owner@example.com",
        emailVerified: true,
        isActive: true,
      },
      {
        email: "payment-other@example.com",
        emailVerified: true,
        isActive: true,
      },
    ]);
    const ownerToken = createJwt({
      userId: owner._id,
      tokenType: "access",
      expiresInSeconds: 3600,
    }).token;
    const otherToken = createJwt({
      userId: otherUser._id,
      tokenType: "access",
      expiresInSeconds: 3600,
    }).token;

    process.env.PAYMENT_PROVIDER = "stripe";
    process.env.PAYMENT_FAKE_MODE = "true";

    const stripeServer = await startServer(
      createTestApplication({ provider: "stripe", fakeMode: true }),
    );
    servers.push(stripeServer);
    const stripeBaseUrl = getBaseUrl(stripeServer);

    const unauthorized = await requestJson(
      stripeBaseUrl,
      "/create-payment",
      {
        body: { amount: 1099, currency: "USD" },
      },
    );

    assert.equal(unauthorized.response.status, 401);
    assert.equal(unauthorized.payload.code, "not_authenticated");

    const missingIdempotencyKey = await requestJson(
      stripeBaseUrl,
      "/create-payment",
      {
        body: { amount: 1099, currency: "USD" },
        token: ownerToken,
      },
    );
    assert.equal(missingIdempotencyKey.response.status, 400);
    assert.equal(missingIdempotencyKey.payload.code, "validation_error");
    assert.ok(missingIdempotencyKey.payload.fields.idempotency_key);

    const stripeBody = {
      amount: 1099,
      currency: "USD",
      description: "Test order",
      idempotency_key: "stripe-test-1",
    };
    const stripeCreated = await requestJson(
      stripeBaseUrl,
      "/create-payment",
      { body: stripeBody, token: ownerToken },
    );

    assert.equal(stripeCreated.response.status, 201);
    assert.equal(typeof stripeCreated.payload.payment_id, "string");
    assert.equal(typeof stripeCreated.payload.client_secret, "string");
    assert.equal(typeof stripeCreated.payload.publishable_key, "string");
    assert.equal("provider_data" in stripeCreated.payload, false);

    const stripeReplay = await requestJson(
      stripeBaseUrl,
      "/create-payment",
      { body: stripeBody, token: ownerToken },
    );

    assert.equal(stripeReplay.response.status, 200);
    assert.deepEqual(stripeReplay.payload, stripeCreated.payload);
    assert.equal(await Payment.countDocuments(), 1);
    assert.equal(await PaymentCreation.countDocuments(), 1);

    const stripeConflict = await requestJson(
      stripeBaseUrl,
      "/create-payment",
      {
        body: { ...stripeBody, amount: 2099 },
        token: ownerToken,
      },
    );
    assert.equal(stripeConflict.response.status, 409);
    assert.equal(stripeConflict.payload.code, "idempotency_conflict");
    assert.equal(await Payment.countDocuments(), 1);

    const otherUserPayment = await requestJson(
      stripeBaseUrl,
      "/create-payment",
      { body: stripeBody, token: otherToken },
    );
    assert.equal(otherUserPayment.response.status, 201);
    assert.notEqual(
      otherUserPayment.payload.payment_id,
      stripeCreated.payload.payment_id,
    );
    assert.equal(await Payment.countDocuments(), 2);
    assert.equal(await PaymentCreation.countDocuments(), 2);

    const hiddenPayment = await requestJson(
      stripeBaseUrl,
      "/dev/simulate",
      {
        body: {
          payment_id: stripeCreated.payload.payment_id,
          outcome: "succeeded",
        },
        token: otherToken,
      },
    );

    assert.equal(hiddenPayment.response.status, 404);
    assert.equal(hiddenPayment.payload.code, "not_found");

    const stripeSucceeded = await requestJson(
      stripeBaseUrl,
      "/dev/simulate",
      {
        body: {
          payment_id: stripeCreated.payload.payment_id,
          outcome: "succeeded",
        },
        token: ownerToken,
      },
    );

    assert.equal(stripeSucceeded.response.status, 200);
    assert.equal(stripeSucceeded.payload.status, "succeeded");
    assert.equal(stripeSucceeded.payload.refunded_amount, 0);

    const stripeRefunded = await requestJson(
      stripeBaseUrl,
      "/dev/simulate",
      {
        body: {
          payment_id: stripeCreated.payload.payment_id,
          outcome: "refunded",
        },
        token: ownerToken,
      },
    );

    assert.equal(stripeRefunded.response.status, 200);
    assert.equal(stripeRefunded.payload.status, "refunded");
    assert.equal(stripeRefunded.payload.refunded_amount, 1099);

    const stripeRefundReplay = await requestJson(
      stripeBaseUrl,
      "/dev/simulate",
      {
        body: {
          payment_id: stripeCreated.payload.payment_id,
          outcome: "refunded",
        },
        token: ownerToken,
      },
    );

    assert.equal(stripeRefundReplay.response.status, 200);
    assert.equal(stripeRefundReplay.payload.status, "refunded");

    process.env.PAYMENT_PROVIDER = "zarinpal";
    process.env.PAYMENT_FAKE_MODE = "true";

    const zarinpalServer = await startServer(
      createTestApplication({ provider: "zarinpal", fakeMode: true }),
    );
    servers.push(zarinpalServer);
    const zarinpalBaseUrl = getBaseUrl(zarinpalServer);
    const zarinpalBody = {
      amount: 50000,
      currency: "IRR",
      description: "Test order",
      idempotency_key: "zarinpal-test-1",
    };
    const zarinpalCreated = await requestJson(
      zarinpalBaseUrl,
      "/create-payment",
      { body: zarinpalBody, token: ownerToken },
    );

    assert.equal(zarinpalCreated.response.status, 201);
    assert.equal(typeof zarinpalCreated.payload.payment_id, "string");
    assert.match(
      zarinpalCreated.payload.redirect_url,
      /^https:\/\/payment\.zarinpal\.com\/pg\/StartPay\//,
    );
    assert.equal("provider_data" in zarinpalCreated.payload, false);

    const zarinpalReplay = await requestJson(
      zarinpalBaseUrl,
      "/create-payment",
      { body: zarinpalBody, token: ownerToken },
    );

    assert.equal(zarinpalReplay.response.status, 200);
    assert.deepEqual(zarinpalReplay.payload, zarinpalCreated.payload);
    assert.equal(await Payment.countDocuments(), 3);
    assert.equal(await PaymentCreation.countDocuments(), 3);

    const invalidRefund = await requestJson(
      zarinpalBaseUrl,
      "/dev/simulate",
      {
        body: {
          payment_id: zarinpalCreated.payload.payment_id,
          outcome: "refunded",
        },
        token: ownerToken,
      },
    );

    assert.equal(invalidRefund.response.status, 400);
    assert.equal(invalidRefund.payload.code, "validation_error");
    assert.ok(invalidRefund.payload.fields.outcome);

    const zarinpalSucceeded = await requestJson(
      zarinpalBaseUrl,
      "/dev/simulate",
      {
        body: {
          payment_id: zarinpalCreated.payload.payment_id,
          outcome: "succeeded",
        },
        token: ownerToken,
      },
    );

    assert.equal(zarinpalSucceeded.response.status, 200);
    assert.equal(zarinpalSucceeded.payload.status, "succeeded");
    assert.equal(zarinpalSucceeded.payload.currency, "IRR");

    process.env.PAYMENT_PROVIDER = "stripe";
    process.env.PAYMENT_FAKE_MODE = "false";

    const liveServer = await startServer(
      createTestApplication({ provider: "stripe", fakeMode: false }),
    );
    servers.push(liveServer);
    const liveBaseUrl = getBaseUrl(liveServer);
    const missingSimulationRoute = await requestJson(
      liveBaseUrl,
      "/dev/simulate",
      {
        body: {
          payment_id: stripeCreated.payload.payment_id,
          outcome: "succeeded",
        },
        token: ownerToken,
      },
    );

    assert.equal(missingSimulationRoute.response.status, 404);
    assert.equal(missingSimulationRoute.payload.code, "not_found");
  },
);
