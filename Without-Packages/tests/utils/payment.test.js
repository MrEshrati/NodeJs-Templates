const test = require("node:test");
const assert = require("node:assert/strict");
const {
  formatPaymentAmount,
  serializePayment,
} = require("../../utils/payment.utils");

const OBJECT_ID = "abcdef0123456789abcdef01";
const CREATED_AT = new Date("2026-08-01T12:00:00.000Z");
const UPDATED_AT = new Date("2026-08-01T12:05:00.000Z");

const createPayment = (overrides = {}) => ({
  _id: OBJECT_ID,
  user: "hidden-user",
  provider: "stripe",
  externalId: "pi_test_123",
  amount: 1099,
  currency: "USD",
  description: "Hidden internal description",
  status: "succeeded",
  refundedAmount: 0,
  providerData: {
    client_secret: "pi_test_123_secret_test",
    payment_intent_status: "succeeded",
  },
  idempotencyKey: "hidden-idempotency-key",
  createdAt: CREATED_AT,
  updatedAt: UPDATED_AT,
  ...overrides,
});

test("payment amount formatter keeps IRR as a whole-number string", () => {
  assert.equal(formatPaymentAmount(0, "IRR"), "0");
  assert.equal(formatPaymentAmount(50000, "IRR"), "50000");
  assert.equal(
    formatPaymentAmount(Number.MAX_SAFE_INTEGER, "IRR"),
    "9007199254740991",
  );
});

test("payment amount formatter converts USD cents without losing precision", () => {
  assert.equal(formatPaymentAmount(0, "USD"), "0.00");
  assert.equal(formatPaymentAmount(1, "USD"), "0.01");
  assert.equal(formatPaymentAmount(1099, "USD"), "10.99");
  assert.equal(
    formatPaymentAmount(Number.MAX_SAFE_INTEGER, "USD"),
    "90071992547409.91",
  );
});

test("payment amount formatter rejects invalid values and currencies", () => {
  for (const amount of [
    -1,
    1.5,
    Number.MAX_SAFE_INTEGER + 1,
    NaN,
    Infinity,
    "1099",
    null,
  ]) {
    assert.throws(() => formatPaymentAmount(amount, "USD"), TypeError);
  }

  for (const currency of ["EUR", "usd", "", null, undefined]) {
    assert.throws(() => formatPaymentAmount(1099, currency), TypeError);
  }
});

test("payment serializer returns the complete public Stripe shape", () => {
  const payment = createPayment();
  const serialized = serializePayment(payment);

  assert.deepEqual(serialized, {
    id: OBJECT_ID,
    provider: "stripe",
    external_id: "pi_test_123",
    amount: 1099,
    amount_display: "10.99",
    currency: "USD",
    status: "succeeded",
    refunded_amount: 0,
    provider_data: payment.providerData,
    created_at: CREATED_AT.toISOString(),
    updated_at: UPDATED_AT.toISOString(),
  });

  assert.equal("user" in serialized, false);
  assert.equal("idempotencyKey" in serialized, false);
  assert.equal("idempotency_key" in serialized, false);
  assert.equal("description" in serialized, false);
});

test("payment serializer formats an IRR payment", () => {
  const serialized = serializePayment(
    createPayment({
      provider: "zarinpal",
      externalId: "A".repeat(36),
      amount: 50000,
      currency: "IRR",
      status: "pending",
      providerData: {
        redirect_url: `https://payment.zarinpal.com/pg/StartPay/${"A".repeat(36)}`,
      },
    }),
  );

  assert.equal(serialized.provider, "zarinpal");
  assert.equal(serialized.amount_display, "50000");
  assert.equal(serialized.currency, "IRR");
  assert.equal(serialized.status, "pending");
});

test("payment serializer rejects malformed amount and currency data", () => {
  assert.throws(
    () => serializePayment(createPayment({ amount: -1 })),
    TypeError,
  );
  assert.throws(
    () => serializePayment(createPayment({ amount: 10.5 })),
    TypeError,
  );
  assert.throws(
    () => serializePayment(createPayment({ currency: "EUR" })),
    TypeError,
  );
});

test("payment serializer rejects malformed timestamps", () => {
  assert.throws(
    () => serializePayment(createPayment({ createdAt: "not-a-date" })),
    TypeError,
  );
  assert.throws(
    () => serializePayment(createPayment({ updatedAt: null })),
    TypeError,
  );
  assert.throws(
    () =>
      serializePayment(
        createPayment({ createdAt: new Date("invalid") }),
      ),
    RangeError,
  );
});
