const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const target = fromProject("controllers", "payment.controller.js");
const paymentService = fromProject("services", "payment.service.js");
const paymentUtils = fromProject("utils", "payment.utils.js");
const PaymentProviderError = require(
  fromProject("errors", "PaymentProviderError.js"),
);

const createResponse = () => ({
  statusCode: null,
  payload: undefined,
  status(code) {
    this.statusCode = code;
    return this;
  },
  json(payload) {
    this.payload = payload;
    return this;
  },
});

const createStripePayment = (overrides = {}) => ({
  _id: "payment-1",
  provider: "stripe",
  status: "pending",
  ...overrides,
});

const loadController = () => {
  const calls = {
    create: [],
    simulate: [],
    serialize: [],
  };
  const state = {
    createError: null,
    createResult: {
      status: "created",
      payment: createStripePayment(),
      checkout: {
        clientSecret: "secret-1",
        publishableKey: "pk_test_1",
      },
    },
    simulateError: null,
    simulateResult: {
      status: "updated",
      payment: createStripePayment({ status: "succeeded" }),
    },
  };
  const controller = loadWithMocks(target, {
    [paymentService]: {
      async createPayment(input) {
        calls.create.push(input);

        if (state.createError) {
          throw state.createError;
        }

        return state.createResult;
      },
      async simulatePaymentConfirmation(input) {
        calls.simulate.push(input);

        if (state.simulateError) {
          throw state.simulateError;
        }

        return state.simulateResult;
      },
    },
    [paymentUtils]: {
      serializePayment(payment) {
        calls.serialize.push(payment);
        return {
          id: String(payment._id),
          status: payment.status,
          serialized: true,
        };
      },
    },
  });

  return { calls, controller, state };
};

const invoke = async (handler, req) => {
  const res = createResponse();
  let forwarded;

  await handler(req, res, (error) => {
    forwarded = error;
  });

  return { forwarded, res };
};

test("create-payment controller returns a new Stripe checkout", async () => {
  const { calls, controller } = loadController();
  const validatedBody = {
    amount: 1099,
    currency: "USD",
    description: "Test order",
    idempotencyKey: "order-1",
  };
  const { forwarded, res } = await invoke(controller.createPayment, {
    user: { _id: "user-1" },
    validatedBody,
  });

  assert.equal(forwarded, undefined);
  assert.deepEqual(calls.create, [
    {
      userId: "user-1",
      amount: 1099,
      currency: "USD",
      description: "Test order",
      idempotencyKey: "order-1",
    },
  ]);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.payload, {
    payment_id: "payment-1",
    client_secret: "secret-1",
    publishable_key: "pk_test_1",
  });
  assert.equal(Object.hasOwn(res.payload, "provider_data"), false);
});

test("create-payment controller returns 200 for an idempotent replay", async () => {
  const { controller, state } = loadController();
  state.createResult.status = "existing";

  const { forwarded, res } = await invoke(controller.createPayment, {
    user: { _id: "user-1" },
    validatedBody: {
      amount: 1099,
      currency: "USD",
      idempotencyKey: "order-1",
    },
  });

  assert.equal(forwarded, undefined);
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.payload, {
    payment_id: "payment-1",
    client_secret: "secret-1",
    publishable_key: "pk_test_1",
  });
});

test("create-payment controller reports idempotency conflicts and in-progress requests", async () => {
  for (const [status, expected] of [
    [
      "conflict",
      {
        code: "idempotency_conflict",
        message:
          "Idempotency key was already used with different payment details.",
      },
    ],
    [
      "processing",
      {
        code: "payment_in_progress",
        message: "Payment creation is still processing.",
      },
    ],
  ]) {
    const { controller, state } = loadController();
    state.createResult = { status };

    const { forwarded, res } = await invoke(controller.createPayment, {
      user: { _id: "user-1" },
      validatedBody: {
        amount: 1099,
        currency: "USD",
        idempotencyKey: "order-1",
      },
    });

    assert.equal(forwarded.statusCode, 409);
    assert.equal(forwarded.code, expected.code);
    assert.equal(forwarded.message, expected.message);
    assert.equal(res.statusCode, null);
  }
});

test("create-payment controller returns a ZarinPal redirect", async () => {
  const { calls, controller, state } = loadController();
  state.createResult = {
    status: "created",
    payment: {
      _id: "payment-2",
      provider: "zarinpal",
      status: "pending",
    },
    checkout: {
      redirectUrl:
        "https://payment.zarinpal.com/pg/StartPay/authority-1",
    },
  };

  const { forwarded, res } = await invoke(controller.createPayment, {
    user: { _id: "user-2" },
    validatedBody: {
      amount: 50000,
      currency: "IRR",
      idempotencyKey: "order-2",
    },
  });

  assert.equal(forwarded, undefined);
  assert.deepEqual(calls.create, [
    {
      userId: "user-2",
      amount: 50000,
      currency: "IRR",
      idempotencyKey: "order-2",
    },
  ]);
  assert.equal(res.statusCode, 201);
  assert.deepEqual(res.payload, {
    payment_id: "payment-2",
    redirect_url:
      "https://payment.zarinpal.com/pg/StartPay/authority-1",
  });
  assert.equal(Object.hasOwn(res.payload, "provider_data"), false);
});

test("create-payment controller rejects malformed service results", async () => {
  const { controller, state } = loadController();
  const req = {
    user: { _id: "user-1" },
    validatedBody: { amount: 1099, currency: "USD" },
  };
  const invalidResults = [
    null,
    {
      status: "unexpected",
      payment: createStripePayment(),
      checkout: {},
    },
    { status: "created", payment: null, checkout: {} },
    {
      status: "created",
      payment: createStripePayment(),
      checkout: { clientSecret: "secret-1" },
    },
    {
      status: "created",
      payment: { _id: "payment-2", provider: "zarinpal" },
      checkout: { redirectUrl: "" },
    },
    {
      status: "created",
      payment: { _id: "payment-3", provider: "unknown" },
      checkout: { redirectUrl: "https://example.com" },
    },
  ];

  for (const result of invalidResults) {
    state.createResult = result;
    const { forwarded, res } = await invoke(controller.createPayment, req);

    assert.ok(forwarded instanceof Error);
    assert.equal(forwarded.statusCode, undefined);
    assert.equal(res.statusCode, null);
    assert.equal(res.payload, undefined);
  }
});

test("simulation controller passes validated input and serializes success", async () => {
  for (const status of ["updated", "unchanged"]) {
    const { calls, controller, state } = loadController();
    const payment = createStripePayment({ status: "succeeded" });
    state.simulateResult = { status, payment };

    const { forwarded, res } = await invoke(
      controller.simulatePaymentConfirmation,
      {
        user: { _id: "user-1" },
        validatedBody: {
          paymentId: "payment-1",
          outcome: "succeeded",
        },
      },
    );

    assert.equal(forwarded, undefined);
    assert.deepEqual(calls.simulate, [
      {
        userId: "user-1",
        paymentId: "payment-1",
        outcome: "succeeded",
      },
    ]);
    assert.deepEqual(calls.serialize, [payment]);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(res.payload, {
      id: "payment-1",
      status: "succeeded",
      serialized: true,
    });
  }
});

test("simulation controller hides missing and unavailable payments", async () => {
  const { controller, state } = loadController();
  const req = {
    user: { _id: "user-1" },
    validatedBody: {
      paymentId: "payment-1",
      outcome: "succeeded",
    },
  };

  for (const status of ["not_found", "unavailable"]) {
    state.simulateResult = { status };
    const { forwarded, res } = await invoke(
      controller.simulatePaymentConfirmation,
      req,
    );

    assert.equal(forwarded.statusCode, 404);
    assert.equal(forwarded.code, "not_found");
    assert.equal(forwarded.message, "No Payment matches the given query.");
    assert.equal(res.statusCode, null);
  }
});

test("simulation controller rejects malformed service results", async () => {
  const { calls, controller, state } = loadController();
  const req = {
    user: { _id: "user-1" },
    validatedBody: {
      paymentId: "payment-1",
      outcome: "succeeded",
    },
  };

  for (const result of [
    null,
    { status: "unexpected", payment: createStripePayment() },
    { status: "updated", payment: null },
    { status: "unchanged" },
  ]) {
    state.simulateResult = result;
    const { forwarded, res } = await invoke(
      controller.simulatePaymentConfirmation,
      req,
    );

    assert.match(
      forwarded.message,
      /Unexpected payment simulation service result/,
    );
    assert.equal(res.statusCode, null);
  }

  assert.equal(calls.serialize.length, 0);
});

test("payment provider failures are mapped to a safe gateway error", async () => {
  const cases = [
    {
      action: "createPayment",
      stateKey: "createError",
      req: {
        user: { _id: "user-1" },
        validatedBody: { amount: 1099, currency: "USD" },
      },
    },
    {
      action: "simulatePaymentConfirmation",
      stateKey: "simulateError",
      req: {
        user: { _id: "user-1" },
        validatedBody: {
          paymentId: "payment-1",
          outcome: "succeeded",
        },
      },
    },
  ];

  for (const current of cases) {
    const { controller, state } = loadController();
    state[current.stateKey] = new PaymentProviderError(
      "Payment provider is unavailable.",
      {
        provider: "stripe",
        kind: "unreachable",
        upstreamStatus: 503,
        requestId: "provider-request-1",
      },
    );

    const { forwarded, res } = await invoke(
      controller[current.action],
      current.req,
    );

    assert.equal(forwarded.statusCode, 502);
    assert.equal(forwarded.code, "payment_provider_error");
    assert.equal(forwarded.message, "Payment provider is unavailable.");
    assert.equal(forwarded.fields, null);
    assert.equal(Object.hasOwn(forwarded, "requestId"), false);
    assert.equal(res.statusCode, null);
  }
});

test("unexpected payment errors are forwarded unchanged", async () => {
  const cases = [
    {
      action: "createPayment",
      stateKey: "createError",
      req: {
        user: { _id: "user-1" },
        validatedBody: { amount: 1099, currency: "USD" },
      },
    },
    {
      action: "simulatePaymentConfirmation",
      stateKey: "simulateError",
      req: {
        user: { _id: "user-1" },
        validatedBody: {
          paymentId: "payment-1",
          outcome: "succeeded",
        },
      },
    },
  ];

  for (const current of cases) {
    const { controller, state } = loadController();
    const unexpectedError = new Error("database unavailable");
    state[current.stateKey] = unexpectedError;

    const { forwarded, res } = await invoke(
      controller[current.action],
      current.req,
    );

    assert.equal(forwarded, unexpectedError);
    assert.equal(res.statusCode, null);
    assert.equal(res.payload, undefined);
  }
});
