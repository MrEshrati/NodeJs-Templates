const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const target = fromProject("services", "payment.service.js");
const paymentModel = fromProject("models", "payment.model.js");
const paymentProviderService = fromProject(
  "services",
  "paymentProvider.service.js",
);

const createPaymentRecord = (overrides = {}) => ({
  _id: "payment-1",
  user: "user-1",
  provider: "stripe",
  externalId: "pi_test_1",
  amount: 1099,
  currency: "USD",
  description: "Test order",
  status: "pending",
  refundedAmount: 0,
  providerData: { client_secret: "secret-1" },
  idempotencyKey: "order-1",
  ...overrides,
});

const createProvider = ({
  provider = "stripe",
  fakeMode = true,
  createResult = {
    externalId: "pi_test_1",
    providerData: { client_secret: "secret-1" },
  },
  checkout = {
    clientSecret: "secret-1",
    publishableKey: "pk_test_1",
  },
  simulationResult,
  includeSimulation = true,
} = {}) => {
  const calls = {
    createPayment: [],
    getCheckout: [],
    simulatePayment: [],
  };
  const paymentProvider = {
    provider,
    fakeMode,
    async createPayment(input) {
      calls.createPayment.push(input);
      return createResult;
    },
    getCheckout(payment) {
      calls.getCheckout.push(payment);
      return checkout;
    },
  };

  if (includeSimulation) {
    paymentProvider.simulatePayment = async (input) => {
      calls.simulatePayment.push(input);

      if (simulationResult !== undefined) {
        return simulationResult;
      }

      return {
        status: input.outcome,
        refundedAmount:
          input.outcome === "refunded" ? input.payment.amount : 0,
        providerData: {
          ...input.payment.providerData,
          simulated_outcome: input.outcome,
        },
      };
    };
  }

  return { calls, paymentProvider };
};

const loadPaymentService = ({
  findOneResults = [],
  createdPayment = createPaymentRecord(),
  createError,
  createDocument,
  updatedPayment = createPaymentRecord({ status: "succeeded" }),
  defaultProvider = createProvider().paymentProvider,
} = {}) => {
  const calls = {
    init: 0,
    findOne: [],
    create: [],
    toObject: 0,
    findOneAndUpdate: [],
  };
  const queuedFindOneResults = [...findOneResults];
  const service = loadWithMocks(target, {
    [paymentModel]: {
      async init() {
        calls.init += 1;
      },
      findOne(filter) {
        const call = { filter, lean: false };
        calls.findOne.push(call);

        return {
          async lean() {
            call.lean = true;
            return queuedFindOneResults.shift() ?? null;
          },
        };
      },
      async create(data) {
        calls.create.push(data);

        if (createError) {
          throw createError;
        }

        if (createDocument !== undefined) {
          return createDocument;
        }

        return {
          toObject() {
            calls.toObject += 1;
            return createdPayment;
          },
        };
      },
      findOneAndUpdate(filter, update, options) {
        const call = { filter, update, options, lean: false };
        calls.findOneAndUpdate.push(call);

        return {
          async lean() {
            call.lean = true;
            return updatedPayment;
          },
        };
      },
    },
    [paymentProviderService]: {
      getConfiguredPaymentProvider() {
        return defaultProvider;
      },
    },
  });

  return { calls, service };
};

test("payment creation persists provider data and returns checkout data", async () => {
  const { calls: providerCalls, paymentProvider } = createProvider();
  const { calls, service } = loadPaymentService({ findOneResults: [null] });
  const input = {
    userId: "user-1",
    amount: 1099,
    currency: "USD",
    description: "Test order",
    idempotencyKey: "order-1",
  };

  assert.deepEqual(
    await service.createPayment(input, { paymentProvider }),
    {
      status: "created",
      payment: createPaymentRecord(),
      checkout: {
        clientSecret: "secret-1",
        publishableKey: "pk_test_1",
      },
    },
  );
  assert.equal(calls.init, 1);
  assert.deepEqual(calls.findOne[0], {
    filter: { user: "user-1", idempotencyKey: "order-1" },
    lean: true,
  });
  assert.deepEqual(providerCalls.createPayment, [
    {
      amount: 1099,
      currency: "USD",
      description: "Test order",
      idempotencyKey: "order-1",
    },
  ]);
  assert.deepEqual(calls.create, [
    {
      user: "user-1",
      provider: "stripe",
      externalId: "pi_test_1",
      amount: 1099,
      currency: "USD",
      providerData: { client_secret: "secret-1" },
      description: "Test order",
      idempotencyKey: "order-1",
    },
  ]);
  assert.equal(calls.toObject, 1);
  assert.deepEqual(providerCalls.getCheckout, [createPaymentRecord()]);
});

test("payment creation omits absent optional persistence fields", async () => {
  const { paymentProvider } = createProvider();
  const createdPayment = createPaymentRecord({
    description: undefined,
    idempotencyKey: undefined,
  });
  const { calls, service } = loadPaymentService({ createdPayment });

  await service.createPayment(
    { userId: "user-1", amount: 1099, currency: "USD" },
    { paymentProvider },
  );

  assert.equal(calls.findOne.length, 0);
  assert.equal(Object.hasOwn(calls.create[0], "description"), false);
  assert.equal(Object.hasOwn(calls.create[0], "idempotencyKey"), false);
});

test("idempotent payment creation reuses the existing payment", async () => {
  const existingPayment = createPaymentRecord();
  const { calls: providerCalls, paymentProvider } = createProvider();
  const { calls, service } = loadPaymentService({
    findOneResults: [existingPayment],
  });

  assert.deepEqual(
    await service.createPayment(
      {
        userId: "user-1",
        amount: 1099,
        currency: "USD",
        idempotencyKey: "order-1",
      },
      { paymentProvider },
    ),
    {
      status: "existing",
      payment: existingPayment,
      checkout: {
        clientSecret: "secret-1",
        publishableKey: "pk_test_1",
      },
    },
  );
  assert.equal(calls.create.length, 0);
  assert.equal(providerCalls.createPayment.length, 0);
  assert.deepEqual(providerCalls.getCheckout, [existingPayment]);
});

test("duplicate idempotency races reload the winning payment", async () => {
  const duplicateError = Object.assign(new Error("duplicate"), { code: 11000 });
  const existingPayment = createPaymentRecord();
  const { paymentProvider } = createProvider();
  const { calls, service } = loadPaymentService({
    findOneResults: [null, existingPayment],
    createError: duplicateError,
  });

  const result = await service.createPayment(
    {
      userId: "user-1",
      amount: 1099,
      currency: "USD",
      idempotencyKey: "order-1",
    },
    { paymentProvider },
  );

  assert.equal(result.status, "existing");
  assert.equal(result.payment, existingPayment);
  assert.equal(calls.findOne.length, 2);
  assert.deepEqual(calls.findOne[1].filter, {
    user: "user-1",
    idempotencyKey: "order-1",
  });
});

test("payment creation preserves database errors that cannot be recovered", async () => {
  const cases = [
    {
      error: Object.assign(new Error("duplicate without winner"), {
        code: 11000,
      }),
      findOneResults: [null, null],
      idempotencyKey: "order-1",
      expectedFindCount: 2,
    },
    {
      error: Object.assign(new Error("database unavailable"), { code: 91 }),
      findOneResults: [],
      idempotencyKey: undefined,
      expectedFindCount: 0,
    },
  ];

  for (const current of cases) {
    const { paymentProvider } = createProvider();
    const { calls, service } = loadPaymentService({
      findOneResults: current.findOneResults,
      createError: current.error,
    });

    await assert.rejects(
      service.createPayment(
        {
          userId: "user-1",
          amount: 1099,
          currency: "USD",
          idempotencyKey: current.idempotencyKey,
        },
        { paymentProvider },
      ),
      (error) => error === current.error,
    );
    assert.equal(calls.findOne.length, current.expectedFindCount);
  }
});

test("payment creation rejects invalid provider contracts and results", async () => {
  const invalidProvider = {
    provider: "stripe",
    getCheckout() {},
  };
  const invalidContract = loadPaymentService();

  await assert.rejects(
    invalidContract.service.createPayment(
      { userId: "user-1", amount: 1099, currency: "USD" },
      { paymentProvider: invalidProvider },
    ),
    /paymentProvider must implement the payment contract/,
  );
  assert.equal(invalidContract.calls.init, 0);

  const invalidResults = [
    null,
    { externalId: "", providerData: {} },
    { externalId: "x".repeat(256), providerData: {} },
    { externalId: "pi_test_1", providerData: [] },
  ];

  for (const createResult of invalidResults) {
    const { paymentProvider } = createProvider({ createResult });
    const { service } = loadPaymentService();

    await assert.rejects(
      service.createPayment(
        { userId: "user-1", amount: 1099, currency: "USD" },
        { paymentProvider },
      ),
      /Unexpected payment provider result/,
    );
  }
});

test("payment creation rejects invalid storage and provider mismatches", async () => {
  const { paymentProvider } = createProvider();
  const invalidStorage = loadPaymentService({ createDocument: {} });

  await assert.rejects(
    invalidStorage.service.createPayment(
      { userId: "user-1", amount: 1099, currency: "USD" },
      { paymentProvider },
    ),
    /Unexpected payment creation result/,
  );

  const providerMismatch = loadPaymentService({
    findOneResults: [createPaymentRecord({ provider: "zarinpal" })],
  });

  await assert.rejects(
    providerMismatch.service.createPayment(
      {
        userId: "user-1",
        amount: 1099,
        currency: "USD",
        idempotencyKey: "order-1",
      },
      { paymentProvider },
    ),
    /Existing payment does not match the configured provider/,
  );
});

test("payment creation can use the configured default provider", async () => {
  const { calls: providerCalls, paymentProvider } = createProvider();
  const { service } = loadPaymentService({ defaultProvider: paymentProvider });

  const result = await service.createPayment({
    userId: "user-1",
    amount: 1099,
    currency: "USD",
  });

  assert.equal(result.status, "created");
  assert.equal(providerCalls.createPayment.length, 1);
});

test("live providers do not expose payment simulation", async () => {
  for (const providerOptions of [
    { fakeMode: false },
    { fakeMode: true, includeSimulation: false },
  ]) {
    const { paymentProvider } = createProvider(providerOptions);
    const { calls, service } = loadPaymentService();

    assert.deepEqual(
      await service.simulatePaymentConfirmation(
        {
          userId: "user-1",
          paymentId: "payment-1",
          outcome: "succeeded",
        },
        { paymentProvider },
      ),
      { status: "unavailable" },
    );
    assert.equal(calls.findOne.length, 0);
  }
});

test("payment simulation rejects outcomes unsupported by the provider", async () => {
  const cases = [
    { provider: "stripe", outcome: "cancelled" },
    { provider: "zarinpal", outcome: "refunded" },
  ];

  for (const current of cases) {
    const { paymentProvider } = createProvider({
      provider: current.provider,
    });
    const { calls, service } = loadPaymentService();

    await assert.rejects(
      service.simulatePaymentConfirmation(
        {
          userId: "user-1",
          paymentId: "payment-1",
          outcome: current.outcome,
        },
        { paymentProvider },
      ),
      /unsupported .* simulation outcome/,
    );
    assert.equal(calls.findOne.length, 0);
  }
});

test("payment simulation is ownership and provider scoped", async () => {
  const { paymentProvider } = createProvider();
  const { calls, service } = loadPaymentService({ findOneResults: [null] });

  assert.deepEqual(
    await service.simulatePaymentConfirmation(
      {
        userId: "user-1",
        paymentId: "payment-1",
        outcome: "succeeded",
      },
      { paymentProvider },
    ),
    { status: "not_found" },
  );
  assert.deepEqual(calls.findOne[0], {
    filter: {
      _id: "payment-1",
      user: "user-1",
      provider: "stripe",
    },
    lean: true,
  });
});

test("payment simulation atomically updates a pending payment", async () => {
  const pendingPayment = createPaymentRecord();
  const updatedPayment = createPaymentRecord({
    status: "succeeded",
    providerData: {
      client_secret: "secret-1",
      simulated_outcome: "succeeded",
    },
  });
  const { calls: providerCalls, paymentProvider } = createProvider();
  const { calls, service } = loadPaymentService({
    findOneResults: [pendingPayment],
    updatedPayment,
  });

  assert.deepEqual(
    await service.simulatePaymentConfirmation(
      {
        userId: "user-1",
        paymentId: "payment-1",
        outcome: "succeeded",
      },
      { paymentProvider },
    ),
    { status: "updated", payment: updatedPayment },
  );
  assert.deepEqual(providerCalls.simulatePayment, [
    { payment: pendingPayment, outcome: "succeeded" },
  ]);
  assert.deepEqual(calls.findOneAndUpdate[0], {
    filter: {
      _id: "payment-1",
      user: "user-1",
      provider: "stripe",
      status: "pending",
    },
    update: {
      $set: {
        status: "succeeded",
        refundedAmount: 0,
        providerData: {
          client_secret: "secret-1",
          simulated_outcome: "succeeded",
        },
      },
    },
    options: { returnDocument: "after", runValidators: true },
    lean: true,
  });
});

test("Stripe simulation permits a full refund after success", async () => {
  const succeededPayment = createPaymentRecord({ status: "succeeded" });
  const refundedPayment = createPaymentRecord({
    status: "refunded",
    refundedAmount: 1099,
  });
  const { paymentProvider } = createProvider();
  const { calls, service } = loadPaymentService({
    findOneResults: [succeededPayment],
    updatedPayment: refundedPayment,
  });

  assert.deepEqual(
    await service.simulatePaymentConfirmation(
      {
        userId: "user-1",
        paymentId: "payment-1",
        outcome: "refunded",
      },
      { paymentProvider },
    ),
    { status: "updated", payment: refundedPayment },
  );
  assert.equal(calls.findOneAndUpdate[0].update.$set.refundedAmount, 1099);
});

test("completed or repeated simulations remain unchanged", async () => {
  const cases = [
    { status: "succeeded", outcome: "succeeded" },
    { status: "succeeded", outcome: "failed" },
    { status: "failed", outcome: "succeeded" },
    { status: "refunded", outcome: "refunded" },
  ];

  for (const current of cases) {
    const payment = createPaymentRecord({ status: current.status });
    const { calls: providerCalls, paymentProvider } = createProvider();
    const { calls, service } = loadPaymentService({
      findOneResults: [payment],
    });

    assert.deepEqual(
      await service.simulatePaymentConfirmation(
        {
          userId: "user-1",
          paymentId: "payment-1",
          outcome: current.outcome,
        },
        { paymentProvider },
      ),
      { status: "unchanged", payment },
    );
    assert.equal(providerCalls.simulatePayment.length, 0);
    assert.equal(calls.findOneAndUpdate.length, 0);
  }
});

test("payment simulation rejects invalid stored and provider results", async () => {
  const invalidPayments = [
    createPaymentRecord({ status: "unknown" }),
    createPaymentRecord({ amount: 0 }),
  ];

  for (const payment of invalidPayments) {
    const { paymentProvider } = createProvider();
    const { service } = loadPaymentService({ findOneResults: [payment] });

    await assert.rejects(
      service.simulatePaymentConfirmation(
        {
          userId: "user-1",
          paymentId: "payment-1",
          outcome: "succeeded",
        },
        { paymentProvider },
      ),
      /Unexpected stored payment data/,
    );
  }

  const invalidSimulationResults = [
    null,
    { status: "failed", refundedAmount: 0, providerData: {} },
    { status: "succeeded", refundedAmount: 1, providerData: {} },
    { status: "succeeded", refundedAmount: 0, providerData: [] },
  ];

  for (const simulationResult of invalidSimulationResults) {
    const { paymentProvider } = createProvider({ simulationResult });
    const { service } = loadPaymentService({
      findOneResults: [createPaymentRecord()],
    });

    await assert.rejects(
      service.simulatePaymentConfirmation(
        {
          userId: "user-1",
          paymentId: "payment-1",
          outcome: "succeeded",
        },
        { paymentProvider },
      ),
      /Unexpected payment simulation result/,
    );
  }
});

test("failed simulation compare-and-set reloads the current payment", async () => {
  const pendingPayment = createPaymentRecord();
  const currentPayment = createPaymentRecord({ status: "succeeded" });
  const { paymentProvider } = createProvider();
  const { calls, service } = loadPaymentService({
    findOneResults: [pendingPayment, currentPayment],
    updatedPayment: null,
  });

  assert.deepEqual(
    await service.simulatePaymentConfirmation(
      {
        userId: "user-1",
        paymentId: "payment-1",
        outcome: "succeeded",
      },
      { paymentProvider },
    ),
    { status: "unchanged", payment: currentPayment },
  );
  assert.equal(calls.findOne.length, 2);
  assert.deepEqual(calls.findOne[1].filter, calls.findOne[0].filter);
});

test("a payment removed during simulation returns not found", async () => {
  const { paymentProvider } = createProvider();
  const { service } = loadPaymentService({
    findOneResults: [createPaymentRecord(), null],
    updatedPayment: null,
  });

  assert.deepEqual(
    await service.simulatePaymentConfirmation(
      {
        userId: "user-1",
        paymentId: "payment-1",
        outcome: "succeeded",
      },
      { paymentProvider },
    ),
    { status: "not_found" },
  );
});
