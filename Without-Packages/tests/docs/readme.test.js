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
  "DB_URL",
  "TEST_DB_URL",
  "FRONTEND_URL",
  "GOOGLE_CLIENT_ID",
  "JWT_SECRET",
  "OTP_SECRET",
  "LOGIN_THROTTLE_SECRET",
  "REQUEST_THROTTLE_SECRET",
];

test("README documents every account API operation", () => {
  assert.equal(documentedEndpoints.length, 17);

  for (const endpoint of documentedEndpoints) {
    assert.ok(readme.includes(`\`${endpoint}\``), endpoint);
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
    "replica set",
    "16 KB",
    "10 minutes",
    "7 days",
    "Password-reset link | 1 hour",
    "Ethereal",
    "Cache-Control: no-store",
    ".github/workflows/without-packages-tests.yml",
  ];

  for (const content of requiredContent) {
    assert.ok(readme.includes(content), content);
  }
});
