const test = require("node:test");
const assert = require("node:assert/strict");
const { validateEnvironment } = require("../../config/environment");

const validEnvironment = () => ({
  PORT: "3000",
  DB_URL: "mongodb://127.0.0.1:27017/account-api",
  FRONTEND_URL: "http://localhost:5173",
  GOOGLE_CLIENT_ID: "google-client-id",
  JWT_SECRET: "j".repeat(32),
  OTP_SECRET: "o".repeat(32),
  LOGIN_THROTTLE_SECRET: "l".repeat(32),
  REQUEST_THROTTLE_SECRET: "r".repeat(32),
});

test("environment validation returns normalized server configuration", () => {
  const environment = validEnvironment();
  environment.PORT = " 3000 ";
  environment.DB_URL = "  mongodb://127.0.0.1:27017/account-api  ";

  assert.deepEqual(validateEnvironment(environment), {
    port: 3000,
    databaseUrl: "mongodb://127.0.0.1:27017/account-api",
  });
});

test("environment validation requires an object", () => {
  assert.throws(() => validateEnvironment(null), /environment must be an object/);
  assert.throws(() => validateEnvironment([]), /environment must be an object/);
});

test("environment validation reports every missing required variable", async (t) => {
  for (const name of Object.keys(validEnvironment())) {
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
  ];

  for (const name of secretNames) {
    const environment = validEnvironment();
    const secret = `short-${name}`;
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
