const test = require("node:test");
const assert = require("node:assert/strict");
const { isDeepStrictEqual } = require("node:util");
const mongoose = require("mongoose");
const Payment = require("../../models/payment.model");

const objectId = () => new mongoose.Types.ObjectId();

const createPayment = (overrides = {}) =>
  new Payment({
    user: objectId(),
    provider: "stripe",
    externalId: "pi_test_123",
    amount: 1099,
    currency: "USD",
    ...overrides,
  });

const getValidationError = async (document) => {
  try {
    await document.validate();
    return null;
  } catch (error) {
    return error;
  }
};

const findIndex = (expectedKeys) =>
  Payment.schema
    .indexes()
    .find(([keys]) => isDeepStrictEqual(keys, expectedKeys));

test("payment schema applies safe defaults and trims text fields", async () => {
  const payment = createPayment({
    externalId: "  pi_test_123  ",
    description: "  Test order  ",
    idempotencyKey: "  order-1  ",
  });
  const anotherPayment = createPayment({ externalId: "pi_test_456" });

  assert.equal(payment.externalId, "pi_test_123");
  assert.equal(payment.description, "Test order");
  assert.equal(payment.idempotencyKey, "order-1");
  assert.equal(payment.status, "pending");
  assert.equal(payment.refundedAmount, 0);
  assert.deepEqual(payment.providerData, {});
  assert.notEqual(payment.providerData, anotherPayment.providerData);
  await assert.doesNotReject(payment.validate());
});

test("payment schema requires its core identity and value fields", async () => {
  const error = await getValidationError(
    createPayment({
      user: undefined,
      provider: undefined,
      externalId: undefined,
      amount: undefined,
      currency: undefined,
    }),
  );

  assert.ok(error.errors.user);
  assert.ok(error.errors.provider);
  assert.ok(error.errors.externalId);
  assert.ok(error.errors.amount);
  assert.ok(error.errors.currency);
});

test("payment schema accepts only supported providers, currencies, and statuses", async () => {
  for (const provider of ["stripe", "zarinpal"]) {
    await assert.doesNotReject(createPayment({ provider }).validate());
  }

  for (const currency of ["USD", "IRR"]) {
    await assert.doesNotReject(createPayment({ currency }).validate());
  }

  for (const status of ["pending", "succeeded", "failed", "refunded"]) {
    await assert.doesNotReject(createPayment({ status }).validate());
  }

  const invalidProvider = await getValidationError(
    createPayment({ provider: "paypal" }),
  );
  const invalidCurrency = await getValidationError(
    createPayment({ currency: "EUR" }),
  );
  const invalidStatus = await getValidationError(
    createPayment({ status: "cancelled" }),
  );

  assert.ok(invalidProvider.errors.provider);
  assert.ok(invalidCurrency.errors.currency);
  assert.ok(invalidStatus.errors.status);
});

test("payment schema requires safe integer amounts", async () => {
  for (const amount of [0, -1, 10.5, Number.MAX_SAFE_INTEGER + 1]) {
    const error = await getValidationError(createPayment({ amount }));

    assert.ok(error.errors.amount);
  }

  await assert.doesNotReject(createPayment({ amount: 1 }).validate());
  await assert.doesNotReject(
    createPayment({ amount: Number.MAX_SAFE_INTEGER }).validate(),
  );
});

test("payment schema requires a non-negative safe refunded amount", async () => {
  for (const refundedAmount of [
    -1,
    0.5,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    const error = await getValidationError(
      createPayment({ refundedAmount }),
    );

    assert.ok(error.errors.refundedAmount);
  }

  await assert.doesNotReject(
    createPayment({ refundedAmount: 0 }).validate(),
  );
  await assert.doesNotReject(
    createPayment({ refundedAmount: Number.MAX_SAFE_INTEGER }).validate(),
  );
});

test("payment schema accepts only object provider data", async () => {
  await assert.doesNotReject(
    createPayment({ providerData: { client_secret: "secret" } }).validate(),
  );

  for (const providerData of [null, [], "provider-data", 123]) {
    const error = await getValidationError(
      createPayment({ providerData }),
    );

    assert.ok(error.errors.providerData);
  }
});

test("payment schema enforces text length and idempotency limits", async () => {
  const externalIdError = await getValidationError(
    createPayment({ externalId: "x".repeat(256) }),
  );
  const descriptionError = await getValidationError(
    createPayment({ description: "x".repeat(501) }),
  );
  const idempotencyLengthError = await getValidationError(
    createPayment({ idempotencyKey: "x".repeat(256) }),
  );
  const blankIdempotencyError = await getValidationError(
    createPayment({ idempotencyKey: "   " }),
  );
  const invalidIdempotencyError = await getValidationError(
    createPayment({ idempotencyKey: "contains spaces" }),
  );

  assert.ok(externalIdError.errors.externalId);
  assert.ok(descriptionError.errors.description);
  assert.ok(idempotencyLengthError.errors.idempotencyKey);
  assert.ok(blankIdempotencyError.errors.idempotencyKey);
  assert.ok(invalidIdempotencyError.errors.idempotencyKey);

  await assert.doesNotReject(
    createPayment({
      externalId: "x".repeat(255),
      description: "x".repeat(500),
      idempotencyKey: "x".repeat(255),
    }).validate(),
  );
});

test("payment schema keeps transaction identity fields immutable", () => {
  for (const pathName of [
    "user",
    "provider",
    "externalId",
    "amount",
    "currency",
    "idempotencyKey",
  ]) {
    assert.equal(Payment.schema.path(pathName).options.immutable, true);
  }
});

test("payment schema declares provider, idempotency, and feed indexes", () => {
  const providerIndex = findIndex({ provider: 1, externalId: 1 });
  const idempotencyIndex = findIndex({ user: 1, idempotencyKey: 1 });
  const feedIndex = findIndex({ user: 1, createdAt: -1, _id: -1 });

  assert.equal(providerIndex[1].name, "payment_provider_external_id_uq");
  assert.equal(providerIndex[1].unique, true);
  assert.equal(
    idempotencyIndex[1].name,
    "payment_user_idempotency_key_uq",
  );
  assert.equal(idempotencyIndex[1].unique, true);
  assert.deepEqual(idempotencyIndex[1].partialFilterExpression, {
    idempotencyKey: { $type: "string" },
  });
  assert.equal(feedIndex[1].name, "payment_user_created_idx");
});
