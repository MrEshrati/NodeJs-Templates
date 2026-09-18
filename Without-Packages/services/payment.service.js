const Payment = require("../models/payment.model");
const {
  getConfiguredPaymentProvider,
} = require("./paymentProvider.service");

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

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

module.exports = {
  createPayment,
};
