const AppError = require("../errors/AppError");
const PaymentProviderError = require("../errors/PaymentProviderError");
const {
  createPayment: createPaymentService,
  simulatePaymentConfirmation: simulatePaymentConfirmationService,
} = require("../services/payment.service");
const { serializePayment } = require("../utils/payment.utils");

const CREATE_PAYMENT_STATUSES = new Set(["created", "existing"]);
const SIMULATION_STATUSES = new Set(["updated", "unchanged"]);

const isObject = (value) =>
  value !== null && typeof value === "object" && !Array.isArray(value);

const isNonEmptyString = (value) =>
  typeof value === "string" && value.trim() !== "";

const createCheckoutResponse = ({ payment, checkout }) => {
  if (
    !isObject(payment) ||
    payment._id === undefined ||
    payment._id === null ||
    !isObject(checkout)
  ) {
    throw new Error("Unexpected payment creation service result.");
  }

  if (payment.provider === "stripe") {
    if (
      !isNonEmptyString(checkout.clientSecret) ||
      !isNonEmptyString(checkout.publishableKey)
    ) {
      throw new Error("Unexpected Stripe checkout result.");
    }

    return {
      payment_id: String(payment._id),
      client_secret: checkout.clientSecret,
      publishable_key: checkout.publishableKey,
    };
  }

  if (
    payment.provider !== "zarinpal" ||
    !isNonEmptyString(checkout.redirectUrl)
  ) {
    throw new Error("Unexpected ZarinPal checkout result.");
  }

  return {
    payment_id: String(payment._id),
    redirect_url: checkout.redirectUrl,
  };
};

const forwardPaymentError = (error, next) => {
  if (error instanceof PaymentProviderError) {
    return next(
      new AppError(
        error.message,
        502,
        "payment_provider_error",
      ),
    );
  }

  return next(error);
};

exports.createPayment = async (req, res, next) => {
  try {
    const result = await createPaymentService({
      userId: req.user._id,
      ...req.validatedBody,
    });

    if (!CREATE_PAYMENT_STATUSES.has(result?.status)) {
      throw new Error("Unexpected payment creation service status.");
    }

    const responseBody = createCheckoutResponse(result);
    const statusCode = result.status === "created" ? 201 : 200;

    return res.status(statusCode).json(responseBody);
  } catch (error) {
    return forwardPaymentError(error, next);
  }
};

exports.simulatePaymentConfirmation = async (req, res, next) => {
  try {
    const result = await simulatePaymentConfirmationService({
      userId: req.user._id,
      paymentId: req.validatedBody.paymentId,
      outcome: req.validatedBody.outcome,
    });

    if (result?.status === "not_found" || result?.status === "unavailable") {
      throw new AppError(
        "No Payment matches the given query.",
        404,
        "not_found",
      );
    }

    if (!SIMULATION_STATUSES.has(result?.status) || !result.payment) {
      throw new Error("Unexpected payment simulation service result.");
    }

    return res.status(200).json(serializePayment(result.payment));
  } catch (error) {
    return forwardPaymentError(error, next);
  }
};
