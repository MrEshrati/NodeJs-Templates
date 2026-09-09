const test = require("node:test");
const assert = require("node:assert/strict");
const { createJwt, verifyJwt } = require("../../utils/jwt.utils");

const withJwtSecret = (secret, callback) => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = secret;

  try {
    return callback();
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  }
};

test("JWT creation and verification round-trip access claims", () => {
  withJwtSecret("j".repeat(32), () => {
    const result = createJwt({
      userId: "  user-1  ",
      tokenType: "access",
      expiresInSeconds: 600,
    });
    const payload = verifyJwt(result.token, "access");

    assert.equal(payload.sub, "user-1");
    assert.equal(payload.token_type, "access");
    assert.equal(payload.jti, result.jti);
    assert.equal(payload.exp - payload.iat, 600);
    assert.equal(result.expiresAt.getTime(), payload.exp * 1000);
  });
});

test("JWT verification rejects the wrong token type and tampering", () => {
  withJwtSecret("j".repeat(32), () => {
    const { token } = createJwt({
      userId: "user-1",
      tokenType: "refresh",
      expiresInSeconds: 600,
    });

    assert.equal(verifyJwt(token, "access"), null);

    const segments = token.split(".");
    const first = segments[2][0] === "A" ? "B" : "A";
    const tampered = `${segments[0]}.${segments[1]}.${first}${segments[2].slice(1)}`;
    assert.equal(verifyJwt(tampered, "refresh"), null);
    assert.equal(verifyJwt("not-a-jwt", "refresh"), null);
    assert.equal(verifyJwt("", "refresh"), null);
  });
});

test("JWT helpers validate configuration and arguments", () => {
  withJwtSecret("short", () => {
    assert.throws(
      () => createJwt({ userId: "user", tokenType: "access", expiresInSeconds: 1 }),
      /at least 32 bytes/,
    );
  });

  withJwtSecret("j".repeat(32), () => {
    assert.throws(
      () => createJwt({ userId: "", tokenType: "access", expiresInSeconds: 1 }),
      /userId/,
    );
    assert.throws(
      () => createJwt({ userId: "user", tokenType: "other", expiresInSeconds: 1 }),
      /tokenType/,
    );
    assert.throws(
      () => createJwt({ userId: "user", tokenType: "access", expiresInSeconds: 0 }),
      /expiresInSeconds/,
    );
    assert.throws(() => verifyJwt("token", "other"), /expectedTokenType/);
  });
});
