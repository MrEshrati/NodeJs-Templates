require("dotenv").config({ quiet: true });

const express = require("express");
const mongoose = require("mongoose");
const healthRouter = require("./routes/health.route");
const authRouter = require("./routes/auth.route");
const profileRouter = require("./routes/profile.route");
const accountRouter = require("./routes/account.route");
const passwordRouter = require("./routes/password.route");
const emailRouter = require("./routes/email.route");
const googleRouter = require("./routes/google.route");
const securityHeaders = require("./middlewares/securityHeaders.middleware");
const requestId = require("./middlewares/requestId.middleware");
const cors = require("./middlewares/cors.middleware");
const notFound = require("./middlewares/notFound.middleware");
const errorHandler = require("./middlewares/errorHandler.middleware");
const { validateEnvironment } = require("./config/environment");

const app = express();
const REQUEST_BODY_LIMIT = "16kb";
const HTTP_TIMEOUTS = Object.freeze({
  headers: 10_000,
  keepAlive: 5_000,
  request: 30_000,
  shutdown: 10_000,
  socket: 30_000,
});

app.disable("x-powered-by");
app.use(securityHeaders);
app.use(requestId);
app.use(cors);
app.use("/health", healthRouter);

app.use(express.json({ limit: REQUEST_BODY_LIMIT }));
app.use(
  express.urlencoded({
    extended: true,
    limit: REQUEST_BODY_LIMIT,
  }),
);

app.use("/auth", authRouter);
app.use("/profile", profileRouter);
app.use("/", accountRouter);
app.use("/password", passwordRouter);
app.use("/email", emailRouter);
app.use("/google", googleRouter);

app.use(notFound);
app.use(errorHandler);

const startServer = async () => {
  const { port, databaseUrl } = validateEnvironment();

  await mongoose.connect(databaseUrl);

  const server = app.listen(port, () => {
    console.log(`Server running on port ${port}`);
  });

  server.headersTimeout = HTTP_TIMEOUTS.headers;
  server.keepAliveTimeout = HTTP_TIMEOUTS.keepAlive;
  server.requestTimeout = HTTP_TIMEOUTS.request;
  server.timeout = HTTP_TIMEOUTS.socket;

  return server;
};

const closeHttpServer = (server) =>
  new Promise((resolve, reject) => {
    if (!server || typeof server.close !== "function") {
      reject(new TypeError("server must provide a close method."));
      return;
    }

    server.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });
  });

const performServerShutdown = async (server) => {
  let httpError = null;

  try {
    await closeHttpServer(server);
  } catch (error) {
    httpError = error;
  }

  try {
    await mongoose.disconnect();
  } catch (databaseError) {
    if (httpError) {
      throw new AggregateError(
        [httpError, databaseError],
        "HTTP server and database shutdown failed.",
      );
    }

    throw databaseError;
  }

  if (httpError) {
    throw httpError;
  }
};

const stopServer = (
  server,
  { shutdownTimeoutMs = HTTP_TIMEOUTS.shutdown } = {},
) => {
  if (!Number.isInteger(shutdownTimeoutMs) || shutdownTimeoutMs <= 0) {
    throw new TypeError("shutdownTimeoutMs must be a positive integer.");
  }

  let timeout;
  const shutdown = performServerShutdown(server);
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      const timeoutError = new Error(
        `Server shutdown exceeded ${shutdownTimeoutMs} milliseconds.`,
      );

      reject(timeoutError);

      if (typeof server?.closeAllConnections === "function") {
        try {
          server.closeAllConnections();
        } catch {
          // The deadline error remains the primary shutdown failure.
        }
      }
    }, shutdownTimeoutMs);
  });

  return Promise.race([shutdown, deadline]).finally(() => {
    clearTimeout(timeout);
  });
};

const registerShutdownHandlers = (
  server,
  { runtime = process, logger = console } = {},
) => {
  let shutdownPromise = null;

  const handleShutdown = (signal) => {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    logger.log(`Received ${signal}. Shutting down gracefully.`);

    shutdownPromise = stopServer(server).catch((error) => {
      logger.error(error);
      runtime.exitCode = 1;
    });

    return shutdownPromise;
  };

  runtime.once("SIGINT", handleShutdown);
  runtime.once("SIGTERM", handleShutdown);

  return handleShutdown;
};

if (require.main === module) {
  startServer()
    .then((server) => {
      registerShutdownHandlers(server);
    })
    .catch((error) => {
      console.error(error);
      process.exitCode = 1;
    });
}

module.exports = {
  app,
  registerShutdownHandlers,
  startServer,
  stopServer,
};
