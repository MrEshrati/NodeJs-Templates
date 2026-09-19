const test = require("node:test");
const assert = require("node:assert/strict");
const { isDeepStrictEqual } = require("node:util");
const mongoose = require("mongoose");
const PaymentCreation = require("../../models/paymentCreation.model");

const objectId = () => new mongoose.Types.ObjectId();

const createClaim = (overrides = {}) =>
  new PaymentCreation({
    user: objectId(),
    idempotencyKey: "order-1",
    requestFingerprint: "a".repeat(64),
    provider: "stripe",
    providerRequestKey: `payment_v1_${"b".repeat(64)}`,
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
  PaymentCreation.schema
    .indexes()
    .find(([keys]) => isDeepStrictEqual(keys, expectedKeys));

test("payment-creation claims apply safe processing defaults", async () => {
  const claim = createClaim({ idempotencyKey: "  order-1  " });

  assert.equal(claim.idempotencyKey, "order-1");
  assert.equal(claim.status, "processing");
  assert.equal(claim.payment, null);
  assert.equal(claim.failureKind, null);
  assert.equal(claim.failureMessage, null);
  await assert.doesNotReject(claim.validate());
});

test("payment-creation claims require immutable request identity", async () => {
  const error = await getValidationError(
    createClaim({
      user: undefined,
      idempotencyKey: undefined,
      requestFingerprint: undefined,
      provider: undefined,
      providerRequestKey: undefined,
    }),
  );

  for (const name of [
    "user",
    "idempotencyKey",
    "requestFingerprint",
    "provider",
    "providerRequestKey",
  ]) {
    assert.ok(error.errors[name]);
    assert.equal(PaymentCreation.schema.path(name).options.immutable, true);
  }
});

test("payment-creation claims validate states, fingerprints, and keys", async () => {
  for (const status of ["processing", "succeeded", "failed"]) {
    await assert.doesNotReject(createClaim({ status }).validate());
  }

  for (const overrides of [
    { status: "unknown" },
    { provider: "paypal" },
    { idempotencyKey: "contains spaces" },
    { idempotencyKey: "x".repeat(256) },
    { requestFingerprint: "not-a-sha256" },
    { providerRequestKey: "raw-client-key" },
    { failureKind: "unknown" },
    { failureMessage: "x".repeat(256) },
  ]) {
    assert.ok(await getValidationError(createClaim(overrides)));
  }
});

test("payment-creation claims declare uniqueness and recovery indexes", () => {
  const uniqueIndex = findIndex({ user: 1, idempotencyKey: 1 });
  const recoveryIndex = findIndex({ status: 1, updatedAt: 1 });

  assert.equal(uniqueIndex[1].name, "payment_creation_user_key_uq");
  assert.equal(uniqueIndex[1].unique, true);
  assert.equal(
    recoveryIndex[1].name,
    "payment_creation_status_updated_idx",
  );
});
