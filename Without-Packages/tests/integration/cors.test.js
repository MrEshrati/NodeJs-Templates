const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const appPath = fromProject("app.js");
const throttlePath = fromProject(
  "middlewares",
  "requestThrottle.middleware.js",
);

let throttleCalls = 0;

const createTrackingThrottle = () => (req, res, next) => {
  throttleCalls += 1;
  next();
};

const { app } = loadWithMocks(appPath, {
  [throttlePath]: createTrackingThrottle,
});

let server;
let baseUrl;

test.before(async () => {
  server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(0, "127.0.0.1", () => {
      resolve(listeningServer);
    });

    listeningServer.once("error", reject);
  });

  const address = server.address();
  baseUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
});

test("browser preflight completes before routes and throttling", async () => {
  const response = await fetch(`${baseUrl}/auth/login`, {
    method: "OPTIONS",
    headers: {
      Origin: "https://frontend.example",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": "Content-Type,Authorization",
    },
  });

  assert.equal(response.status, 204);
  assert.equal(await response.text(), "");
  assert.equal(response.headers.get("access-control-allow-origin"), "*");
  assert.equal(
    response.headers.get("access-control-allow-methods"),
    "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  );
  assert.equal(
    response.headers.get("access-control-allow-headers"),
    "Content-Type,Authorization",
  );
  assert.equal(response.headers.get("access-control-max-age"), "600");
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.equal(response.headers.get("x-content-type-options"), "nosniff");
  assert.equal(throttleCalls, 0);
});
