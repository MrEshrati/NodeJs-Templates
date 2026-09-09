const test = require("node:test");
const assert = require("node:assert/strict");
const {
  generateOtpCode,
  hashOtpCode,
  verifyOtpCodeHash,
} = require("../../utils/otp.utils");

const withOtpSecret = (secret, callback) => {
  const original = process.env.OTP_SECRET;
  process.env.OTP_SECRET = secret;

  try {
    return callback();
  } finally {
    if (original === undefined) delete process.env.OTP_SECRET;
    else process.env.OTP_SECRET = original;
  }
};

test("generateOtpCode always returns six ASCII digits", () => {
  for (let index = 0; index < 100; index += 1) {
    assert.match(generateOtpCode(), /^[0-9]{6}$/);
  }
});

test("OTP hashes are deterministic and bound to the user", () => {
  withOtpSecret("o".repeat(32), () => {
    const hash = hashOtpCode("user-1", "012345");
    assert.match(hash, /^[a-f0-9]{64}$/);
    assert.equal(hashOtpCode("user-1", "012345"), hash);
    assert.notEqual(hashOtpCode("user-2", "012345"), hash);
    assert.equal(verifyOtpCodeHash("user-1", "012345", hash), true);
    assert.equal(verifyOtpCodeHash("user-1", "012346", hash), false);
    assert.equal(verifyOtpCodeHash("user-2", "012345", hash), false);
  });
});

test("OTP helpers reject malformed inputs", () => {
  withOtpSecret("o".repeat(32), () => {
    assert.throws(() => hashOtpCode("", "012345"), /userId/);
    assert.throws(() => hashOtpCode("user", "12345"), /six ASCII digits/);
    assert.throws(() => hashOtpCode("user", 123456), /six ASCII digits/);
    assert.equal(verifyOtpCodeHash("user", "12345", "a".repeat(64)), false);
    assert.equal(verifyOtpCodeHash("user", "012345", "bad-hash"), false);
  });
});

test("OTP helpers require a secret of at least 32 bytes", () => {
  withOtpSecret("short", () => {
    assert.throws(() => hashOtpCode("user", "012345"), /at least 32 bytes/);
  });
});
