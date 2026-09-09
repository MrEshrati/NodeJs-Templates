const test = require("node:test");
const assert = require("node:assert/strict");
const { consumeRequestThrottle } = require("../../services/requestThrottle.service");
const {
  getLoginThrottleStatus,
  recordFailedLogin,
  clearLoginFailures,
} = require("../../services/loginThrottle.service");
const { revokeRefreshToken } = require("../../services/logout.service");
const { authenticateAccessToken } = require("../../services/accessAuth.service");
const { createJwt } = require("../../utils/jwt.utils");

test("request-throttle service rejects invalid limits before database access", async () => {
  await assert.rejects(
    consumeRequestThrottle({ scope: "scope", clientKey: "ip", maxRequests: 0, windowMs: 1 }),
    /maxRequests/,
  );
  await assert.rejects(
    consumeRequestThrottle({ scope: "scope", clientKey: "ip", maxRequests: 1, windowMs: 0 }),
    /windowMs/,
  );
});

test("login-throttle entry points reject an empty email before database access", async () => {
  await assert.rejects(getLoginThrottleStatus(""), /email/);
  await assert.rejects(recordFailedLogin(null), /email/);
  await assert.rejects(clearLoginFailures("   "), /email/);
});

test("logout service distinguishes missing and invalid refresh tokens", async () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "j".repeat(32);
  try {
    assert.deepEqual(await revokeRefreshToken(), { status: "refresh_missing" });
    assert.deepEqual(await revokeRefreshToken("bad-token"), { status: "token_not_valid" });
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  }
});

test("access-auth service rejects invalid tokens and non-ObjectId subjects", async () => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "j".repeat(32);
  try {
    assert.deepEqual(await authenticateAccessToken("bad-token"), {
      status: "token_not_valid",
    });
    const { token } = createJwt({
      userId: "not-an-object-id",
      tokenType: "access",
      expiresInSeconds: 60,
    });
    assert.deepEqual(await authenticateAccessToken(token), {
      status: "token_not_valid",
    });
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  }
});
