const test = require("node:test");
const assert = require("node:assert/strict");
const { verifyJwt } = require("../../utils/jwt.utils");
const { hashToken } = require("../../utils/token.utils");
const { fromProject, loadWithMocks } = require("../helpers/module");

const target = fromProject("services", "token.service.js");
const refreshModel = fromProject("models", "refreshSession.model.js");

const withJwtSecret = async (callback) => {
  const original = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "j".repeat(32);
  try {
    return await callback();
  } finally {
    if (original === undefined) delete process.env.JWT_SECRET;
    else process.env.JWT_SECRET = original;
  }
};

test("createTokenPair creates typed tokens and refresh-session data", async () => {
  await withJwtSecret(async () => {
    const { createTokenPair } = require("../../services/token.service");
    const result = createTokenPair("user-1");
    const access = verifyJwt(result.tokens.access, "access");
    const refresh = verifyJwt(result.tokens.refresh, "refresh");

    assert.equal(access.sub, "user-1");
    assert.equal(refresh.sub, "user-1");
    assert.equal(access.exp - access.iat, 10 * 60);
    assert.equal(refresh.exp - refresh.iat, 7 * 24 * 60 * 60);
    assert.equal(result.sessionData.jtiHash, hashToken(refresh.jti));
    assert.equal(result.sessionData.expiresAt.getTime(), refresh.exp * 1000);
  });
});

test("issueTokenPair persists only hashed refresh-session identity", async () => {
  await withJwtSecret(async () => {
    let saved;
    const { issueTokenPair } = loadWithMocks(target, {
      [refreshModel]: {
        async create(value) {
          saved = value;
          return value;
        },
      },
    });

    const tokens = await issueTokenPair("user-1");
    const refresh = verifyJwt(tokens.refresh, "refresh");
    assert.equal(saved.user, "user-1");
    assert.equal(saved.jtiHash, hashToken(refresh.jti));
    assert.equal(Object.hasOwn(saved, "refresh"), false);
    assert.equal(Object.hasOwn(saved, "token"), false);
  });
});
