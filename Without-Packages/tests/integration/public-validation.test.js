const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const appPath = fromProject("app.js");
const throttlePath = fromProject(
  "middlewares",
  "requestThrottle.middleware.js",
);

const createPassThroughThrottle = () => (req, res, next) => next();

const { app } = loadWithMocks(appPath, {
  [throttlePath]: createPassThroughThrottle,
});

let server;
let baseUrl;

test.before(async () => {
  server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => {
      resolve(listeningServer);
    });

    listeningServer.once("error", reject);
  });

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

const postJson = async (path, body) => {
  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  return {
    response,
    payload: await response.json(),
  };
};

const assertValidationResponse = ({ response, payload }, expectedFields) => {
  assert.equal(response.status, 400);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/i);
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(
    response.headers.get("access-control-allow-methods"),
    "GET,POST,PUT,DELETE,PATCH",
  );
  assert.equal(
    response.headers.get("access-control-allow-headers"),
    "Content-Type,Authorization",
  );
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("pragma"), "no-cache");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(response.headers.get("x-frame-options"), "DENY");
  assert.equal(response.headers.get("referrer-policy"), "no-referrer");
  assert.equal(
    response.headers.get("content-security-policy"),
    "default-src 'none'",
  );
  assert.equal(payload.error, true);
  assert.equal(payload.code, "validation_error");
  assert.equal(payload.message, "Validation failed.");
  assert.deepEqual(Object.keys(payload.fields).sort(), [...expectedFields].sort());

  for (const field of expectedFields) {
    assert.ok(Array.isArray(payload.fields[field]));
    assert.ok(payload.fields[field].length > 0);
    assert.equal(typeof payload.fields[field][0].code, "string");
    assert.equal(typeof payload.fields[field][0].message, "string");
  }
};

const missingBodyCases = [
  {
    name: "registration",
    path: "/auth/register",
    fields: ["email", "password"],
  },
  {
    name: "login",
    path: "/auth/login",
    fields: ["non_field_errors", "password"],
  },
  {
    name: "email verification",
    path: "/auth/verify-email",
    fields: ["key"],
  },
  {
    name: "verification resend",
    path: "/auth/resend-verification",
    fields: ["email"],
  },
  {
    name: "refresh-token rotation",
    path: "/auth/token/refresh",
    fields: ["refresh"],
  },
  {
    name: "OTP request",
    path: "/auth/otp/request",
    fields: ["email"],
  },
  {
    name: "OTP verification",
    path: "/auth/otp/verify",
    fields: ["email", "code"],
  },
  {
    name: "password-reset request",
    path: "/password/reset",
    fields: ["email"],
  },
  {
    name: "password-reset confirmation",
    path: "/password/reset/confirm",
    fields: ["uid", "token", "new_password"],
  },
  {
    name: "email-change confirmation",
    path: "/email/change/confirm",
    fields: ["key"],
  },
  {
    name: "Google authentication",
    path: "/google",
    fields: ["id_token"],
  },
];

for (const testCase of missingBodyCases) {
  test(`${testCase.name} returns structured validation for a missing body`, async () => {
    const result = await postJson(testCase.path, {});
    assertValidationResponse(result, testCase.fields);
  });
}

const invalidBodyCases = [
  {
    name: "registration",
    path: "/auth/register",
    body: { email: "not-an-email", password: "short" },
    fields: ["email", "password"],
  },
  {
    name: "login",
    path: "/auth/login",
    body: { email: 42, password: {} },
    fields: ["email", "password"],
  },
  {
    name: "email verification",
    path: "/auth/verify-email",
    body: { key: 42 },
    fields: ["key"],
  },
  {
    name: "verification resend",
    path: "/auth/resend-verification",
    body: { email: "not-an-email" },
    fields: ["email"],
  },
  {
    name: "OTP request",
    path: "/auth/otp/request",
    body: { email: "not-an-email" },
    fields: ["email"],
  },
  {
    name: "password-reset request",
    path: "/password/reset",
    body: { email: "not-an-email" },
    fields: ["email"],
  },
  {
    name: "password-reset confirmation",
    path: "/password/reset/confirm",
    body: { uid: "bad-id", token: "", new_password: "short" },
    fields: ["uid", "token", "new_password"],
  },
  {
    name: "email-change confirmation",
    path: "/email/change/confirm",
    body: { key: {} },
    fields: ["key"],
  },
  {
    name: "Google authentication",
    path: "/google",
    body: { id_token: [] },
    fields: ["id_token"],
  },
];

for (const testCase of invalidBodyCases) {
  test(`${testCase.name} returns structured validation for invalid input`, async () => {
    const result = await postJson(testCase.path, testCase.body);
    assertValidationResponse(result, testCase.fields);
  });
}
