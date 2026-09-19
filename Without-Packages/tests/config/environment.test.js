const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateEnvironment,
  validatePaymentEnvironment,
} = require("../../config/environment");

const validEnvironment = () => ({
  PORT: "3000",
  NODE_ENV: "development",
  DB_URL: "mongodb://127.0.0.1:27017/account-api",
  FRONTEND_URL: "http://localhost:5173",
  GOOGLE_CLIENT_ID: "google-client-id",
  JWT_SECRET: "j".repeat(32),
  OTP_SECRET: "o".repeat(32),
  LOGIN_THROTTLE_SECRET: "l".repeat(32),
  REQUEST_THROTTLE_SECRET: "r".repeat(32),
  PAYMENT_IDEMPOTENCY_SECRET: "p".repeat(32),
  PAYMENT_PROVIDER: "stripe",
  PAYMENT_FAKE_MODE: "true",
});

const REQUIRED_ENVIRONMENT_NAMES = [
  "PORT",
  "NODE_ENV",
  "DB_URL",
  "FRONTEND_URL",
  "GOOGLE_CLIENT_ID",
  "JWT_SECRET",
  "OTP_SECRET",
  "LOGIN_THROTTLE_SECRET",
  "REQUEST_THROTTLE_SECRET",
  "PAYMENT_IDEMPOTENCY_SECRET",
  "PAYMENT_PROVIDER",
  "PAYMENT_FAKE_MODE",
];

test("environment validation returns normalized server configuration", () => {
  const environment = validEnvironment();
  environment.PORT = " 3000 ";
  environment.DB_URL = "  mongodb://127.0.0.1:27017/account-api  ";

  assert.deepEqual(validateEnvironment(environment), {
    port: 3000,
    databaseUrl: "mongodb://127.0.0.1:27017/account-api",
    runtimeEnvironment: "development",
    payment: {
      provider: "stripe",
      fakeMode: true,
      credentials: null,
    },
  });
});

test("environment validation accepts development and test runtimes", () => {
  for (const [value, expected] of [
    [" Development ", "development"],
    [" TEST ", "test"],
  ]) {
    const environment = validEnvironment();
    environment.NODE_ENV = value;

    assert.equal(
      validateEnvironment(environment).runtimeEnvironment,
      expected,
    );
  }
});

test("environment validation rejects unsupported runtimes", () => {
  const environment = validEnvironment();
  environment.NODE_ENV = "staging";

  assert.throws(
    () => validateEnvironment(environment),
    /NODE_ENV must be/,
  );
});

test("environment validation refuses Ethereal email in production", () => {
  const environment = validEnvironment();
  environment.NODE_ENV = "production";

  assert.throws(
    () => validateEnvironment(environment),
    /email delivery uses Ethereal/,
  );
});

test("environment validation requires an object", () => {
  assert.throws(() => validateEnvironment(null), /environment must be an object/);
  assert.throws(() => validateEnvironment([]), /environment must be an object/);
});

test("environment validation reports every missing required variable", async (t) => {
  for (const name of REQUIRED_ENVIRONMENT_NAMES) {
    await t.test(name, () => {
      const environment = validEnvironment();
      delete environment[name];

      assert.throws(
        () => validateEnvironment(environment),
        (error) => error.message.includes(name),
      );
    });
  }
});

test("payment environment normalizes both supported providers", () => {
  for (const [value, provider] of [
    [" Stripe ", "stripe"],
    [" ZARINPAL ", "zarinpal"],
  ]) {
    const environment = validEnvironment();
    environment.PAYMENT_PROVIDER = value;

    assert.deepEqual(validatePaymentEnvironment(environment), {
      provider,
      fakeMode: true,
      credentials: null,
    });
  }
});

test("payment environment rejects unsupported providers", () => {
  for (const provider of ["paypal", "stripe-connect", "zarin-pal"]) {
    const environment = validEnvironment();
    environment.PAYMENT_PROVIDER = provider;

    assert.throws(
      () => validatePaymentEnvironment(environment),
      /PAYMENT_PROVIDER must be/,
    );
  }
});

test("payment environment parses only strict boolean strings", () => {
  for (const fakeMode of ["TRUE", "FALSE", "1", "0", "yes", "no"]) {
    const environment = validEnvironment();
    environment.PAYMENT_FAKE_MODE = fakeMode;

    assert.throws(
      () => validatePaymentEnvironment(environment),
      /PAYMENT_FAKE_MODE must be/,
    );
  }

  const liveEnvironment = validEnvironment();
  liveEnvironment.PAYMENT_PROVIDER = "stripe";
  liveEnvironment.PAYMENT_FAKE_MODE = "false";
  liveEnvironment.STRIPE_SECRET_KEY = "stripe-secret";
  liveEnvironment.STRIPE_PUBLISHABLE_KEY = "stripe-publishable";
  liveEnvironment.STRIPE_WEBHOOK_SECRET = "stripe-webhook";

  assert.equal(
    validatePaymentEnvironment(liveEnvironment).fakeMode,
    false,
  );
});

test("live Stripe configuration requires only Stripe credentials", async (t) => {
  const stripeEnvironment = {
    ...validEnvironment(),
    PAYMENT_FAKE_MODE: "false",
    STRIPE_SECRET_KEY: " stripe-secret ",
    STRIPE_PUBLISHABLE_KEY: " stripe-publishable ",
    STRIPE_WEBHOOK_SECRET: " stripe-webhook ",
  };

  assert.deepEqual(validatePaymentEnvironment(stripeEnvironment), {
    provider: "stripe",
    fakeMode: false,
    credentials: {
      secretKey: "stripe-secret",
      publishableKey: "stripe-publishable",
      webhookSecret: "stripe-webhook",
    },
  });

  for (const name of [
    "STRIPE_SECRET_KEY",
    "STRIPE_PUBLISHABLE_KEY",
    "STRIPE_WEBHOOK_SECRET",
  ]) {
    await t.test(name, () => {
      const environment = { ...stripeEnvironment };
      delete environment[name];

      assert.throws(
        () => validatePaymentEnvironment(environment),
        (error) =>
          error.message.includes(name) &&
          !error.message.includes(stripeEnvironment[name]),
      );
    });
  }
});

test("live ZarinPal configuration requires its merchant and callback", async (t) => {
  const zarinpalEnvironment = {
    ...validEnvironment(),
    PAYMENT_PROVIDER: "zarinpal",
    PAYMENT_FAKE_MODE: "false",
    ZARINPAL_MERCHANT_ID: " merchant-id ",
    ZARINPAL_CALLBACK_URL:
      "http://localhost:3000/payments/zarinpal/callback",
  };

  assert.deepEqual(validatePaymentEnvironment(zarinpalEnvironment), {
    provider: "zarinpal",
    fakeMode: false,
    credentials: {
      merchantId: "merchant-id",
      callbackUrl: "http://localhost:3000/payments/zarinpal/callback",
    },
  });

  for (const name of [
    "ZARINPAL_MERCHANT_ID",
    "ZARINPAL_CALLBACK_URL",
  ]) {
    await t.test(name, () => {
      const environment = { ...zarinpalEnvironment };
      delete environment[name];

      assert.throws(
        () => validatePaymentEnvironment(environment),
        (error) =>
          error.message.includes(name) &&
          !error.message.includes(zarinpalEnvironment[name]),
      );
    });
  }
});

test("ZarinPal callback must be an HTTP URL without credentials", () => {
  for (const callbackUrl of [
    "not-a-url",
    "ftp://payments.example/callback",
    "https://user:password@payments.example/callback",
  ]) {
    const environment = {
      ...validEnvironment(),
      PAYMENT_PROVIDER: "zarinpal",
      PAYMENT_FAKE_MODE: "false",
      ZARINPAL_MERCHANT_ID: "merchant-id",
      ZARINPAL_CALLBACK_URL: callbackUrl,
    };

    assert.throws(
      () => validatePaymentEnvironment(environment),
      (error) =>
        error.message.includes("ZARINPAL_CALLBACK_URL") &&
        !error.message.includes(callbackUrl),
    );
  }
});

test("environment validation rejects invalid ports", () => {
  for (const port of ["0", "65536", "3.5", "3000abc", "-1"]) {
    const environment = validEnvironment();
    environment.PORT = port;

    assert.throws(() => validateEnvironment(environment), /PORT must be an integer/);
  }
});

test("environment validation rejects short secrets without exposing them", () => {
  const secretNames = [
    "JWT_SECRET",
    "OTP_SECRET",
    "LOGIN_THROTTLE_SECRET",
    "REQUEST_THROTTLE_SECRET",
    "PAYMENT_IDEMPOTENCY_SECRET",
  ];

  for (const name of secretNames) {
    const environment = validEnvironment();
    const secret = "short-secret";
    environment[name] = secret;

    assert.throws(
      () => validateEnvironment(environment),
      (error) =>
        error.message.includes(name) && !error.message.includes(secret),
    );
  }
});

test("environment validation counts secret length in UTF-8 bytes", () => {
  const environment = validEnvironment();
  environment.JWT_SECRET = "é".repeat(16);

  assert.doesNotThrow(() => validateEnvironment(environment));
});

test("environment validation rejects invalid or unsafe frontend URLs", () => {
  const invalidUrls = [
    "not-a-url",
    "ftp://example.com",
    "file:///frontend/index.html",
    "https://username:password@example.com",
  ];

  for (const frontendUrl of invalidUrls) {
    const environment = validEnvironment();
    environment.FRONTEND_URL = frontendUrl;

    assert.throws(() => validateEnvironment(environment), /FRONTEND_URL/);
  }
});
