const { randomBytes } = require("node:crypto");

const FAKE_PUBLISHABLE_KEY = "pk_test_fake_without_packages";
const SUPPORTED_OUTCOMES = new Set(["succeeded", "failed", "refunded"]);

const createIdentifier = (prefix) =>
  `${prefix}${randomBytes(18).toString("base64url")}`;

const assertCreateInput = (input) => {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("input must be an object.");
  }

  if (!Number.isSafeInteger(input.amount) || input.amount < 1) {
    throw new TypeError("amount must be a positive safe integer.");
  }

  if (input.currency !== "USD") {
    throw new TypeError("the fake Stripe provider only supports USD.");
  }
};

const createPayment = async (input = {}) => {
  assertCreateInput(input);

  const externalId = createIdentifier("pi_fake_");
  const clientSecret = `${externalId}_secret_${randomBytes(18).toString(
    "base64url",
  )}`;

  return {
    externalId,
    providerData: {
      client_secret: clientSecret,
      payment_intent_status: "requires_payment_method",
    },
    checkout: {
      clientSecret,
      publishableKey: FAKE_PUBLISHABLE_KEY,
    },
  };
};

const assertSimulationInput = (payment, outcome) => {
  if (
    payment === null ||
    typeof payment !== "object" ||
    Array.isArray(payment)
  ) {
    throw new TypeError("payment must be an object.");
  }

  if (payment.provider !== "stripe") {
    throw new TypeError("payment must use the Stripe provider.");
  }

  if (!Number.isSafeInteger(payment.amount) || payment.amount < 1) {
    throw new TypeError("payment amount must be a positive safe integer.");
  }

  if (
    payment.providerData === null ||
    typeof payment.providerData !== "object" ||
    Array.isArray(payment.providerData)
  ) {
    throw new TypeError("payment provider data must be an object.");
  }

  if (!SUPPORTED_OUTCOMES.has(outcome)) {
    throw new TypeError("unsupported fake Stripe payment outcome.");
  }
};

const addSuccessfulPaymentData = (providerData) => ({
  ...providerData,
  payment_intent_status: "succeeded",
  charge_id: providerData.charge_id ?? createIdentifier("ch_fake_"),
  payment_method:
    providerData.payment_method ?? createIdentifier("pm_fake_"),
});

const simulatePayment = async ({ payment, outcome } = {}) => {
  assertSimulationInput(payment, outcome);

  if (outcome === "failed") {
    return {
      status: "failed",
      refundedAmount: 0,
      providerData: {
        ...payment.providerData,
        payment_intent_status: "requires_payment_method",
        simulated_outcome: outcome,
      },
    };
  }

  const providerData = {
    ...addSuccessfulPaymentData(payment.providerData),
    simulated_outcome: outcome,
  };

  return {
    status: outcome,
    refundedAmount: outcome === "refunded" ? payment.amount : 0,
    providerData,
  };
};

module.exports = {
  createPayment,
  simulatePayment,
};
