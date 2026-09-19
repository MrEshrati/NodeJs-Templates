const crypto = require("node:crypto");
const PaymentProviderError = require("../errors/PaymentProviderError");
const Payment = require("../models/payment.model");
const PaymentCreation = require("../models/paymentCreation.model");
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

const PAYMENT_CREATION_STATUSES = new Set([
  "processing",
  "succeeded",
  "failed",
]);
const MINIMUM_SECRET_BYTES = 32;
const PAYMENT_ROUTE = "/create-payment";

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

const assertIdempotencyInput = ({ userId, idempotencyKey }) => {
  if (
    userId === undefined ||
    userId === null ||
    String(userId).trim() === ""
  ) {
    throw new TypeError("userId must be a non-empty value.");
  }

  if (
    typeof idempotencyKey !== "string" ||
    idempotencyKey.trim() === ""
  ) {
    throw new TypeError("idempotencyKey must be a non-empty string.");
  }
};

const getIdempotencySecret = (idempotencySecret) => {
  if (
    typeof idempotencySecret !== "string" ||
    Buffer.byteLength(idempotencySecret, "utf8") < MINIMUM_SECRET_BYTES
  ) {
    throw new Error(
      "PAYMENT_IDEMPOTENCY_SECRET must contain at least 32 bytes.",
    );
  }

  return idempotencySecret;
};

const createRequestFingerprint = ({
  provider,
  amount,
  currency,
  description,
}) => {
  const canonicalRequest = JSON.stringify({
    version: 1,
    method: "POST",
    route: PAYMENT_ROUTE,
    provider,
    amount,
    currency,
    description: description ?? null,
  });

  return crypto
    .createHash("sha256")
    .update("payment-request-fingerprint:v1\0", "utf8")
    .update(canonicalRequest, "utf8")
    .digest("hex");
};

const createProviderRequestKey = ({
  userId,
  idempotencyKey,
  idempotencySecret,
}) => {
  const digest = crypto
    .createHmac("sha256", getIdempotencySecret(idempotencySecret))
    .update("payment-provider-idempotency:v1\0", "utf8")
    .update(String(userId), "utf8")
    .update("\0", "utf8")
    .update(idempotencyKey, "utf8")
    .digest("hex");

  return `payment_v1_${digest}`;
};

const findIdempotentPayment = ({ userId, idempotencyKey }) =>
  Payment.findOne({
    user: userId,
    idempotencyKey,
  }).lean();

const findCreationClaim = ({ userId, idempotencyKey }) =>
  PaymentCreation.findOne({
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

const assertCreationClaim = (claim) => {
  if (
    !isObject(claim) ||
    typeof claim.requestFingerprint !== "string" ||
    !PAYMENT_CREATION_STATUSES.has(claim.status) ||
    (claim.provider !== "stripe" && claim.provider !== "zarinpal")
  ) {
    throw new Error("Unexpected payment creation claim data.");
  }
};

const getStoredPaymentFingerprint = (payment) => {
  if (
    !isObject(payment) ||
    (payment.provider !== "stripe" && payment.provider !== "zarinpal") ||
    !Number.isSafeInteger(payment.amount) ||
    payment.amount < 1 ||
    typeof payment.currency !== "string" ||
    (payment.description !== undefined &&
      typeof payment.description !== "string")
  ) {
    throw new Error("Unexpected stored payment data.");
  }

  return createRequestFingerprint({
    provider: payment.provider,
    amount: payment.amount,
    currency: payment.currency,
    description: payment.description,
  });
};

const markCreationSucceeded = ({ claim, payment }) =>
  PaymentCreation.updateOne(
    {
      _id: claim._id,
      requestFingerprint: claim.requestFingerprint,
      status: "processing",
    },
    {
      $set: {
        status: "succeeded",
        payment: payment._id,
        failureKind: null,
        failureMessage: null,
      },
    },
    { runValidators: true },
  );

const markCreationFailed = ({ claim, error }) =>
  PaymentCreation.updateOne(
    {
      _id: claim._id,
      requestFingerprint: claim.requestFingerprint,
      status: "processing",
    },
    {
      $set: {
        status: "failed",
        payment: null,
        failureKind: error.kind,
        failureMessage: error.message.slice(0, 255),
      },
    },
    { runValidators: true },
  );

const resolveCreationClaim = async ({
  claim,
  requestFingerprint,
  userId,
  idempotencyKey,
  paymentProvider,
}) => {
  assertCreationClaim(claim);

  if (
    claim.requestFingerprint !== requestFingerprint ||
    claim.provider !== paymentProvider.provider
  ) {
    return { status: "conflict" };
  }

  if (claim.status === "failed") {
    if (
      (claim.failureKind !== "rejected" &&
        claim.failureKind !== "unreachable") ||
      typeof claim.failureMessage !== "string" ||
      claim.failureMessage.trim() === ""
    ) {
      throw new Error("Unexpected failed payment creation claim data.");
    }

    throw new PaymentProviderError(claim.failureMessage, {
      provider: claim.provider,
      kind: claim.failureKind,
    });
  }

  const payment = await findIdempotentPayment({
    userId,
    idempotencyKey,
  });

  if (!payment) {
    if (claim.status === "processing") {
      return { status: "processing" };
    }

    throw new Error("Completed payment creation has no stored payment.");
  }

  if (getStoredPaymentFingerprint(payment) !== requestFingerprint) {
    throw new Error("Stored payment does not match its creation claim.");
  }

  if (claim.status === "processing") {
    await markCreationSucceeded({ claim, payment });
  }

  return buildPaymentResult({
    status: "existing",
    payment,
    paymentProvider,
  });
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
  {
    paymentProvider = getConfiguredPaymentProvider(),
    idempotencySecret = process.env.PAYMENT_IDEMPOTENCY_SECRET,
  } = {},
) => {
  assertPaymentProvider(paymentProvider);
  assertIdempotencyInput({ userId, idempotencyKey });

  const requestFingerprint = createRequestFingerprint({
    provider: paymentProvider.provider,
    amount,
    currency,
    description,
  });
  const providerRequestKey = createProviderRequestKey({
    userId,
    idempotencyKey,
    idempotencySecret,
  });

  await Promise.all([Payment.init(), PaymentCreation.init()]);

  const existingClaim = await findCreationClaim({
    userId,
    idempotencyKey,
  });

  if (existingClaim) {
    return resolveCreationClaim({
      claim: existingClaim,
      requestFingerprint,
      userId,
      idempotencyKey,
      paymentProvider,
    });
  }

  const legacyPayment = await findIdempotentPayment({
    userId,
    idempotencyKey,
  });

  if (legacyPayment) {
    if (getStoredPaymentFingerprint(legacyPayment) !== requestFingerprint) {
      return { status: "conflict" };
    }

    const completedClaimData = {
      user: userId,
      idempotencyKey,
      requestFingerprint,
      provider: paymentProvider.provider,
      providerRequestKey,
      status: "succeeded",
      payment: legacyPayment._id,
    };

    try {
      await PaymentCreation.create(completedClaimData);
    } catch (error) {
      if (error?.code !== 11000) {
        throw error;
      }

      const winningClaim = await findCreationClaim({
        userId,
        idempotencyKey,
      });

      if (!winningClaim) {
        throw error;
      }

      return resolveCreationClaim({
        claim: winningClaim,
        requestFingerprint,
        userId,
        idempotencyKey,
        paymentProvider,
      });
    }

    return buildPaymentResult({
      status: "existing",
      payment: legacyPayment,
      paymentProvider,
    });
  }

  let claimDocument;

  try {
    claimDocument = await PaymentCreation.create({
      user: userId,
      idempotencyKey,
      requestFingerprint,
      provider: paymentProvider.provider,
      providerRequestKey,
      status: "processing",
    });
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }

    const winningClaim = await findCreationClaim({
      userId,
      idempotencyKey,
    });

    if (!winningClaim) {
      throw error;
    }

    return resolveCreationClaim({
      claim: winningClaim,
      requestFingerprint,
      userId,
      idempotencyKey,
      paymentProvider,
    });
  }

  if (!claimDocument || typeof claimDocument.toObject !== "function") {
    throw new Error("Unexpected payment creation claim result.");
  }

  const claim = claimDocument.toObject();
  assertCreationClaim(claim);

  let providerResult;

  try {
    providerResult = await paymentProvider.createPayment({
      amount,
      currency,
      description,
      idempotencyKey: providerRequestKey,
    });
  } catch (error) {
    if (error instanceof PaymentProviderError) {
      await markCreationFailed({ claim, error });
    }

    throw error;
  }

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

  paymentData.idempotencyKey = idempotencyKey;

  let paymentDocument;

  try {
    paymentDocument = await Payment.create(paymentData);
  } catch (error) {
    if (error?.code !== 11000) {
      throw error;
    }

    const existingPayment = await findIdempotentPayment({
      userId,
      idempotencyKey,
    });

    if (!existingPayment) {
      throw error;
    }

    if (getStoredPaymentFingerprint(existingPayment) !== requestFingerprint) {
      throw new Error("Stored payment does not match its creation claim.");
    }

    await markCreationSucceeded({ claim, payment: existingPayment });

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

  if (getStoredPaymentFingerprint(payment) !== requestFingerprint) {
    throw new Error("Created payment does not match its creation claim.");
  }

  await markCreationSucceeded({ claim, payment });

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
