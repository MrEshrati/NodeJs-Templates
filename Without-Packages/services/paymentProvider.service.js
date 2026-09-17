const { validatePaymentEnvironment } = require("../config/environment");
const fakeStripeProvider = require(
  "./paymentProviders/fakeStripe.provider",
);
const fakeZarinpalProvider = require(
  "./paymentProviders/fakeZarinpal.provider",
);
const {
  createStripeProvider,
} = require("./paymentProviders/stripe.provider");
const {
  createZarinpalProvider,
} = require("./paymentProviders/zarinpal.provider");

const SUPPORTED_PROVIDERS = new Set(["stripe", "zarinpal"]);

const assertPaymentConfig = (paymentConfig) => {
  if (
    paymentConfig === null ||
    typeof paymentConfig !== "object" ||
    Array.isArray(paymentConfig)
  ) {
    throw new TypeError("paymentConfig must be an object.");
  }

  if (!SUPPORTED_PROVIDERS.has(paymentConfig.provider)) {
    throw new TypeError('paymentConfig.provider must be "stripe" or "zarinpal".');
  }

  if (typeof paymentConfig.fakeMode !== "boolean") {
    throw new TypeError("paymentConfig.fakeMode must be a boolean.");
  }

  if (
    !paymentConfig.fakeMode &&
    (paymentConfig.credentials === null ||
      typeof paymentConfig.credentials !== "object" ||
      Array.isArray(paymentConfig.credentials))
  ) {
    throw new TypeError(
      "paymentConfig.credentials must be an object in live mode.",
    );
  }
};

const assertOptions = (options) => {
  if (options === null || typeof options !== "object" || Array.isArray(options)) {
    throw new TypeError("options must be an object.");
  }

  if (
    options.fetchImpl !== undefined &&
    typeof options.fetchImpl !== "function"
  ) {
    throw new TypeError("options.fetchImpl must be a function.");
  }

  if (
    options.timeoutMs !== undefined &&
    (!Number.isInteger(options.timeoutMs) || options.timeoutMs < 1)
  ) {
    throw new TypeError("options.timeoutMs must be a positive integer.");
  }
};

const createLiveProvider = (paymentConfig, options) => {
  const commonOptions = {};

  if (options.fetchImpl !== undefined) {
    commonOptions.fetchImpl = options.fetchImpl;
  }

  if (options.timeoutMs !== undefined) {
    commonOptions.timeoutMs = options.timeoutMs;
  }

  if (paymentConfig.provider === "stripe") {
    return createStripeProvider({
      secretKey: paymentConfig.credentials.secretKey,
      publishableKey: paymentConfig.credentials.publishableKey,
      ...commonOptions,
    });
  }

  return createZarinpalProvider({
    merchantId: paymentConfig.credentials.merchantId,
    callbackUrl: paymentConfig.credentials.callbackUrl,
    ...commonOptions,
  });
};

const assertProviderContract = (adapter, { provider, fakeMode }) => {
  if (
    adapter === null ||
    typeof adapter !== "object" ||
    Array.isArray(adapter) ||
    adapter.provider !== provider ||
    typeof adapter.createPayment !== "function" ||
    typeof adapter.getCheckout !== "function"
  ) {
    throw new TypeError(`Invalid ${provider} payment provider contract.`);
  }

  if (fakeMode && typeof adapter.simulatePayment !== "function") {
    throw new TypeError(
      `Fake ${provider} provider must implement simulatePayment.`,
    );
  }

  if (
    !fakeMode &&
    provider === "zarinpal" &&
    typeof adapter.verifyPayment !== "function"
  ) {
    throw new TypeError(
      "Live ZarinPal provider must implement verifyPayment.",
    );
  }
};

const exposeProviderContract = (adapter, { provider, fakeMode }) => {
  const paymentProvider = {
    provider,
    fakeMode,
    createPayment: adapter.createPayment,
    getCheckout: adapter.getCheckout,
  };

  if (fakeMode) {
    paymentProvider.simulatePayment = adapter.simulatePayment;
  }

  if (!fakeMode && provider === "zarinpal") {
    paymentProvider.verifyPayment = adapter.verifyPayment;
  }

  return Object.freeze(paymentProvider);
};

const createPaymentProvider = (paymentConfig, options = {}) => {
  assertPaymentConfig(paymentConfig);
  assertOptions(options);

  const adapter = paymentConfig.fakeMode
    ? paymentConfig.provider === "stripe"
      ? fakeStripeProvider
      : fakeZarinpalProvider
    : createLiveProvider(paymentConfig, options);

  assertProviderContract(adapter, paymentConfig);

  return exposeProviderContract(adapter, paymentConfig);
};

const getConfiguredPaymentProvider = (
  environment = process.env,
  options = {},
) => {
  const paymentConfig = validatePaymentEnvironment(environment);

  return createPaymentProvider(paymentConfig, options);
};

module.exports = {
  createPaymentProvider,
  getConfiguredPaymentProvider,
};
