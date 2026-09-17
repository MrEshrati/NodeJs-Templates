const { randomBytes, randomInt } = require("node:crypto");

const START_PAY_URL = "https://payment.zarinpal.com/pg/StartPay";
const SUPPORTED_OUTCOMES = new Set(["succeeded", "failed"]);

const createAuthority = () =>
  `A${randomBytes(27).toString("base64url").slice(0, 35)}`;

const assertCreateInput = (input) => {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("input must be an object.");
  }

  if (!Number.isSafeInteger(input.amount) || input.amount < 1) {
    throw new TypeError("amount must be a positive safe integer.");
  }

  if (input.currency !== "IRR") {
    throw new TypeError("the fake ZarinPal provider only supports IRR.");
  }
};

const createPayment = async (input = {}) => {
  assertCreateInput(input);

  const externalId = createAuthority();
  const redirectUrl = `${START_PAY_URL}/${externalId}`;

  return {
    externalId,
    providerData: {
      redirect_url: redirectUrl,
    },
    checkout: {
      redirectUrl,
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

  if (payment.provider !== "zarinpal") {
    throw new TypeError("payment must use the ZarinPal provider.");
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
    throw new TypeError("unsupported fake ZarinPal payment outcome.");
  }
};

const createSuccessfulVerification = () => {
  const referenceId = randomInt(100_000_000, 1_000_000_000);

  return {
    referenceId,
    verification: {
      data: {
        code: 100,
        ref_id: referenceId,
        card_pan: "502229******5995",
      },
      errors: {},
    },
  };
};

const createFailedVerification = () => ({
  data: {},
  errors: {
    code: -51,
    message: "Payment failed.",
  },
});

const simulatePayment = async ({ payment, outcome } = {}) => {
  assertSimulationInput(payment, outcome);

  if (outcome === "failed") {
    return {
      status: "failed",
      refundedAmount: 0,
      providerData: {
        ...payment.providerData,
        simulated_outcome: outcome,
        verify: createFailedVerification(),
      },
    };
  }

  const { referenceId, verification } = createSuccessfulVerification();

  return {
    status: "succeeded",
    refundedAmount: 0,
    providerData: {
      ...payment.providerData,
      simulated_outcome: outcome,
      ref_id: referenceId,
      verify: verification,
    },
  };
};

module.exports = {
  createPayment,
  simulatePayment,
};
