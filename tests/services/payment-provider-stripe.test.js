const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject } = require("../helpers/module");

const { createStripeProvider } = require(
  fromProject(
    "services",
    "paymentProviders",
    "stripe.provider.js",
  ),
);
const PaymentProviderError = require(
  fromProject("errors", "PaymentProviderError.js"),
);

const STRIPE_PAYMENT_INTENTS_URL =
  "https://api.stripe.com/v1/payment_intents";

const createResponse = ({
  ok = true,
  status = 200,
  body = {
    id: "pi_test_1",
    client_secret: "pi_test_1_secret_1",
    status: "requires_payment_method",
  },
  requestId = "req_stripe_1",
  textError,
} = {}) => ({
  ok,
  status,
  headers: {
    get(name) {
      return name === "request-id" ? requestId : null;
    },
  },
  async text() {
    if (textError) {
      throw textError;
    }

    return typeof body === "string" ? body : JSON.stringify(body);
  },
});

const createProvider = (fetchImpl, overrides = {}) =>
  createStripeProvider({
    secretKey: "sk_test_1",
    publishableKey: "pk_test_1",
    fetchImpl,
    timeoutMs: 2500,
    ...overrides,
  });

test("Stripe provider validates construction options", () => {
  const fetchImpl = async () => createResponse();

  for (const secretKey of [undefined, null, "", "   ", 1]) {
    assert.throws(
      () =>
        createStripeProvider({
          secretKey,
          publishableKey: "pk_test_1",
          fetchImpl,
        }),
      /secretKey must be a non-empty string/,
    );
  }

  for (const publishableKey of [undefined, null, "", "   ", 1]) {
    assert.throws(
      () =>
        createStripeProvider({
          secretKey: "sk_test_1",
          publishableKey,
          fetchImpl,
        }),
      /publishableKey must be a non-empty string/,
    );
  }

  for (const invalidFetch of [null, {}, "fetch"]) {
    assert.throws(
      () =>
        createStripeProvider({
          secretKey: "sk_test_1",
          publishableKey: "pk_test_1",
          fetchImpl: invalidFetch,
        }),
      /fetchImpl must be a function/,
    );
  }

  for (const timeoutMs of [0, -1, 1.5, "1000", null]) {
    assert.throws(
      () =>
        createStripeProvider({
          secretKey: "sk_test_1",
          publishableKey: "pk_test_1",
          fetchImpl,
          timeoutMs,
        }),
      /timeoutMs must be a positive integer/,
    );
  }
});

test("Stripe payment creation sends the exact approved request", async () => {
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url, options });
    return createResponse();
  };
  const provider = createStripeProvider({
    secretKey: "  sk_test_1  ",
    publishableKey: "  pk_test_1  ",
    fetchImpl,
    timeoutMs: 2500,
  });

  const result = await provider.createPayment({
    amount: 1099,
    currency: "USD",
    description: "Test order",
    idempotencyKey: "order-1",
  });

  assert.equal(provider.provider, "stripe");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, STRIPE_PAYMENT_INTENTS_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.headers, {
    Authorization: "Bearer sk_test_1",
    "Content-Type": "application/x-www-form-urlencoded",
    "Idempotency-Key": "order-1",
  });
  assert.equal(calls[0].options.body instanceof URLSearchParams, true);
  assert.deepEqual(
    Object.fromEntries(calls[0].options.body.entries()),
    {
      amount: "1099",
      currency: "usd",
      "automatic_payment_methods[enabled]": "true",
      description: "Test order",
    },
  );
  assert.equal(calls[0].options.signal instanceof AbortSignal, true);
  assert.equal(calls[0].options.signal.aborted, false);
  assert.deepEqual(result, {
    externalId: "pi_test_1",
    providerData: {
      client_secret: "pi_test_1_secret_1",
      payment_intent_status: "requires_payment_method",
    },
    checkout: {
      clientSecret: "pi_test_1_secret_1",
      publishableKey: "pk_test_1",
    },
  });
});

test("Stripe payment creation omits absent optional request fields", async () => {
  const calls = [];
  const provider = createProvider(async (url, options) => {
    calls.push({ url, options });
    return createResponse();
  });

  await provider.createPayment({ amount: 500, currency: "USD" });

  assert.equal(
    Object.hasOwn(calls[0].options.headers, "Idempotency-Key"),
    false,
  );
  assert.equal(calls[0].options.body.has("description"), false);

  calls.length = 0;
  await provider.createPayment({
    amount: 500,
    currency: "USD",
    description: "",
  });
  assert.equal(calls[0].options.body.has("description"), false);
});

test("Stripe validates payment input before making a request", async () => {
  let fetchCalls = 0;
  const provider = createProvider(async () => {
    fetchCalls += 1;
    return createResponse();
  });

  for (const input of [null, [], "payment"]) {
    await assert.rejects(
      provider.createPayment(input),
      /input must be an object/,
    );
  }

  for (const amount of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      provider.createPayment({ amount, currency: "USD" }),
      /amount must be a positive safe integer/,
    );
  }

  for (const currency of [undefined, "IRR", "usd"]) {
    await assert.rejects(
      provider.createPayment({ amount: 1099, currency }),
      /Stripe provider only supports USD/,
    );
  }

  for (const description of [null, 1, {}, "x".repeat(501)]) {
    await assert.rejects(
      provider.createPayment({
        amount: 1099,
        currency: "USD",
        description,
      }),
      /description must be a string of at most 500 characters/,
    );
  }

  for (const idempotencyKey of [
    null,
    1,
    "",
    "   ",
    "x".repeat(256),
  ]) {
    await assert.rejects(
      provider.createPayment({
        amount: 1099,
        currency: "USD",
        idempotencyKey,
      }),
      /idempotencyKey must be a string from 1 to 255 characters/,
    );
  }

  assert.equal(fetchCalls, 0);
});

test("Stripe checkout reconstruction exposes only public checkout data", () => {
  const provider = createProvider(async () => createResponse());
  const payment = {
    provider: "stripe",
    providerData: {
      client_secret: "pi_test_1_secret_1",
      payment_intent_status: "requires_payment_method",
      internal: "not-returned",
    },
  };

  assert.deepEqual(provider.getCheckout(payment), {
    clientSecret: "pi_test_1_secret_1",
    publishableKey: "pk_test_1",
  });

  for (const invalidPayment of [
    null,
    [],
    {},
    { provider: "zarinpal", providerData: payment.providerData },
    { provider: "stripe", providerData: null },
    { provider: "stripe", providerData: [] },
    { provider: "stripe", providerData: {} },
    { provider: "stripe", providerData: { client_secret: "" } },
  ]) {
    assert.throws(
      () => provider.getCheckout(invalidPayment),
      /payment must contain Stripe checkout data/,
    );
  }
});

test("Stripe rejections expose only safe provider metadata", async () => {
  const provider = createProvider(async () =>
    createResponse({
      ok: false,
      status: 402,
      requestId: "req_declined_1",
      body: {
        error: {
          code: "card_declined",
          message: "raw provider explanation that must stay private",
        },
        echoed_secret: "sk_test_1",
      },
    }),
  );

  await assert.rejects(
    provider.createPayment({ amount: 1099, currency: "USD" }),
    (error) => {
      assert.equal(error instanceof PaymentProviderError, true);
      assert.equal(error.message, "Stripe rejected the payment request.");
      assert.equal(error.provider, "stripe");
      assert.equal(error.kind, "rejected");
      assert.equal(error.upstreamStatus, 402);
      assert.equal(error.providerCode, "card_declined");
      assert.equal(error.requestId, "req_declined_1");
      assert.equal(error.diagnosticCode, null);
      assert.equal(
        JSON.stringify(error).includes("raw provider explanation"),
        false,
      );
      assert.equal(JSON.stringify(error).includes("sk_test_1"), false);
      return true;
    },
  );
});

test("Stripe transport failures become unreachable provider errors", async () => {
  const failures = [
    {
      error: Object.assign(new Error("socket reset"), {
        code: "ECONNRESET",
      }),
      diagnosticCode: "ECONNRESET",
    },
    {
      error: Object.assign(new Error("timed out"), {
        name: "TimeoutError",
      }),
      diagnosticCode: "TimeoutError",
    },
  ];

  for (const failure of failures) {
    const provider = createProvider(async () => {
      throw failure.error;
    });

    await assert.rejects(
      provider.createPayment({ amount: 1099, currency: "USD" }),
      (error) => {
        assert.equal(error instanceof PaymentProviderError, true);
        assert.equal(error.message, "Could not reach Stripe.");
        assert.equal(error.provider, "stripe");
        assert.equal(error.kind, "unreachable");
        assert.equal(error.upstreamStatus, null);
        assert.equal(error.providerCode, null);
        assert.equal(error.requestId, null);
        assert.equal(error.diagnosticCode, failure.diagnosticCode);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
});

test("Stripe rejects invalid response objects safely", async () => {
  const invalidResponses = [
    null,
    {},
    { ok: true, status: 200 },
    { ok: "true", status: 200, text: async () => "{}" },
    { ok: true, status: 99, text: async () => "{}" },
    { ok: true, status: 600, text: async () => "{}" },
  ];

  for (const response of invalidResponses) {
    const provider = createProvider(async () => response);

    await assert.rejects(
      provider.createPayment({ amount: 1099, currency: "USD" }),
      (error) => {
        assert.equal(error instanceof PaymentProviderError, true);
        assert.equal(error.message, "Stripe returned an invalid response.");
        assert.equal(error.kind, "unreachable");
        assert.equal(error.diagnosticCode, "invalid_response");
        return true;
      },
    );
  }
});

test("Stripe rejects unreadable, malformed, and incomplete responses", async () => {
  const unreadableProvider = createProvider(async () =>
    createResponse({
      status: 200,
      requestId: "req_unreadable_1",
      textError: Object.assign(new Error("read failed"), { code: "EPIPE" }),
    }),
  );
  await assert.rejects(
    unreadableProvider.createPayment({ amount: 1099, currency: "USD" }),
    (error) => {
      assert.equal(error.message, "Could not read the Stripe response.");
      assert.equal(error.kind, "unreachable");
      assert.equal(error.upstreamStatus, 200);
      assert.equal(error.requestId, "req_unreadable_1");
      assert.equal(error.diagnosticCode, "EPIPE");
      return true;
    },
  );

  const malformedJsonProvider = createProvider(async () =>
    createResponse({
      status: 200,
      requestId: "req_json_1",
      body: "not-json and sk_test_1 must not escape",
    }),
  );
  await assert.rejects(
    malformedJsonProvider.createPayment({ amount: 1099, currency: "USD" }),
    (error) => {
      assert.equal(error.message, "Stripe returned an invalid response.");
      assert.equal(error.kind, "unreachable");
      assert.equal(error.upstreamStatus, 200);
      assert.equal(error.requestId, "req_json_1");
      assert.equal(error.diagnosticCode, "SyntaxError");
      assert.equal(JSON.stringify(error).includes("not-json"), false);
      assert.equal(JSON.stringify(error).includes("sk_test_1"), false);
      return true;
    },
  );

  for (const body of [
    null,
    [],
    {},
    { id: "", client_secret: "secret", status: "pending" },
    { id: "pi_test_1", client_secret: "", status: "pending" },
    { id: "pi_test_1", client_secret: "secret", status: "" },
  ]) {
    const provider = createProvider(async () =>
      createResponse({ status: 200, requestId: "req_invalid_1", body }),
    );

    await assert.rejects(
      provider.createPayment({ amount: 1099, currency: "USD" }),
      (error) => {
        assert.equal(error.message, "Stripe returned an invalid response.");
        assert.equal(error.kind, "unreachable");
        assert.equal(error.upstreamStatus, 200);
        assert.equal(error.requestId, "req_invalid_1");
        assert.equal(error.diagnosticCode, "invalid_payment_intent");
        return true;
      },
    );
  }
});
