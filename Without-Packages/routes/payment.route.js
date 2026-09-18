const express = require("express");
const paymentController = require("../controllers/payment.controller");
const requireAccessToken = require("../middlewares/accessAuth.middleware");
const createRequestThrottle = require(
  "../middlewares/requestThrottle.middleware",
);
const validateRequest = require("../middlewares/validation.middleware");
const {
  createPaymentSimulationValidator,
  createPaymentValidator,
} = require("../validators/payment.validator");

const PAYMENT_WINDOW_MS = 60 * 1000;

const assertPaymentConfig = (paymentConfig) => {
  if (
    paymentConfig === null ||
    typeof paymentConfig !== "object" ||
    Array.isArray(paymentConfig)
  ) {
    throw new TypeError("paymentConfig must be an object.");
  }

  if (
    paymentConfig.provider !== "stripe" &&
    paymentConfig.provider !== "zarinpal"
  ) {
    throw new TypeError('provider must be "stripe" or "zarinpal".');
  }

  if (typeof paymentConfig.fakeMode !== "boolean") {
    throw new TypeError("fakeMode must be a boolean.");
  }
};

const createPaymentRouter = (paymentConfig = {}) => {
  assertPaymentConfig(paymentConfig);

  const router = express.Router();
  const paymentCreationThrottle = createRequestThrottle({
    scope: "payments:create:v1",
    maxRequests: 20,
    windowMs: PAYMENT_WINDOW_MS,
  });
  const validatePaymentCreation = validateRequest(
    createPaymentValidator(paymentConfig.provider),
  );

  router.post(
    "/create-payment",
    paymentCreationThrottle,
    requireAccessToken,
    validatePaymentCreation,
    paymentController.createPayment,
  );

  if (paymentConfig.fakeMode) {
    const paymentSimulationThrottle = createRequestThrottle({
      scope: "payments:simulate:v1",
      maxRequests: 60,
      windowMs: PAYMENT_WINDOW_MS,
    });
    const validatePaymentSimulation = validateRequest(
      createPaymentSimulationValidator(paymentConfig.provider),
    );

    router.post(
      "/dev/simulate",
      paymentSimulationThrottle,
      requireAccessToken,
      validatePaymentSimulation,
      paymentController.simulatePaymentConfirmation,
    );
  }

  return router;
};

module.exports = createPaymentRouter;
