const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { fromProject } = require("../helpers/module");

const readme = fs.readFileSync(fromProject("README.md"), "utf8");

const documentedEndpoints = [
  "POST /auth/register",
  "POST /auth/verify-email",
  "POST /auth/resend-verification",
  "POST /auth/login",
  "POST /auth/token/refresh",
  "POST /auth/logout",
  "POST /auth/otp/request",
  "POST /auth/otp/verify",
  "POST /google",
  "GET /profile",
  "PATCH /profile",
  "POST /delete",
  "POST /password/reset",
  "POST /password/reset/confirm",
  "POST /password/change",
  "POST /email/change",
  "POST /email/change/confirm",
];

const documentedEnvironmentKeys = [
  "PORT",
  "NODE_ENV",
  "DB_URL",
  "TEST_DB_URL",
  "FRONTEND_URL",
  "GOOGLE_CLIENT_ID",
  "JWT_SECRET",
  "OTP_SECRET",
  "LOGIN_THROTTLE_SECRET",
  "REQUEST_THROTTLE_SECRET",
  "PAYMENT_PROVIDER",
  "PAYMENT_FAKE_MODE",
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "ZARINPAL_MERCHANT_ID",
  "ZARINPAL_CALLBACK_URL",
];

const documentedHealthEndpoints = ["GET /health/live", "GET /health/ready"];

const documentedNotificationEndpoints = [
  "GET /notifications",
  "GET /notifications/unread-count",
  "POST /notifications/read-all",
  "POST /notifications/:notificationId/read",
  "DELETE /notifications/:notificationId",
  "GET /notifications/preferences",
  "PATCH /notifications/preferences",
  "POST /notifications/devices",
  "DELETE /notifications/devices",
];

const documentedPaymentEndpoints = [
  "POST /create-payment",
  "POST /dev/simulate",
];

test("README documents every account API operation", () => {
  assert.equal(documentedEndpoints.length, 17);

  for (const endpoint of documentedEndpoints) {
    assert.ok(readme.includes(`\`${endpoint}\``), endpoint);
  }
});

test("README documents every health endpoint", () => {
  for (const endpoint of documentedHealthEndpoints) {
    assert.ok(readme.includes(`\`${endpoint}\``), endpoint);
  }
});

test("README documents every notification API operation", () => {
  assert.equal(documentedNotificationEndpoints.length, 9);

  for (const endpoint of documentedNotificationEndpoints) {
    assert.ok(readme.includes(`\`${endpoint}\``), endpoint);
  }
});

test("README documents every payment API operation", () => {
  assert.equal(documentedPaymentEndpoints.length, 2);

  for (const endpoint of documentedPaymentEndpoints) {
    assert.ok(readme.includes(`\`${endpoint}\``), endpoint);
  }
});

test("README documents payment modes, contracts, and safety policies", () => {
  const requiredPaymentContent = [
    "Account, Notification, and Payment API",
    "`201 Created`",
    "`200 OK`",
    "USD cents",
    "whole IRR",
    "`idempotency_key`",
    "authenticated user",
    "`PAYMENT_FAKE_MODE=true` never creates",
    "20 requests per minute",
    "60 requests per minute",
    "`502 payment_provider_error`",
    "live Stripe and ZarinPal requests and responses are tested with injected mock",
  ];

  for (const content of requiredPaymentContent) {
    assert.ok(readme.includes(content), content);
  }
});

test("README documents every environment variable", () => {
  for (const name of documentedEnvironmentKeys) {
    assert.ok(readme.includes(`\`${name}\``), name);
  }
});

test("README documents setup, security, lifetimes, and testing", () => {
  const requiredContent = [
    "npm ci",
    "npm start",
    "npm run dev",
    "npm test",
    "npm run audit:prod",
    "npm run test:coverage:all",
    "npm run test:e2e",
    "replica set",
    "16 KB",
    "10 minutes",
    "7 days",
    "Password-reset link | 1 hour",
    "Ethereal",
    "SIGTERM",
    "shutdown deadline",
    "X-Powered-By",
    "X-Request-Id",
    "Cache-Control: no-store",
    "page_size",
    "120 requests per minute",
    "20 device tokens",
    ".github/workflows/without-packages-tests.yml",
    "private",
  ];

  for (const content of requiredContent) {
    assert.ok(readme.includes(content), content);
  }
});
