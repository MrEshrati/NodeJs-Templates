const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");
const { captureNext } = require("../helpers/http");

const target = fromProject("middlewares", "accessAuth.middleware.js");
const service = fromProject("services", "accessAuth.service.js");

const loadMiddleware = (authenticateAccessToken) =>
  loadWithMocks(target, {
    [service]: { authenticateAccessToken },
  });

const createRequest = (authorization) => ({
  get(name) {
    assert.equal(name, "authorization");
    return authorization;
  },
});

test("access-auth middleware requires an Authorization header", async () => {
  const middleware = loadMiddleware(async () => {
    throw new Error("service should not be called");
  });
  const next = captureNext();

  await middleware(createRequest(undefined), {}, next);
  assert.equal(next.calls[0].statusCode, 401);
  assert.equal(next.calls[0].code, "not_authenticated");
});

test("access-auth middleware rejects malformed Bearer credentials", async () => {
  const middleware = loadMiddleware(async () => ({ status: "authenticated" }));
  const next = captureNext();

  await middleware(createRequest("Basic token"), {}, next);
  assert.equal(next.calls[0].code, "token_not_valid");
});

test("access-auth middleware attaches the authenticated user", async () => {
  const user = { _id: "user-id", email: "user@example.com" };
  const middleware = loadMiddleware(async (token) => {
    assert.equal(token, "access-token");
    return { status: "authenticated", user };
  });
  const req = createRequest("Bearer access-token");
  const next = captureNext();

  await middleware(req, {}, next);
  assert.equal(req.user, user);
  assert.deepEqual(next.calls, [undefined]);
});

test("access-auth middleware maps invalid and inactive statuses", async (t) => {
  await t.test("invalid token", async () => {
    const middleware = loadMiddleware(async () => ({ status: "token_not_valid" }));
    const next = captureNext();
    await middleware(createRequest("Bearer token"), {}, next);
    assert.equal(next.calls[0].code, "token_not_valid");
  });

  await t.test("inactive user", async () => {
    const middleware = loadMiddleware(async () => ({ status: "user_inactive" }));
    const next = captureNext();
    await middleware(createRequest("Bearer token"), {}, next);
    assert.equal(next.calls[0].code, "user_inactive");
  });
});
