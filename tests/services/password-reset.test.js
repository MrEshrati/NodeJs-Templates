const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const target = fromProject("services", "passwordReset.service.js");
const tokenUtils = fromProject("utils", "token.utils.js");
const tokenModel = fromProject("models", "passwordResetToken.model.js");
const userModel = fromProject("models", "user.model.js");
const emailService = fromProject("services", "email.service.js");

test("password-reset tokens expire one hour after issuance", async (t) => {
  const now = Date.UTC(2026, 0, 1, 12, 0, 0);
  let updateFilter;
  let update;
  let createdToken;

  const { issuePasswordResetTokenAfterCooldown } = loadWithMocks(target, {
    [tokenUtils]: {
      generateToken: () => "plain-reset-token",
      hashToken: () => "hashed-reset-token",
    },
    [tokenModel]: {
      async findOneAndUpdate(filter, value) {
        updateFilter = filter;
        update = value;
        return null;
      },
      async create(value) {
        createdToken = value;
        return value;
      },
    },
    [userModel]: {},
    [emailService]: { sendPasswordResetEmail: async () => ({}) },
  });

  t.mock.method(Date, "now", () => now);

  const result = await issuePasswordResetTokenAfterCooldown("user-1");
  const expectedExpiry = now + 60 * 60 * 1000;
  const expectedCooldown = now - 3 * 60 * 1000;

  assert.equal(result.token, "plain-reset-token");
  assert.equal(result.tokenHash, "hashed-reset-token");
  assert.equal(result.expiresAt.getTime(), expectedExpiry);
  assert.equal(update.$set.expiresAt.getTime(), expectedExpiry);
  assert.equal(
    updateFilter.$or[0].updatedAt.$lte.getTime(),
    expectedCooldown,
  );
  assert.equal(createdToken.expiresAt.getTime(), expectedExpiry);
});
