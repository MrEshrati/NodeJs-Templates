const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject } = require("../helpers/module");

const fakeStripeProvider = require(
  fromProject(
    "services",
    "paymentProviders",
    "fakeStripe.provider.js",
  ),
);
const fakeZarinpalProvider = require(
  fromProject(
    "services",
    "paymentProviders",
    "fakeZarinpal.provider.js",
  ),
);

const createStripePayment = (overrides = {}) => ({
  provider: "stripe",
  amount: 1099,
  currency: "USD",
  providerData: {
    client_secret: "pi_fake_existing_secret_existing",
    payment_intent_status: "requires_payment_method",
    existing: "preserved",
  },
  ...overrides,
});

const ZARINPAL_AUTHORITY = "A12345678901234567890123456789012345";
const ZARINPAL_REDIRECT_URL =
  `https://payment.zarinpal.com/pg/StartPay/${ZARINPAL_AUTHORITY}`;

const createZarinpalPayment = (overrides = {}) => ({
  provider: "zarinpal",
  externalId: ZARINPAL_AUTHORITY,
  amount: 50000,
  currency: "IRR",
  providerData: {
    redirect_url: ZARINPAL_REDIRECT_URL,
    existing: "preserved",
  },
  ...overrides,
});

test("fake Stripe creates safe checkout data", async () => {
  const result = await fakeStripeProvider.createPayment({
    amount: 1099,
    currency: "USD",
    description: "Test order",
    idempotencyKey: "order-1",
  });

  assert.equal(fakeStripeProvider.provider, "stripe");
  assert.match(result.externalId, /^pi_fake_[A-Za-z0-9_-]{24}$/);
  assert.equal(
    result.providerData.payment_intent_status,
    "requires_payment_method",
  );
  assert.equal(
    result.providerData.client_secret.startsWith(
      `${result.externalId}_secret_`,
    ),
    true,
  );
  assert.match(result.providerData.client_secret, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(result.checkout, {
    clientSecret: result.providerData.client_secret,
    publishableKey: "pk_test_fake_without_packages",
  });
  assert.equal(Object.hasOwn(result.providerData, "secretKey"), false);
});

test("fake ZarinPal creates a valid authority and redirect", async () => {
  const result = await fakeZarinpalProvider.createPayment({
    amount: 50000,
    currency: "IRR",
    description: "Test order",
  });
  const expectedRedirectUrl =
    `https://payment.zarinpal.com/pg/StartPay/${result.externalId}`;

  assert.equal(fakeZarinpalProvider.provider, "zarinpal");
  assert.match(result.externalId, /^[A-Za-z0-9_-]{36}$/);
  assert.equal(result.externalId.startsWith("A"), true);
  assert.deepEqual(result.providerData, {
    redirect_url: expectedRedirectUrl,
  });
  assert.deepEqual(result.checkout, {
    redirectUrl: expectedRedirectUrl,
  });
});

test("fake providers reject invalid creation input", async () => {
  for (const provider of [fakeStripeProvider, fakeZarinpalProvider]) {
    for (const input of [null, [], "payment"]) {
      await assert.rejects(
        provider.createPayment(input),
        /input must be an object/,
      );
    }

    for (const amount of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(
        provider.createPayment({
          amount,
          currency: provider.provider === "stripe" ? "USD" : "IRR",
        }),
        /amount must be a positive safe integer/,
      );
    }
  }

  for (const currency of [undefined, "IRR", "usd"]) {
    await assert.rejects(
      fakeStripeProvider.createPayment({ amount: 1099, currency }),
      /fake Stripe provider only supports USD/,
    );
  }

  for (const currency of [undefined, "USD", "irr"]) {
    await assert.rejects(
      fakeZarinpalProvider.createPayment({ amount: 50000, currency }),
      /fake ZarinPal provider only supports IRR/,
    );
  }
});

test("fake Stripe rebuilds checkout and rejects malformed payments", () => {
  const payment = createStripePayment();

  assert.deepEqual(fakeStripeProvider.getCheckout(payment), {
    clientSecret: "pi_fake_existing_secret_existing",
    publishableKey: "pk_test_fake_without_packages",
  });

  const invalidPayments = [
    null,
    [],
    {},
    createStripePayment({ provider: "zarinpal" }),
    createStripePayment({ providerData: null }),
    createStripePayment({ providerData: [] }),
    createStripePayment({ providerData: {} }),
    createStripePayment({ providerData: { client_secret: "" } }),
  ];

  for (const invalidPayment of invalidPayments) {
    assert.throws(
      () => fakeStripeProvider.getCheckout(invalidPayment),
      /payment must contain fake Stripe checkout data/,
    );
  }
});

test("fake ZarinPal rebuilds checkout and rejects malformed payments", () => {
  const payment = createZarinpalPayment();

  assert.deepEqual(fakeZarinpalProvider.getCheckout(payment), {
    redirectUrl: ZARINPAL_REDIRECT_URL,
  });

  const invalidPayments = [
    null,
    [],
    {},
    createZarinpalPayment({ provider: "stripe" }),
    createZarinpalPayment({ externalId: "short" }),
    createZarinpalPayment({ providerData: null }),
    createZarinpalPayment({ providerData: [] }),
    createZarinpalPayment({ providerData: {} }),
    createZarinpalPayment({
      providerData: { redirect_url: "https://example.com/wrong" },
    }),
  ];

  for (const invalidPayment of invalidPayments) {
    assert.throws(
      () => fakeZarinpalProvider.getCheckout(invalidPayment),
      /payment must contain fake ZarinPal checkout data/,
    );
  }
});

test("fake Stripe supports success, failure, and full refund outcomes", async () => {
  const outcomes = [
    { outcome: "succeeded", refundedAmount: 0 },
    { outcome: "failed", refundedAmount: 0 },
    { outcome: "refunded", refundedAmount: 1099 },
  ];

  for (const current of outcomes) {
    const payment = createStripePayment();
    const originalProviderData = { ...payment.providerData };
    const result = await fakeStripeProvider.simulatePayment({
      payment,
      outcome: current.outcome,
    });

    assert.equal(result.status, current.outcome);
    assert.equal(result.refundedAmount, current.refundedAmount);
    assert.equal(result.providerData.existing, "preserved");
    assert.equal(result.providerData.simulated_outcome, current.outcome);

    if (current.outcome === "failed") {
      assert.equal(
        result.providerData.payment_intent_status,
        "requires_payment_method",
      );
      assert.equal(Object.hasOwn(result.providerData, "charge_id"), false);
      assert.equal(
        Object.hasOwn(result.providerData, "payment_method"),
        false,
      );
    } else {
      assert.equal(result.providerData.payment_intent_status, "succeeded");
      assert.match(result.providerData.charge_id, /^ch_fake_/);
      assert.match(result.providerData.payment_method, /^pm_fake_/);
    }

    assert.deepEqual(payment.providerData, originalProviderData);
    assert.notEqual(result.providerData, payment.providerData);
  }
});

test("fake Stripe preserves existing successful payment identifiers", async () => {
  const payment = createStripePayment({
    providerData: {
      client_secret: "secret-1",
      charge_id: "ch_existing",
      payment_method: "pm_existing",
    },
  });
  const result = await fakeStripeProvider.simulatePayment({
    payment,
    outcome: "refunded",
  });

  assert.equal(result.providerData.charge_id, "ch_existing");
  assert.equal(result.providerData.payment_method, "pm_existing");
  assert.equal(result.refundedAmount, 1099);
});

test("fake ZarinPal supports success and failure outcomes safely", async () => {
  const succeededPayment = createZarinpalPayment();
  const originalProviderData = { ...succeededPayment.providerData };
  const succeeded = await fakeZarinpalProvider.simulatePayment({
    payment: succeededPayment,
    outcome: "succeeded",
  });

  assert.equal(succeeded.status, "succeeded");
  assert.equal(succeeded.refundedAmount, 0);
  assert.equal(succeeded.providerData.existing, "preserved");
  assert.equal(succeeded.providerData.simulated_outcome, "succeeded");
  assert.equal(Number.isSafeInteger(succeeded.providerData.ref_id), true);
  assert.equal(succeeded.providerData.verify.data.code, 100);
  assert.equal(
    succeeded.providerData.verify.data.ref_id,
    succeeded.providerData.ref_id,
  );
  assert.match(
    succeeded.providerData.verify.data.card_pan,
    /^[0-9]+\*+[0-9]+$/,
  );
  assert.deepEqual(succeeded.providerData.verify.errors, {});
  assert.deepEqual(succeededPayment.providerData, originalProviderData);

  const failedPayment = createZarinpalPayment();
  const failed = await fakeZarinpalProvider.simulatePayment({
    payment: failedPayment,
    outcome: "failed",
  });

  assert.equal(failed.status, "failed");
  assert.equal(failed.refundedAmount, 0);
  assert.equal(failed.providerData.existing, "preserved");
  assert.equal(failed.providerData.simulated_outcome, "failed");
  assert.deepEqual(failed.providerData.verify.data, {});
  assert.equal(failed.providerData.verify.errors.code, -51);
  assert.equal(
    Object.hasOwn(failed.providerData.verify.errors, "message"),
    true,
  );
});

test("fake providers reject malformed simulation input", async () => {
  const stripeInvalidPayments = [
    null,
    [],
    createStripePayment({ provider: "zarinpal" }),
    createStripePayment({ amount: 0 }),
    createStripePayment({ amount: 1.5 }),
    createStripePayment({ providerData: null }),
    createStripePayment({ providerData: [] }),
  ];

  for (const payment of stripeInvalidPayments) {
    await assert.rejects(
      fakeStripeProvider.simulatePayment({
        payment,
        outcome: "succeeded",
      }),
      /payment|amount|provider data/,
    );
  }

  await assert.rejects(
    fakeStripeProvider.simulatePayment({
      payment: createStripePayment(),
      outcome: "cancelled",
    }),
    /unsupported fake Stripe payment outcome/,
  );

  const zarinpalInvalidPayments = [
    null,
    [],
    createZarinpalPayment({ provider: "stripe" }),
    createZarinpalPayment({ amount: 0 }),
    createZarinpalPayment({ amount: 1.5 }),
    createZarinpalPayment({ providerData: null }),
    createZarinpalPayment({ providerData: [] }),
  ];

  for (const payment of zarinpalInvalidPayments) {
    await assert.rejects(
      fakeZarinpalProvider.simulatePayment({
        payment,
        outcome: "succeeded",
      }),
      /payment|amount|provider data/,
    );
  }

  for (const outcome of ["refunded", "cancelled", undefined]) {
    await assert.rejects(
      fakeZarinpalProvider.simulatePayment({
        payment: createZarinpalPayment(),
        outcome,
      }),
      /unsupported fake ZarinPal payment outcome/,
    );
  }
});
