const Payment = require("../models/payment.model");
const {
  getConfiguredPaymentProvider,
} = require("./paymentProvider.service");

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const SIMULATION_OUTCOMES = Object.freeze({
  stripe: new Set(["succeeded", "failed", "refunded"]),
  zarinpal: new Set(["succeeded", "failed"]),
});

const PAYMENT_STATUSES = new Set([
  "pending",
  "succeeded",
  "failed",
  "refunded",
]);

const assertPaymentProvider = (paymentProvider) => {
  if (
    !isObject(paymentProvider) ||
    (paymentProvider.provider !== "stripe" &&
      paymentProvider.provider !== "zarinpal") ||
    typeof paymentProvider.createPayment !== "function" ||
    typeof paymentProvider.getCheckout !== "function"
  ) {
    throw new TypeError("paymentProvider must implement the payment contract.");
  }
};

const assertProviderResult = (providerResult) => {
  if (
    !isObject(providerResult) ||
    typeof providerResult.externalId !== "string" ||
    providerResult.externalId.trim() === "" ||
    providerResult.externalId.length > 255 ||
    !isObject(providerResult.providerData)
  ) {
    throw new Error("Unexpected payment provider result.");
  }
};

const findIdempotentPayment = ({ userId, idempotencyKey }) =>
  Payment.findOne({
    user: userId,
    idempotencyKey,
  }).lean();

const findOwnedPayment = ({ userId, paymentId, provider }) =>
  Payment.findOne({
    _id: paymentId,
    user: userId,
    provider,
  }).lean();

const buildPaymentResult = ({ status, payment, paymentProvider }) => {
  if (payment.provider !== paymentProvider.provider) {
    throw new Error(
      "Existing payment does not match the configured provider.",
    );
  }

  return {
    status,
    payment,
    checkout: paymentProvider.getCheckout(payment),
  };
};

const assertSimulationOutcome = (provider, outcome) => {
  if (!SIMULATION_OUTCOMES[provider].has(outcome)) {
    throw new TypeError(`unsupported ${provider} simulation outcome.`);
  }
};

const assertStoredPayment = (payment) => {
  if (
    !isObject(payment) ||
    !PAYMENT_STATUSES.has(payment.status) ||
    !Number.isSafeInteger(payment.amount) ||
    payment.amount < 1
  ) {
    throw new Error("Unexpected stored payment data.");
  }
};

const assertSimulationResult = ({
  simulationResult,
  payment,
  outcome,
  provider,
}) => {
  if (
    !isObject(simulationResult) ||
    simulationResult.status !== outcome ||
    !Number.isSafeInteger(simulationResult.refundedAmount) ||
    simulationResult.refundedAmount < 0 ||
    simulationResult.refundedAmount > payment.amount ||
    !isObject(simulationResult.providerData)
  ) {
    throw new Error("Unexpected payment simulation result.");
  }

  if (
    (outcome === "refunded" &&
      (provider !== "stripe" ||
        simulationResult.refundedAmount !== payment.amount)) ||
    (outcome !== "refunded" && simulationResult.refundedAmount !== 0)
  ) {
    throw new Error("Unexpected payment simulation result.");
  }
};

const canApplySimulation = ({ payment, outcome, provider }) =>
  payment.status === "pending" ||
  (provider === "stripe" &&
    payment.status === "succeeded" &&
    outcome === "refunded");

const createPayment = async (
  {
    userId,
    amount,
    currency,
    description,
    idempotencyKey,
  } = {},
  { paymentProvider = getConfiguredPaymentProvider() } = {},
) => {
  assertPaymentProvider(paymentProvider);

  await Payment.init();

  if (idempotencyKey !== undefined) {
    const existingPayment = await findIdempotentPayment({
      userId,
      idempotencyKey,
    });

    if (existingPayment) {
      return buildPaymentResult({
        status: "existing",
        payment: existingPayment,
        paymentProvider,
      });
    }
  }

  const providerResult = await paymentProvider.createPayment({
    amount,
    currency,
    description,
    idempotencyKey,
  });

  assertProviderResult(providerResult);

  const paymentData = {
    user: userId,
    provider: paymentProvider.provider,
    externalId: providerResult.externalId,
    amount,
    currency,
    providerData: providerResult.providerData,
  };

  if (description !== undefined) {
    paymentData.description = description;
  }

  if (idempotencyKey !== undefined) {
    paymentData.idempotencyKey = idempotencyKey;
  }

  let paymentDocument;

  try {
    paymentDocument = await Payment.create(paymentData);
  } catch (error) {
    if (error?.code !== 11000 || idempotencyKey === undefined) {
      throw error;
    }

    const existingPayment = await findIdempotentPayment({
      userId,
      idempotencyKey,
    });

    if (!existingPayment) {
      throw error;
    }

    return buildPaymentResult({
      status: "existing",
      payment: existingPayment,
      paymentProvider,
    });
  }

  if (!paymentDocument || typeof paymentDocument.toObject !== "function") {
    throw new Error("Unexpected payment creation result.");
  }

  const payment = paymentDocument.toObject();

  return buildPaymentResult({
    status: "created",
    payment,
    paymentProvider,
  });
};

const simulatePaymentConfirmation = async (
  { userId, paymentId, outcome } = {},
  { paymentProvider = getConfiguredPaymentProvider() } = {},
) => {
  assertPaymentProvider(paymentProvider);

  if (
    paymentProvider.fakeMode !== true ||
    typeof paymentProvider.simulatePayment !== "function"
  ) {
    return { status: "unavailable" };
  }

  assertSimulationOutcome(paymentProvider.provider, outcome);

  const payment = await findOwnedPayment({
    userId,
    paymentId,
    provider: paymentProvider.provider,
  });

  if (!payment) {
    return { status: "not_found" };
  }

  assertStoredPayment(payment);

  if (
    payment.status === outcome ||
    !canApplySimulation({
      payment,
      outcome,
      provider: paymentProvider.provider,
    })
  ) {
    return {
      status: "unchanged",
      payment,
    };
  }

  const simulationResult = await paymentProvider.simulatePayment({
    payment,
    outcome,
  });

  assertSimulationResult({
    simulationResult,
    payment,
    outcome,
    provider: paymentProvider.provider,
  });

  const updatedPayment = await Payment.findOneAndUpdate(
    {
      _id: paymentId,
      user: userId,
      provider: paymentProvider.provider,
      status: payment.status,
    },
    {
      $set: {
        status: simulationResult.status,
        refundedAmount: simulationResult.refundedAmount,
        providerData: simulationResult.providerData,
      },
    },
    {
      returnDocument: "after",
      runValidators: true,
    },
  ).lean();

  if (updatedPayment) {
    return {
      status: "updated",
      payment: updatedPayment,
    };
  }

  const currentPayment = await findOwnedPayment({
    userId,
    paymentId,
    provider: paymentProvider.provider,
  });

  if (!currentPayment) {
    return { status: "not_found" };
  }

  assertStoredPayment(currentPayment);

  return {
    status: "unchanged",
    payment: currentPayment,
  };
};

module.exports = {
  createPayment,
  simulatePaymentConfirmation,
};
