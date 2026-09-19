const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { fromProject, loadWithMocks } = require("../helpers/module");

const target = fromProject("services", "payment.service.js");
const paymentModel = fromProject("models", "payment.model.js");
const paymentCreationModel = fromProject(
  "models",
  "paymentCreation.model.js",
);
const paymentProviderService = fromProject(
  "services",
  "paymentProvider.service.js",
);
const PaymentProviderError = require(
  fromProject("errors", "PaymentProviderError.js"),
);

const PAYMENT_IDEMPOTENCY_SECRET = "p".repeat(32);

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

const createRequestFingerprint = (overrides = {}) => {
  const input = {
    version: 1,
    method: "POST",
    route: "/create-payment",
    provider: "stripe",
    amount: 1099,
    currency: "USD",
    description: "Test order",
    ...overrides,
  };

  return crypto
    .createHash("sha256")
    .update("payment-request-fingerprint:v1\0", "utf8")
    .update(JSON.stringify(input), "utf8")
    .digest("hex");
};

const createCreationClaim = (overrides = {}) => ({
  _id: "claim-1",
  user: "user-1",
  idempotencyKey: "order-1",
  requestFingerprint: createRequestFingerprint(),
  provider: "stripe",
  providerRequestKey: `payment_v1_${"a".repeat(64)}`,
  status: "succeeded",
  payment: "payment-1",
  failureKind: null,
  failureMessage: null,
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
  claimFindOneResults = [],
  createdPayment = createPaymentRecord(),
  createError,
  createDocument,
  claimCreateError,
  claimCreateDocument,
  updatedPayment = createPaymentRecord({ status: "succeeded" }),
  defaultProvider = createProvider().paymentProvider,
} = {}) => {
  const calls = {
    init: 0,
    claimInit: 0,
    findOne: [],
    claimFindOne: [],
    create: [],
    claimCreate: [],
    claimUpdate: [],
    toObject: 0,
    findOneAndUpdate: [],
  };
  const queuedFindOneResults = [...findOneResults];
  const queuedClaimFindOneResults = [...claimFindOneResults];
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
    [paymentCreationModel]: {
      async init() {
        calls.claimInit += 1;
      },
      findOne(filter) {
        const call = { filter, lean: false };
        calls.claimFindOne.push(call);

        return {
          async lean() {
            call.lean = true;
            return queuedClaimFindOneResults.shift() ?? null;
          },
        };
      },
      async create(data) {
        calls.claimCreate.push(data);

        if (claimCreateError) {
          throw claimCreateError;
        }

        if (claimCreateDocument !== undefined) {
          return claimCreateDocument;
        }

        return {
          toObject() {
            return { _id: "claim-1", ...data };
          },
        };
      },
      async updateOne(filter, update, options) {
        calls.claimUpdate.push({ filter, update, options });
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
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

test("payment creation claims the request before calling the provider", async () => {
  const { calls: providerCalls, paymentProvider } = createProvider();
  const { calls, service } = loadPaymentService({ findOneResults: [null] });
  const input = {
    userId: "user-1",
    amount: 1099,
    currency: "USD",
    description: "Test order",
    idempotencyKey: "order-1",
  };

  const result = await service.createPayment(input, {
    paymentProvider,
    idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET,
  });

  assert.equal(result.status, "created");
  assert.equal(calls.init, 1);
  assert.equal(calls.claimInit, 1);
  assert.equal(calls.claimCreate.length, 1);
  assert.equal(calls.claimCreate[0].status, "processing");
  assert.match(calls.claimCreate[0].requestFingerprint, /^[a-f0-9]{64}$/);
  assert.match(
    calls.claimCreate[0].providerRequestKey,
    /^payment_v1_[a-f0-9]{64}$/,
  );
  assert.notEqual(calls.claimCreate[0].providerRequestKey, "order-1");
  assert.equal(providerCalls.createPayment.length, 1);
  assert.equal(
    providerCalls.createPayment[0].idempotencyKey,
    calls.claimCreate[0].providerRequestKey,
  );
  assert.deepEqual(calls.create[0], {
    user: "user-1",
    provider: "stripe",
    externalId: "pi_test_1",
    amount: 1099,
    currency: "USD",
    providerData: { client_secret: "secret-1" },
    description: "Test order",
    idempotencyKey: "order-1",
  });
  assert.equal(calls.claimUpdate[0].update.$set.status, "succeeded");
  assert.equal(calls.claimUpdate[0].update.$set.payment, "payment-1");
});

test("provider idempotency keys are scoped to the authenticated user", async () => {
  const { calls: providerCalls, paymentProvider } = createProvider();

  for (const userId of ["user-1", "user-2"]) {
    const { service } = loadPaymentService({
      findOneResults: [null],
      createdPayment: createPaymentRecord({ user: userId }),
    });

    await service.createPayment(
      {
        userId,
        amount: 1099,
        currency: "USD",
        description: "Test order",
        idempotencyKey: "shared-client-key",
      },
      { paymentProvider, idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET },
    );
  }

  assert.equal(providerCalls.createPayment.length, 2);
  assert.notEqual(
    providerCalls.createPayment[0].idempotencyKey,
    providerCalls.createPayment[1].idempotencyKey,
  );
});

test("payment creation requires an idempotency key and accepts no description", async () => {
  const { paymentProvider } = createProvider();
  const missingKey = loadPaymentService();

  await assert.rejects(
    missingKey.service.createPayment(
      { userId: "user-1", amount: 1099, currency: "USD" },
      {
        paymentProvider,
        idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET,
      },
    ),
    /idempotencyKey must be a non-empty string/,
  );
  assert.equal(missingKey.calls.init, 0);

  const createdPayment = createPaymentRecord({ description: undefined });
  const { calls, service } = loadPaymentService({
    findOneResults: [null],
    createdPayment,
  });
  await service.createPayment(
    {
      userId: "user-1",
      amount: 1099,
      currency: "USD",
      idempotencyKey: "order-1",
    },
    { paymentProvider, idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET },
  );

  assert.equal(Object.hasOwn(calls.create[0], "description"), false);
  assert.equal(calls.create[0].idempotencyKey, "order-1");
});

test("a completed idempotency claim replays the stored payment", async () => {
  const existingPayment = createPaymentRecord();
  const { calls: providerCalls, paymentProvider } = createProvider();
  const { calls, service } = loadPaymentService({
    claimFindOneResults: [createCreationClaim()],
    findOneResults: [existingPayment],
  });

  const result = await service.createPayment(
    {
      userId: "user-1",
      amount: 1099,
      currency: "USD",
      description: "Test order",
      idempotencyKey: "order-1",
    },
    { paymentProvider, idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET },
  );

  assert.equal(result.status, "existing");
  assert.equal(result.payment, existingPayment);
  assert.equal(calls.claimCreate.length, 0);
  assert.equal(calls.create.length, 0);
  assert.equal(providerCalls.createPayment.length, 0);
});

test("an idempotency key cannot be reused for different payment details", async () => {
  const { calls: providerCalls, paymentProvider } = createProvider();
  const { calls, service } = loadPaymentService({
    claimFindOneResults: [createCreationClaim()],
  });

  assert.deepEqual(
    await service.createPayment(
      {
        userId: "user-1",
        amount: 2200,
        currency: "USD",
        description: "Test order",
        idempotencyKey: "order-1",
      },
      { paymentProvider, idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET },
    ),
    { status: "conflict" },
  );
  assert.equal(calls.findOne.length, 0);
  assert.equal(providerCalls.createPayment.length, 0);
});

test("a claimed request remains in progress until a payment is stored", async () => {
  const processingClaim = createCreationClaim({
    status: "processing",
    payment: null,
  });
  const { calls: providerCalls, paymentProvider } = createProvider();
  const { service } = loadPaymentService({
    claimFindOneResults: [processingClaim],
    findOneResults: [null],
  });

  assert.deepEqual(
    await service.createPayment(
      {
        userId: "user-1",
        amount: 1099,
        currency: "USD",
        description: "Test order",
        idempotencyKey: "order-1",
      },
      { paymentProvider, idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET },
    ),
    { status: "processing" },
  );
  assert.equal(providerCalls.createPayment.length, 0);
});

test("a processing claim recovers a payment stored before interruption", async () => {
  const existingPayment = createPaymentRecord();
  const { paymentProvider } = createProvider();
  const { calls, service } = loadPaymentService({
    claimFindOneResults: [
      createCreationClaim({ status: "processing", payment: null }),
    ],
    findOneResults: [existingPayment],
  });

  const result = await service.createPayment(
    {
      userId: "user-1",
      amount: 1099,
      currency: "USD",
      description: "Test order",
      idempotencyKey: "order-1",
    },
    { paymentProvider, idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET },
  );

  assert.equal(result.status, "existing");
  assert.equal(calls.claimUpdate[0].update.$set.status, "succeeded");
});

test("provider failures are persisted and replayed without a second call", async () => {
  const providerError = new PaymentProviderError(
    "Payment provider is unavailable.",
    { provider: "stripe", kind: "unreachable" },
  );
  const { calls: providerCalls, paymentProvider } = createProvider();
  paymentProvider.createPayment = async (input) => {
    providerCalls.createPayment.push(input);
    throw providerError;
  };
  const first = loadPaymentService({ findOneResults: [null] });

  await assert.rejects(
    first.service.createPayment(
      {
        userId: "user-1",
        amount: 1099,
        currency: "USD",
        description: "Test order",
        idempotencyKey: "order-1",
      },
      { paymentProvider, idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET },
    ),
    (error) => error === providerError,
  );
  assert.equal(first.calls.claimUpdate[0].update.$set.status, "failed");
  assert.equal(
    first.calls.claimUpdate[0].update.$set.failureKind,
    "unreachable",
  );

  const replayProvider = createProvider();
  const replay = loadPaymentService({
    claimFindOneResults: [
      createCreationClaim({
        status: "failed",
        payment: null,
        failureKind: "unreachable",
        failureMessage: "Payment provider is unavailable.",
      }),
    ],
  });
  await assert.rejects(
    replay.service.createPayment(
      {
        userId: "user-1",
        amount: 1099,
        currency: "USD",
        description: "Test order",
        idempotencyKey: "order-1",
      },
      {
        paymentProvider: replayProvider.paymentProvider,
        idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET,
      },
    ),
    (error) =>
      error instanceof PaymentProviderError &&
      error.kind === "unreachable",
  );
  assert.equal(replayProvider.calls.createPayment.length, 0);
});

test("a duplicate claim observes the winning request without calling the provider", async () => {
  const duplicateError = Object.assign(new Error("duplicate"), { code: 11000 });
  const { calls: providerCalls, paymentProvider } = createProvider();
  const { service } = loadPaymentService({
    claimFindOneResults: [
      null,
      createCreationClaim({ status: "processing", payment: null }),
    ],
    findOneResults: [null, null],
    claimCreateError: duplicateError,
  });

  assert.deepEqual(
    await service.createPayment(
      {
        userId: "user-1",
        amount: 1099,
        currency: "USD",
        description: "Test order",
        idempotencyKey: "order-1",
      },
      { paymentProvider, idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET },
    ),
    { status: "processing" },
  );
  assert.equal(providerCalls.createPayment.length, 0);
});

test("payment creation preserves unrecoverable claim database errors", async () => {
  for (const current of [
    Object.assign(new Error("duplicate without winner"), { code: 11000 }),
    Object.assign(new Error("database unavailable"), { code: 91 }),
  ]) {
    const { paymentProvider } = createProvider();
    const { service } = loadPaymentService({
      claimFindOneResults: [null, null],
      findOneResults: [null],
      claimCreateError: current,
    });

    await assert.rejects(
      service.createPayment(
        {
          userId: "user-1",
          amount: 1099,
          currency: "USD",
          description: "Test order",
          idempotencyKey: "order-1",
        },
        { paymentProvider, idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET },
      ),
      (error) => error === current,
    );
  }
});

test("payment creation rejects invalid provider contracts and results", async () => {
  const invalidProvider = { provider: "stripe", getCheckout() {} };
  const invalidContract = loadPaymentService();

  await assert.rejects(
    invalidContract.service.createPayment(
      {
        userId: "user-1",
        amount: 1099,
        currency: "USD",
        idempotencyKey: "order-1",
      },
      {
        paymentProvider: invalidProvider,
        idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET,
      },
    ),
    /paymentProvider must implement the payment contract/,
  );
  assert.equal(invalidContract.calls.init, 0);

  for (const createResult of [
    null,
    { externalId: "", providerData: {} },
    { externalId: "x".repeat(256), providerData: {} },
    { externalId: "pi_test_1", providerData: [] },
  ]) {
    const { paymentProvider } = createProvider({ createResult });
    const { service } = loadPaymentService({ findOneResults: [null] });

    await assert.rejects(
      service.createPayment(
        {
          userId: "user-1",
          amount: 1099,
          currency: "USD",
          description: "Test order",
          idempotencyKey: "order-1",
        },
        { paymentProvider, idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET },
      ),
      /Unexpected payment provider result/,
    );
  }
});

test("payment creation rejects invalid storage and provider mismatches", async () => {
  const { paymentProvider } = createProvider();
  const invalidStorage = loadPaymentService({
    findOneResults: [null],
    createDocument: {},
  });

  await assert.rejects(
    invalidStorage.service.createPayment(
      {
        userId: "user-1",
        amount: 1099,
        currency: "USD",
        description: "Test order",
        idempotencyKey: "order-1",
      },
      { paymentProvider, idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET },
    ),
    /Unexpected payment creation result/,
  );

  const providerMismatch = loadPaymentService({
    claimFindOneResults: [
      createCreationClaim({ provider: "zarinpal" }),
    ],
  });
  assert.deepEqual(
    await providerMismatch.service.createPayment(
      {
        userId: "user-1",
        amount: 1099,
        currency: "USD",
        description: "Test order",
        idempotencyKey: "order-1",
      },
      { paymentProvider, idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET },
    ),
    { status: "conflict" },
  );
});

test("payment creation can use the configured default provider", async () => {
  const { calls: providerCalls, paymentProvider } = createProvider();
  const { service } = loadPaymentService({
    defaultProvider: paymentProvider,
    findOneResults: [null],
  });

  const result = await service.createPayment(
    {
      userId: "user-1",
      amount: 1099,
      currency: "USD",
      description: "Test order",
      idempotencyKey: "order-1",
    },
    { idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET },
  );

  assert.equal(result.status, "created");
  assert.equal(providerCalls.createPayment.length, 1);
});

test("concurrent matching requests produce only one provider side effect", async () => {
  const state = { claim: null, payment: null };
  let releaseProvider;
  let reportProviderStarted;
  const providerGate = new Promise((resolve) => {
    releaseProvider = resolve;
  });
  const providerStarted = new Promise((resolve) => {
    reportProviderStarted = resolve;
  });
  const { calls: providerCalls, paymentProvider } = createProvider();
  paymentProvider.createPayment = async (input) => {
    providerCalls.createPayment.push(input);
    reportProviderStarted();
    await providerGate;
    return {
      externalId: "pi_test_1",
      providerData: { client_secret: "secret-1" },
    };
  };

  const service = loadWithMocks(target, {
    [paymentModel]: {
      async init() {},
      findOne() {
        return { lean: async () => state.payment };
      },
      async create(data) {
        state.payment = createPaymentRecord(data);
        return { toObject: () => state.payment };
      },
    },
    [paymentCreationModel]: {
      async init() {},
      findOne() {
        return { lean: async () => state.claim };
      },
      async create(data) {
        if (state.claim) {
          throw Object.assign(new Error("duplicate"), { code: 11000 });
        }

        state.claim = { _id: "claim-1", ...data };
        return { toObject: () => state.claim };
      },
      async updateOne(_filter, update) {
        state.claim = { ...state.claim, ...update.$set };
        return { acknowledged: true, matchedCount: 1, modifiedCount: 1 };
      },
    },
    [paymentProviderService]: {
      getConfiguredPaymentProvider() {
        return paymentProvider;
      },
    },
  });
  const input = {
    userId: "user-1",
    amount: 1099,
    currency: "USD",
    description: "Test order",
    idempotencyKey: "order-1",
  };
  const options = {
    paymentProvider,
    idempotencySecret: PAYMENT_IDEMPOTENCY_SECRET,
  };

  const winner = service.createPayment(input, options);
  await providerStarted;
  const concurrentReplay = await service.createPayment(input, options);
  releaseProvider();
  const winnerResult = await winner;

  assert.equal(winnerResult.status, "created");
  assert.deepEqual(concurrentReplay, { status: "processing" });
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
