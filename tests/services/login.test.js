const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const target = fromProject("services", "login.service.js");
const userModel = fromProject("models", "user.model.js");
const tokenService = fromProject("services", "token.service.js");
const throttleService = fromProject("services", "loginThrottle.service.js");

const loadLoginService = ({
  compare,
  findUser,
  recordFailedLogin,
  clearLoginFailures,
  issueTokenPair,
}) =>
  loadWithMocks(target, {
    bcrypt: { compare },
    [userModel]: { findOne: findUser },
    [tokenService]: { issueTokenPair },
    [throttleService]: { recordFailedLogin, clearLoginFailures },
  });

test("a correct password clears failures and authenticates despite an existing block", async () => {
  const calls = [];
  const tokens = { access: "access-token", refresh: "refresh-token" };
  const user = {
    _id: "user-1",
    password: "stored-password-hash",
    isActive: true,
    emailVerified: true,
  };
  const { authenticateUser } = loadLoginService({
    async compare(password, hash) {
      calls.push(["compare", password, hash]);
      return true;
    },
    async findUser() {
      calls.push(["findUser"]);
      return user;
    },
    async recordFailedLogin() {
      throw new Error("A correct password must not record another failure.");
    },
    async clearLoginFailures(email) {
      calls.push(["clear", email]);
    },
    async issueTokenPair(userId) {
      calls.push(["tokens", userId]);
      return tokens;
    },
  });

  const result = await authenticateUser("owner@example.com", "correct-password");

  assert.deepEqual(result, { status: "authenticated", tokens });
  assert.deepEqual(calls, [
    ["findUser"],
    ["compare", "correct-password", "stored-password-hash"],
    ["clear", "owner@example.com"],
    ["tokens", "user-1"],
  ]);
});

test("a failed password remains blocked after the failed-attempt threshold", async () => {
  let cleared = false;
  const { authenticateUser } = loadLoginService({
    async compare() {
      return false;
    },
    async findUser() {
      return {
        _id: "user-1",
        password: "stored-password-hash",
        isActive: true,
        emailVerified: true,
      };
    },
    async recordFailedLogin(email) {
      assert.equal(email, "owner@example.com");
      return { blocked: true, blockedUntil: new Date(Date.now() + 60_000) };
    },
    async clearLoginFailures() {
      cleared = true;
    },
    async issueTokenPair() {
      throw new Error("Failed credentials must not receive tokens.");
    },
  });

  const result = await authenticateUser("owner@example.com", "wrong-password");

  assert.deepEqual(result, { status: "login_throttled" });
  assert.equal(cleared, false);
});

test("an unknown account still performs a password comparison and records failure", async () => {
  const calls = [];
  const { authenticateUser } = loadLoginService({
    async compare(password, hash) {
      calls.push(["compare", password, hash]);
      return false;
    },
    async findUser() {
      return null;
    },
    async recordFailedLogin(email) {
      calls.push(["failure", email]);
      return { blocked: false, blockedUntil: null };
    },
    async clearLoginFailures() {
      throw new Error("An unknown account cannot clear failures.");
    },
    async issueTokenPair() {
      throw new Error("An unknown account must not receive tokens.");
    },
  });

  const result = await authenticateUser("unknown@example.com", "wrong-password");

  assert.deepEqual(result, { status: "invalid_credentials" });
  assert.equal(calls.length, 2);
  assert.equal(calls[0][0], "compare");
  assert.equal(calls[0][1], "wrong-password");
  assert.match(calls[0][2], /^\$2b\$12\$/);
  assert.deepEqual(calls[1], ["failure", "unknown@example.com"]);
});
