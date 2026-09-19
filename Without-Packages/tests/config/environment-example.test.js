const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");
const { fromProject, PROJECT_ROOT } = require("../helpers/module");

const DOCUMENTED_KEYS = [
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

const SECRET_KEYS = [
  "JWT_SECRET",
  "OTP_SECRET",
  "LOGIN_THROTTLE_SECRET",
  "REQUEST_THROTTLE_SECRET",
  "STRIPE_SECRET_KEY",
  "STRIPE_PUBLISHABLE_KEY",
  "STRIPE_WEBHOOK_SECRET",
  "ZARINPAL_MERCHANT_ID",
];

const parseEnvironmentExample = () => {
  const contents = fs.readFileSync(fromProject(".env.example"), "utf8");

  return contents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line !== "" && !line.startsWith("#"))
    .map((line) => {
      const separatorIndex = line.indexOf("=");
      assert.ok(separatorIndex > 0, `Invalid environment line: ${line}`);

      return {
        key: line.slice(0, separatorIndex),
        value: line.slice(separatorIndex + 1),
      };
    });
};

test("environment example contains every documented key exactly once", () => {
  const entries = parseEnvironmentExample();
  const keys = entries.map(({ key }) => key);

  assert.deepEqual([...keys].sort(), [...DOCUMENTED_KEYS].sort());

  for (const key of DOCUMENTED_KEYS) {
    assert.equal(keys.filter((candidate) => candidate === key).length, 1, key);
  }
});

test("environment example contains only non-secret development values", () => {
  const values = Object.fromEntries(
    parseEnvironmentExample().map(({ key, value }) => [key, value]),
  );

  assert.equal(values.PORT, "3000");
  assert.equal(values.NODE_ENV, "development");
  assert.match(values.DB_URL, /^mongodb:\/\/127\.0\.0\.1:/);
  assert.match(values.DB_URL, /replicaSet=rs0/);
  assert.match(values.TEST_DB_URL, /^mongodb:\/\/127\.0\.0\.1:/);
  assert.match(values.TEST_DB_URL, /account_api_test/);
  assert.match(values.TEST_DB_URL, /replicaSet=rs0/);
  assert.equal(values.FRONTEND_URL, "http://localhost:5173");
  assert.equal(values.GOOGLE_CLIENT_ID, "replace-me");
  assert.equal(values.PAYMENT_PROVIDER, "stripe");
  assert.equal(values.PAYMENT_FAKE_MODE, "true");
  assert.equal(
    values.ZARINPAL_CALLBACK_URL,
    "http://localhost:3000/payments/zarinpal/callback",
  );

  for (const key of SECRET_KEYS) {
    assert.equal(values[key], "replace-me");
    assert.ok(Buffer.byteLength(values[key], "utf8") < 32);
  }
});

test("Git ignores .env but keeps .env.example available for tracking", () => {
  const ignoredEnvironment = spawnSync(
    "git",
    ["check-ignore", "--no-index", ".env"],
    { cwd: PROJECT_ROOT, encoding: "utf8" },
  );
  const ignoredExample = spawnSync(
    "git",
    ["check-ignore", "--no-index", ".env.example"],
    { cwd: PROJECT_ROOT, encoding: "utf8" },
  );

  assert.equal(ignoredEnvironment.status, 0, ignoredEnvironment.stderr);
  assert.equal(ignoredExample.status, 1, ignoredExample.stderr);
});

test("package scripts use Node's built-in runtime features", () => {
  const packageJson = JSON.parse(
    fs.readFileSync(fromProject("package.json"), "utf8"),
  );

  assert.deepEqual(packageJson.engines, { node: ">=24.0.0" });
  assert.equal(packageJson.scripts.start, "node app.js");
  assert.equal(packageJson.scripts.dev, "node --watch app.js");
  assert.equal(packageJson.scripts.test, "node --test");
  assert.equal(packageJson.private, true);
  assert.equal(
    packageJson.scripts["audit:prod"],
    "npm audit --omit=dev --audit-level=high",
  );
  assert.equal(
    packageJson.scripts["test:coverage"],
    "node --test --experimental-test-coverage",
  );
  assert.equal(
    packageJson.scripts["test:coverage:all"],
    "node --test --test-concurrency=1 --experimental-test-coverage --test-coverage-lines=90 --test-coverage-branches=80 --test-coverage-functions=95 tests/**/*.test.js tests/e2e/*.e2e.js",
  );
  assert.equal(
    packageJson.scripts["test:e2e"],
    "node --test --test-concurrency=1 tests/e2e/*.e2e.js",
  );
  assert.equal(packageJson.devDependencies, undefined);
});
