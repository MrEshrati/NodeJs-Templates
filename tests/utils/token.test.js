const test = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const { generateToken, hashToken } = require("../../utils/token.utils");

test("generateToken returns a URL-safe token with 256 bits of randomness", () => {
  const first = generateToken();
  const second = generateToken();

  assert.match(first, /^[A-Za-z0-9_-]{43}$/);
  assert.match(second, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(first, second);
  assert.equal(Buffer.from(first, "base64url").length, 32);
});

test("hashToken returns the SHA-256 hexadecimal digest", () => {
  const expected = crypto.createHash("sha256").update("token", "utf8").digest("hex");
  assert.equal(hashToken("token"), expected);
  assert.match(hashToken("another-token"), /^[a-f0-9]{64}$/);
});
