const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const target = fromProject("services", "paymentProvider.service.js");
const environmentConfig = fromProject("config", "environment.js");
const fakeStripeProvider = fromProject(
  "services",
  "paymentProviders",
  "fakeStripe.provider.js",
);
const fakeZarinpalProvider = fromProject(
  "services",
  "paymentProviders",
  "fakeZarinpal.provider.js",
);
const stripeProvider = fromProject(
  "services",
  "paymentProviders",
  "stripe.provider.js",
);
const zarinpalProvider = fromProject(
  "services",
  "paymentProviders",
  "zarinpal.provider.js",
);

const createAdapter = ({
  provider,
  simulation = false,
  verification = false,
} = {}) => {
  const adapter = {
    provider,
    createPayment: () => {},
    getCheckout: () => {},
    internalMethod: () => {},
  };

  if (simulation) {
    adapter.simulatePayment = () => {};
  }

  if (verification) {
    adapter.verifyPayment = () => {};
  }

  return adapter;
};

const loadProviderService = ({
  fakeStripeAdapter = createAdapter({
    provider: "stripe",
    simulation: true,
  }),
  fakeZarinpalAdapter = createAdapter({
    provider: "zarinpal",
    simulation: true,
  }),
  liveStripeAdapter = createAdapter({ provider: "stripe" }),
  liveZarinpalAdapter = createAdapter({
    provider: "zarinpal",
    verification: true,
  }),
  validatedConfig = {
    provider: "stripe",
    fakeMode: true,
  },
} = {}) => {
  const calls = {
    environment: [],
    stripeFactory: [],
    zarinpalFactory: [],
  };
  const service = loadWithMocks(target, {
    [environmentConfig]: {
      validatePaymentEnvironment(environment) {
        calls.environment.push(environment);
        return validatedConfig;
      },
    },
    [fakeStripeProvider]: fakeStripeAdapter,
    [fakeZarinpalProvider]: fakeZarinpalAdapter,
    [stripeProvider]: {
      createStripeProvider(options) {
        calls.stripeFactory.push(options);
        return liveStripeAdapter;
      },
    },
    [zarinpalProvider]: {
      createZarinpalProvider(options) {
        calls.zarinpalFactory.push(options);
        return liveZarinpalAdapter;
      },
    },
  });

  return {
    adapters: {
      fakeStripeAdapter,
      fakeZarinpalAdapter,
      liveStripeAdapter,
      liveZarinpalAdapter,
    },
    calls,
    service,
  };
};

test("fake provider resolution selects minimal frozen adapters", () => {
  const { adapters, calls, service } = loadProviderService();
  const cases = [
    {
      config: { provider: "stripe", fakeMode: true },
      adapter: adapters.fakeStripeAdapter,
    },
    {
      config: { provider: "zarinpal", fakeMode: true },
      adapter: adapters.fakeZarinpalAdapter,
    },
  ];

  for (const { config, adapter } of cases) {
    const paymentProvider = service.createPaymentProvider(config);

    assert.equal(paymentProvider.provider, config.provider);
    assert.equal(paymentProvider.fakeMode, true);
    assert.equal(paymentProvider.createPayment, adapter.createPayment);
    assert.equal(paymentProvider.getCheckout, adapter.getCheckout);
    assert.equal(paymentProvider.simulatePayment, adapter.simulatePayment);
    assert.equal(Object.hasOwn(paymentProvider, "verifyPayment"), false);
    assert.equal(Object.hasOwn(paymentProvider, "internalMethod"), false);
    assert.equal(Object.isFrozen(paymentProvider), true);
    assert.deepEqual(Object.keys(paymentProvider), [
      "provider",
      "fakeMode",
      "createPayment",
      "getCheckout",
      "simulatePayment",
    ]);
  }

  assert.deepEqual(calls.stripeFactory, []);
  assert.deepEqual(calls.zarinpalFactory, []);
});

test("live Stripe resolution forwards only approved configuration", () => {
  const { adapters, calls, service } = loadProviderService();
  const fetchImpl = async () => {};
  const paymentProvider = service.createPaymentProvider(
    {
      provider: "stripe",
      fakeMode: false,
      credentials: {
        secretKey: "sk_test_1",
        publishableKey: "pk_test_1",
        webhookSecret: "whsec_1",
        ignored: "value",
      },
    },
    { fetchImpl, timeoutMs: 2500 },
  );

  assert.deepEqual(calls.stripeFactory, [
    {
      secretKey: "sk_test_1",
      publishableKey: "pk_test_1",
      fetchImpl,
      timeoutMs: 2500,
    },
  ]);
  assert.deepEqual(calls.zarinpalFactory, []);
  assert.equal(paymentProvider.provider, "stripe");
  assert.equal(paymentProvider.fakeMode, false);
  assert.equal(
    paymentProvider.createPayment,
    adapters.liveStripeAdapter.createPayment,
  );
  assert.equal(
    paymentProvider.getCheckout,
    adapters.liveStripeAdapter.getCheckout,
  );
  assert.equal(Object.hasOwn(paymentProvider, "simulatePayment"), false);
  assert.equal(Object.hasOwn(paymentProvider, "verifyPayment"), false);
  assert.equal(Object.hasOwn(paymentProvider, "internalMethod"), false);
  assert.equal(Object.isFrozen(paymentProvider), true);
  assert.deepEqual(Object.keys(paymentProvider), [
    "provider",
    "fakeMode",
    "createPayment",
    "getCheckout",
  ]);
});

test("live ZarinPal resolution exposes verification and forwards options", () => {
  const { adapters, calls, service } = loadProviderService();
  const fetchImpl = async () => {};
  const paymentProvider = service.createPaymentProvider(
    {
      provider: "zarinpal",
      fakeMode: false,
      credentials: {
        merchantId: "merchant-1",
        callbackUrl: "https://api.example/payments/callback",
        ignored: "value",
      },
    },
    { fetchImpl, timeoutMs: 4000 },
  );

  assert.deepEqual(calls.stripeFactory, []);
  assert.deepEqual(calls.zarinpalFactory, [
    {
      merchantId: "merchant-1",
      callbackUrl: "https://api.example/payments/callback",
      fetchImpl,
      timeoutMs: 4000,
    },
  ]);
  assert.equal(paymentProvider.provider, "zarinpal");
  assert.equal(paymentProvider.fakeMode, false);
  assert.equal(
    paymentProvider.createPayment,
    adapters.liveZarinpalAdapter.createPayment,
  );
  assert.equal(
    paymentProvider.getCheckout,
    adapters.liveZarinpalAdapter.getCheckout,
  );
  assert.equal(
    paymentProvider.verifyPayment,
    adapters.liveZarinpalAdapter.verifyPayment,
  );
  assert.equal(Object.hasOwn(paymentProvider, "simulatePayment"), false);
  assert.equal(Object.hasOwn(paymentProvider, "internalMethod"), false);
  assert.equal(Object.isFrozen(paymentProvider), true);
  assert.deepEqual(Object.keys(paymentProvider), [
    "provider",
    "fakeMode",
    "createPayment",
    "getCheckout",
    "verifyPayment",
  ]);
});

test("configured provider validation receives the selected environment", () => {
  const validatedConfig = {
    provider: "stripe",
    fakeMode: false,
    credentials: {
      secretKey: "sk_test_1",
      publishableKey: "pk_test_1",
    },
  };
  const { calls, service } = loadProviderService({ validatedConfig });
  const environment = {
    PAYMENT_PROVIDER: "stripe",
    PAYMENT_FAKE_MODE: "false",
  };
  const fetchImpl = async () => {};

  const paymentProvider = service.getConfiguredPaymentProvider(environment, {
    fetchImpl,
    timeoutMs: 5000,
  });

  assert.deepEqual(calls.environment, [environment]);
  assert.deepEqual(calls.stripeFactory, [
    {
      secretKey: "sk_test_1",
      publishableKey: "pk_test_1",
      fetchImpl,
      timeoutMs: 5000,
    },
  ]);
  assert.equal(paymentProvider.provider, "stripe");
  assert.equal(paymentProvider.fakeMode, false);
});

test("provider resolution rejects invalid configuration and options", () => {
  const { service } = loadProviderService();

  for (const config of [undefined, null, [], "stripe", true]) {
    assert.throws(
      () => service.createPaymentProvider(config),
      /paymentConfig must be an object/,
    );
  }

  for (const config of [
    {},
    { provider: "paypal", fakeMode: true },
    { provider: "STRIPE", fakeMode: true },
  ]) {
    assert.throws(
      () => service.createPaymentProvider(config),
      /paymentConfig\.provider must be "stripe" or "zarinpal"/,
    );
  }

  for (const fakeMode of [undefined, null, 0, "true"]) {
    assert.throws(
      () =>
        service.createPaymentProvider({ provider: "stripe", fakeMode }),
      /paymentConfig\.fakeMode must be a boolean/,
    );
  }

  for (const credentials of [undefined, null, [], "credentials"]) {
    assert.throws(
      () =>
        service.createPaymentProvider({
          provider: "stripe",
          fakeMode: false,
          credentials,
        }),
      /paymentConfig\.credentials must be an object in live mode/,
    );
  }

  const validConfig = { provider: "stripe", fakeMode: true };

  for (const options of [null, [], "options"]) {
    assert.throws(
      () => service.createPaymentProvider(validConfig, options),
      /options must be an object/,
    );
  }

  for (const fetchImpl of [null, {}, "fetch"]) {
    assert.throws(
      () => service.createPaymentProvider(validConfig, { fetchImpl }),
      /options\.fetchImpl must be a function/,
    );
  }

  for (const timeoutMs of [0, -1, 1.5, "1000", null]) {
    assert.throws(
      () => service.createPaymentProvider(validConfig, { timeoutMs }),
      /options\.timeoutMs must be a positive integer/,
    );
  }
});

test("provider resolution rejects invalid adapter contracts", () => {
  const fakeStripeConfig = { provider: "stripe", fakeMode: true };
  const invalidFakeAdapters = [
    null,
    [],
    createAdapter({ provider: "zarinpal", simulation: true }),
    {
      provider: "stripe",
      getCheckout: () => {},
      simulatePayment: () => {},
    },
    {
      provider: "stripe",
      createPayment: () => {},
      simulatePayment: () => {},
    },
  ];

  for (const fakeStripeAdapter of invalidFakeAdapters) {
    const { service } = loadProviderService({ fakeStripeAdapter });

    assert.throws(
      () => service.createPaymentProvider(fakeStripeConfig),
      /Invalid stripe payment provider contract/,
    );
  }

  const missingSimulation = createAdapter({ provider: "stripe" });
  const invalidFake = loadProviderService({
    fakeStripeAdapter: missingSimulation,
  });
  assert.throws(
    () => invalidFake.service.createPaymentProvider(fakeStripeConfig),
    /Fake stripe provider must implement simulatePayment/,
  );

  const missingVerification = createAdapter({ provider: "zarinpal" });
  const invalidLive = loadProviderService({
    liveZarinpalAdapter: missingVerification,
  });
  assert.throws(
    () =>
      invalidLive.service.createPaymentProvider({
        provider: "zarinpal",
        fakeMode: false,
        credentials: {},
      }),
    /Live ZarinPal provider must implement verifyPayment/,
  );
});
