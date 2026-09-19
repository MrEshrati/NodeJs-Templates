const test = require("node:test");
const assert = require("node:assert/strict");
const {
  createPaymentSimulationValidator,
  createPaymentValidator,
} = require("../../validators/payment.validator");

const PAYMENT_ID = "ABCDEF0123456789ABCDEF01";

test("payment creation validators normalize provider-specific input", () => {
  const stripeResult = createPaymentValidator("stripe")({
    amount: 1099,
    currency: "  usd  ",
    description: "  Test order  ",
    idempotency_key: "  stripe-order-1  ",
    ignored: "value",
  });
  const zarinpalResult = createPaymentValidator("zarinpal")({
    amount: 50000,
    currency: " irr ",
    description: "   ",
    idempotency_key: "zarinpal-order-1",
  });

  assert.deepEqual(stripeResult, {
    data: {
      amount: 1099,
      currency: "USD",
      description: "Test order",
      idempotencyKey: "stripe-order-1",
    },
    fields: {},
  });
  assert.deepEqual(zarinpalResult, {
    data: {
      amount: 50000,
      currency: "IRR",
      idempotencyKey: "zarinpal-order-1",
    },
    fields: {},
  });
});

test("payment creation validators treat unusable bodies as missing input", () => {
  const validate = createPaymentValidator("stripe");

  for (const body of [undefined, null, [], "body", 42]) {
    const result = validate(body);

    assert.deepEqual(result.data, {});
    assert.equal(result.fields.amount[0].code, "required");
    assert.equal(result.fields.currency[0].code, "required");
  }
});

test("payment creation validator enforces amount rules", () => {
  const validate = createPaymentValidator("stripe");

  for (const amount of [undefined, null]) {
    const result = validate({ amount, currency: "USD" });

    assert.equal(result.fields.amount[0].code, "required");
    assert.equal("amount" in result.data, false);
  }

  for (const amount of [1.5, "1099", Number.MAX_SAFE_INTEGER + 1]) {
    const result = validate({ amount, currency: "USD" });

    assert.equal(result.fields.amount[0].code, "invalid");
    assert.equal("amount" in result.data, false);
  }

  for (const amount of [0, -1]) {
    const result = validate({ amount, currency: "USD" });

    assert.equal(result.fields.amount[0].code, "min_value");
    assert.equal("amount" in result.data, false);
  }

  assert.equal(
    validate({ amount: Number.MAX_SAFE_INTEGER, currency: "USD" }).data
      .amount,
    Number.MAX_SAFE_INTEGER,
  );
});

test("payment creation validators enforce their configured currency", () => {
  const validateStripe = createPaymentValidator("stripe");
  const validateZarinpal = createPaymentValidator("zarinpal");

  for (const currency of [undefined, null, "   "]) {
    const result = validateStripe({ amount: 1, currency });

    assert.equal(result.fields.currency[0].code, "required");
    assert.equal("currency" in result.data, false);
  }

  for (const currency of [1, {}, []]) {
    const result = validateStripe({ amount: 1, currency });

    assert.equal(result.fields.currency[0].code, "invalid");
    assert.equal("currency" in result.data, false);
  }

  assert.equal(
    validateStripe({ amount: 1, currency: "IRR" }).fields.currency[0].code,
    "invalid_choice",
  );
  assert.equal(
    validateZarinpal({ amount: 1, currency: "USD" }).fields.currency[0].code,
    "invalid_choice",
  );
});

test("payment creation validator enforces description limits", () => {
  const validate = createPaymentValidator("stripe");

  for (const description of [null, 42, {}, []]) {
    const result = validate({
      amount: 1099,
      currency: "USD",
      description,
    });

    assert.equal(result.fields.description[0].code, "invalid");
    assert.equal("description" in result.data, false);
  }

  const tooLong = validate({
    amount: 1099,
    currency: "USD",
    description: ` ${"x".repeat(501)} `,
  });

  assert.equal(tooLong.fields.description[0].code, "max_length");
  assert.equal("description" in tooLong.data, false);
  assert.equal(
    validate({
      amount: 1099,
      currency: "USD",
      description: "x".repeat(500),
    }).data.description.length,
    500,
  );
});

test("payment creation validator enforces idempotency-key limits", () => {
  const validate = createPaymentValidator("stripe");

  const missing = validate({ amount: 1099, currency: "USD" });
  assert.equal(missing.fields.idempotency_key[0].code, "required");

  for (const idempotencyKey of [null, 42, {}, []]) {
    const result = validate({
      amount: 1099,
      currency: "USD",
      idempotency_key: idempotencyKey,
    });

    assert.equal(result.fields.idempotency_key[0].code, "invalid");
    assert.equal("idempotencyKey" in result.data, false);
  }

  const blank = validate({
    amount: 1099,
    currency: "USD",
    idempotency_key: "   ",
  });
  const tooLong = validate({
    amount: 1099,
    currency: "USD",
    idempotency_key: ` ${"x".repeat(256)} `,
  });

  assert.equal(blank.fields.idempotency_key[0].code, "blank");
  assert.equal(tooLong.fields.idempotency_key[0].code, "max_length");
  assert.equal("idempotencyKey" in blank.data, false);
  assert.equal("idempotencyKey" in tooLong.data, false);
  assert.equal(
    validate({
      amount: 1099,
      currency: "USD",
      idempotency_key: "contains spaces",
    }).fields.idempotency_key[0].code,
    "invalid",
  );
  assert.equal(
    validate({
      amount: 1099,
      currency: "USD",
      idempotency_key: "x".repeat(255),
    }).data.idempotencyKey.length,
    255,
  );
});

test("payment simulation validators normalize valid provider outcomes", () => {
  const validateStripe = createPaymentSimulationValidator("stripe");
  const validateZarinpal = createPaymentSimulationValidator("zarinpal");

  for (const outcome of ["succeeded", "failed", "refunded"]) {
    assert.deepEqual(
      validateStripe({
        payment_id: ` ${PAYMENT_ID} `,
        outcome: ` ${outcome} `,
        ignored: "value",
      }),
      {
        data: {
          paymentId: PAYMENT_ID.toLowerCase(),
          outcome,
        },
        fields: {},
      },
    );
  }

  for (const outcome of ["succeeded", "failed"]) {
    assert.equal(
      validateZarinpal({ payment_id: PAYMENT_ID, outcome }).data.outcome,
      outcome,
    );
  }
});

test("payment simulation validator rejects missing and malformed IDs", () => {
  const validate = createPaymentSimulationValidator("stripe");

  for (const paymentId of [undefined, null, "   "]) {
    const result = validate({ payment_id: paymentId, outcome: "succeeded" });

    assert.equal(result.fields.payment_id[0].code, "required");
    assert.equal("paymentId" in result.data, false);
  }

  for (const paymentId of [42, {}, [], "short", "z".repeat(24), "a".repeat(25)]) {
    const result = validate({ payment_id: paymentId, outcome: "succeeded" });

    assert.equal(result.fields.payment_id[0].code, "invalid");
    assert.equal("paymentId" in result.data, false);
  }
});

test("payment simulation validators enforce provider outcomes", () => {
  const validateStripe = createPaymentSimulationValidator("stripe");
  const validateZarinpal = createPaymentSimulationValidator("zarinpal");

  for (const outcome of [undefined, null, "   "]) {
    const result = validateStripe({ payment_id: PAYMENT_ID, outcome });

    assert.equal(result.fields.outcome[0].code, "required");
    assert.equal("outcome" in result.data, false);
  }

  for (const outcome of [42, {}, []]) {
    const result = validateStripe({ payment_id: PAYMENT_ID, outcome });

    assert.equal(result.fields.outcome[0].code, "invalid");
    assert.equal("outcome" in result.data, false);
  }

  const unsupportedStripe = validateStripe({
    payment_id: PAYMENT_ID,
    outcome: "paid",
  });
  const unsupportedZarinpal = validateZarinpal({
    payment_id: PAYMENT_ID,
    outcome: "refunded",
  });

  assert.equal(unsupportedStripe.fields.outcome[0].code, "invalid_choice");
  assert.equal(unsupportedZarinpal.fields.outcome[0].code, "invalid_choice");
  assert.equal("outcome" in unsupportedStripe.data, false);
  assert.equal("outcome" in unsupportedZarinpal.data, false);
});

test("payment validator factories reject unsupported providers", () => {
  for (const provider of [undefined, null, "paypal", "Stripe", 42]) {
    assert.throws(() => createPaymentValidator(provider), TypeError);
    assert.throws(
      () => createPaymentSimulationValidator(provider),
      TypeError,
    );
  }
});
