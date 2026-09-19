const test = require("node:test");
const assert = require("node:assert/strict");

const routeMap = (router) =>
  router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).sort(),
      handlers: layer.route.stack.length,
    }));

test("auth router registers every documented authentication endpoint", () => {
  const router = require("../../routes/auth.route");
  assert.deepEqual(routeMap(router), [
    { path: "/register", methods: ["post"], handlers: 3 },
    { path: "/verify-email", methods: ["post"], handlers: 3 },
    { path: "/resend-verification", methods: ["post"], handlers: 3 },
    { path: "/login", methods: ["post"], handlers: 3 },
    { path: "/token/refresh", methods: ["post"], handlers: 3 },
    { path: "/logout", methods: ["post"], handlers: 2 },
    { path: "/otp/request", methods: ["post"], handlers: 3 },
    { path: "/otp/verify", methods: ["post"], handlers: 3 },
  ]);
});

test("profile router registers retrieval, partial update, and PUT rejection", () => {
  const router = require("../../routes/profile.route");
  assert.deepEqual(routeMap(router), [
    { path: "/", methods: ["get"], handlers: 3 },
    { path: "/", methods: ["patch"], handlers: 4 },
    { path: "/", methods: ["put"], handlers: 3 },
  ]);
});

test("notification router registers every documented endpoint in safe order", () => {
  const router = require("../../routes/notification.route");

  assert.deepEqual(routeMap(router), [
    { path: "/preferences", methods: ["get"], handlers: 3 },
    { path: "/preferences", methods: ["patch"], handlers: 4 },
    { path: "/preferences", methods: ["put"], handlers: 3 },
    { path: "/devices", methods: ["post"], handlers: 4 },
    { path: "/devices", methods: ["delete"], handlers: 4 },
    { path: "/", methods: ["get"], handlers: 4 },
    { path: "/unread-count", methods: ["get"], handlers: 3 },
    { path: "/read-all", methods: ["post"], handlers: 3 },
    { path: "/:notificationId/read", methods: ["post"], handlers: 3 },
    { path: "/:notificationId", methods: ["delete"], handlers: 3 },
  ]);
});

test("account, password, email, and Google routers expose their contracts", () => {
  assert.deepEqual(routeMap(require("../../routes/account.route")), [
    { path: "/delete", methods: ["post"], handlers: 4 },
  ]);

  assert.deepEqual(routeMap(require("../../routes/password.route")), [
    { path: "/reset", methods: ["post"], handlers: 3 },
    { path: "/reset/confirm", methods: ["post"], handlers: 3 },
    { path: "/change", methods: ["post"], handlers: 4 },
  ]);

  assert.deepEqual(routeMap(require("../../routes/email.route")), [
    { path: "/change", methods: ["post"], handlers: 4 },
    { path: "/change/confirm", methods: ["post"], handlers: 3 },
  ]);

  assert.deepEqual(routeMap(require("../../routes/google.route")), [
    { path: "/", methods: ["post"], handlers: 3 },
  ]);
});
