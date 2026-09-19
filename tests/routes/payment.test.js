const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const target = fromProject("routes", "payment.route.js");
const paymentController = fromProject(
  "controllers",
  "payment.controller.js",
);
const accessAuthMiddleware = fromProject(
  "middlewares",
  "accessAuth.middleware.js",
);
const requestThrottleMiddleware = fromProject(
  "middlewares",
  "requestThrottle.middleware.js",
);
const validationMiddleware = fromProject(
  "middlewares",
  "validation.middleware.js",
);
const paymentValidator = fromProject(
  "validators",
  "payment.validator.js",
);

const createHandler = () => (_req, _res, next) => next();

const loadPaymentRouter = () => {
  const calls = {
    throttle: [],
    validation: [],
    creationValidator: [],
    simulationValidator: [],
  };
  const handlers = {
    accessAuth: createHandler(),
    createPayment: createHandler(),
    simulatePaymentConfirmation: createHandler(),
    creationThrottle: createHandler(),
    simulationThrottle: createHandler(),
    creationValidation: createHandler(),
    simulationValidation: createHandler(),
    creationValidator: createHandler(),
    simulationValidator: createHandler(),
  };
  const createPaymentRouter = loadWithMocks(target, {
    [paymentController]: {
      createPayment: handlers.createPayment,
      simulatePaymentConfirmation: handlers.simulatePaymentConfirmation,
    },
    [accessAuthMiddleware]: handlers.accessAuth,
    [requestThrottleMiddleware]: (config) => {
      calls.throttle.push(config);

      if (config.scope === "payments:create:v1") {
        return handlers.creationThrottle;
      }

      if (config.scope === "payments:simulate:v1") {
        return handlers.simulationThrottle;
      }

      throw new Error("Unexpected payment throttle scope.");
    },
    [validationMiddleware]: (validator) => {
      calls.validation.push(validator);

      if (validator === handlers.creationValidator) {
        return handlers.creationValidation;
      }

      if (validator === handlers.simulationValidator) {
        return handlers.simulationValidation;
      }

      throw new Error("Unexpected payment validator.");
    },
    [paymentValidator]: {
      createPaymentValidator(provider) {
        calls.creationValidator.push(provider);
        return handlers.creationValidator;
      },
      createPaymentSimulationValidator(provider) {
        calls.simulationValidator.push(provider);
        return handlers.simulationValidator;
      },
    },
  });

  return { calls, createPaymentRouter, handlers };
};

const getRoutes = (router) =>
  router.stack
    .filter((layer) => layer.route)
    .map((layer) => ({
      path: layer.route.path,
      methods: Object.keys(layer.route.methods).sort(),
      handlers: layer.route.stack.map((routeLayer) => routeLayer.handle),
    }));

test("payment router rejects invalid configuration before setup", () => {
  const { calls, createPaymentRouter } = loadPaymentRouter();
  const invalidObjectConfigs = [null, [], "stripe", true];

  for (const config of invalidObjectConfigs) {
    assert.throws(
      () => createPaymentRouter(config),
      /paymentConfig must be an object/,
    );
  }

  for (const config of [
    undefined,
    {},
    { provider: "paypal", fakeMode: false },
    { provider: "STRIPE", fakeMode: false },
  ]) {
    assert.throws(
      () =>
        config === undefined
          ? createPaymentRouter()
          : createPaymentRouter(config),
      /provider must be "stripe" or "zarinpal"/,
    );
  }

  for (const fakeMode of [undefined, null, 0, 1, "true"]) {
    assert.throws(
      () => createPaymentRouter({ provider: "stripe", fakeMode }),
      /fakeMode must be a boolean/,
    );
  }

  assert.deepEqual(calls, {
    throttle: [],
    validation: [],
    creationValidator: [],
    simulationValidator: [],
  });
});

test("live Stripe router exposes only payment creation in safe order", () => {
  const { calls, createPaymentRouter, handlers } = loadPaymentRouter();
  const routes = getRoutes(
    createPaymentRouter({ provider: "stripe", fakeMode: false }),
  );

  assert.deepEqual(calls.throttle, [
    {
      scope: "payments:create:v1",
      maxRequests: 20,
      windowMs: 60_000,
    },
  ]);
  assert.deepEqual(calls.creationValidator, ["stripe"]);
  assert.deepEqual(calls.simulationValidator, []);
  assert.deepEqual(calls.validation, [handlers.creationValidator]);
  assert.equal(routes.length, 1);
  assert.equal(routes[0].path, "/create-payment");
  assert.deepEqual(routes[0].methods, ["post"]);
  assert.deepEqual(routes[0].handlers, [
    handlers.creationThrottle,
    handlers.accessAuth,
    handlers.creationValidation,
    handlers.createPayment,
  ]);
});

test("fake ZarinPal router exposes creation and simulation in safe order", () => {
  const { calls, createPaymentRouter, handlers } = loadPaymentRouter();
  const routes = getRoutes(
    createPaymentRouter({ provider: "zarinpal", fakeMode: true }),
  );

  assert.deepEqual(calls.throttle, [
    {
      scope: "payments:create:v1",
      maxRequests: 20,
      windowMs: 60_000,
    },
    {
      scope: "payments:simulate:v1",
      maxRequests: 60,
      windowMs: 60_000,
    },
  ]);
  assert.deepEqual(calls.creationValidator, ["zarinpal"]);
  assert.deepEqual(calls.simulationValidator, ["zarinpal"]);
  assert.deepEqual(calls.validation, [
    handlers.creationValidator,
    handlers.simulationValidator,
  ]);
  assert.equal(routes.length, 2);
  assert.equal(routes[0].path, "/create-payment");
  assert.deepEqual(routes[0].methods, ["post"]);
  assert.deepEqual(routes[0].handlers, [
    handlers.creationThrottle,
    handlers.accessAuth,
    handlers.creationValidation,
    handlers.createPayment,
  ]);
  assert.equal(routes[1].path, "/dev/simulate");
  assert.deepEqual(routes[1].methods, ["post"]);
  assert.deepEqual(routes[1].handlers, [
    handlers.simulationThrottle,
    handlers.accessAuth,
    handlers.simulationValidation,
    handlers.simulatePaymentConfirmation,
  ]);
});

test("both providers support live and fake route modes", () => {
  for (const provider of ["stripe", "zarinpal"]) {
    for (const fakeMode of [false, true]) {
      const { calls, createPaymentRouter } = loadPaymentRouter();
      const routes = getRoutes(createPaymentRouter({ provider, fakeMode }));

      assert.deepEqual(
        routes.map((route) => route.path),
        fakeMode
          ? ["/create-payment", "/dev/simulate"]
          : ["/create-payment"],
      );
      assert.deepEqual(calls.creationValidator, [provider]);
      assert.deepEqual(
        calls.simulationValidator,
        fakeMode ? [provider] : [],
      );
    }
  }
});
