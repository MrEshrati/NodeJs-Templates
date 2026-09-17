const MINIMUM_SECRET_BYTES = 32;
const SECRET_NAMES = [
  "JWT_SECRET",
  "OTP_SECRET",
  "LOGIN_THROTTLE_SECRET",
  "REQUEST_THROTTLE_SECRET",
];
const PAYMENT_PROVIDERS = new Set(["stripe", "zarinpal"]);

const assertEnvironmentObject = (environment) => {
  if (
    environment === null ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    throw new TypeError("environment must be an object.");
  }
};

const getRequiredString = (environment, name) => {
  const value = environment[name];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} environment variable is required.`);
  }

  return value.trim();
};

const validatePort = (environment) => {
  const rawPort = getRequiredString(environment, "PORT");

  if (!/^[0-9]+$/.test(rawPort)) {
    throw new Error("PORT must be an integer from 1 to 65535.");
  }

  const port = Number(rawPort);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535.");
  }

  return port;
};

const validateFrontendUrl = (environment) => {
  const rawUrl = getRequiredString(environment, "FRONTEND_URL");
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("FRONTEND_URL must be a valid HTTP or HTTPS URL.");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("FRONTEND_URL must be a valid HTTP or HTTPS URL.");
  }
};

const validateSecret = (environment, name) => {
  const secret = getRequiredString(environment, name);

  if (Buffer.byteLength(secret, "utf8") < MINIMUM_SECRET_BYTES) {
    throw new Error(`${name} must contain at least 32 bytes.`);
  }
};

const validatePaymentProvider = (environment) => {
  const provider = getRequiredString(
    environment,
    "PAYMENT_PROVIDER",
  ).toLowerCase();

  if (!PAYMENT_PROVIDERS.has(provider)) {
    throw new Error('PAYMENT_PROVIDER must be "stripe" or "zarinpal".');
  }

  return provider;
};

const validatePaymentFakeMode = (environment) => {
  const rawFakeMode = getRequiredString(environment, "PAYMENT_FAKE_MODE");

  if (rawFakeMode !== "true" && rawFakeMode !== "false") {
    throw new Error('PAYMENT_FAKE_MODE must be "true" or "false".');
  }

  return rawFakeMode === "true";
};

const validateCallbackUrl = (environment, name) => {
  const rawUrl = getRequiredString(environment, name);
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL.`);
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error(`${name} must be a valid HTTP or HTTPS URL.`);
  }

  return rawUrl;
};

const validatePaymentEnvironment = (environment = process.env) => {
  assertEnvironmentObject(environment);

  const provider = validatePaymentProvider(environment);
  const fakeMode = validatePaymentFakeMode(environment);
  let credentials = null;

  if (!fakeMode && provider === "stripe") {
    credentials = {
      secretKey: getRequiredString(environment, "STRIPE_SECRET_KEY"),
      publishableKey: getRequiredString(
        environment,
        "STRIPE_PUBLISHABLE_KEY",
      ),
      webhookSecret: getRequiredString(
        environment,
        "STRIPE_WEBHOOK_SECRET",
      ),
    };
  }

  if (!fakeMode && provider === "zarinpal") {
    credentials = {
      merchantId: getRequiredString(environment, "ZARINPAL_MERCHANT_ID"),
      callbackUrl: validateCallbackUrl(
        environment,
        "ZARINPAL_CALLBACK_URL",
      ),
    };
  }

  return {
    provider,
    fakeMode,
    credentials,
  };
};

const validateEnvironment = (environment = process.env) => {
  assertEnvironmentObject(environment);

  const port = validatePort(environment);
  const databaseUrl = getRequiredString(environment, "DB_URL");

  validateFrontendUrl(environment);
  getRequiredString(environment, "GOOGLE_CLIENT_ID");

  for (const name of SECRET_NAMES) {
    validateSecret(environment, name);
  }

  const payment = validatePaymentEnvironment(environment);

  return {
    port,
    databaseUrl,
    payment,
  };
};

module.exports = {
  validateEnvironment,
  validatePaymentEnvironment,
};
