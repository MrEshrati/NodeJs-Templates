const test = require("node:test");
const assert = require("node:assert/strict");
const {
  processNextAccountEmailJob,
  startAccountEmailWorker,
} = require("../../workers/accountEmail.worker");

const claimedJob = (overrides = {}) => ({
  _id: "job-1",
  type: "password_reset",
  email: "user@example.com",
  status: "processing",
  attempts: 1,
  lockId: "00000000-0000-4000-8000-000000000000",
  expiresAt: new Date(Date.now() + 60_000),
  ...overrides,
});

test("account-email worker reports idle without mutating the queue", async () => {
  let completionCalls = 0;
  const result = await processNextAccountEmailJob({
    handlers: {},
    jobQueue: {
      async claimNextAccountEmailJob() {
        return null;
      },
      async completeAccountEmailJob() {
        completionCalls += 1;
      },
    },
  });

  assert.deepEqual(result, { status: "idle" });
  assert.equal(completionCalls, 0);
});

test("account-email worker completes both sent and silently discarded jobs", async () => {
  const jobs = [
    claimedJob({ _id: "job-sent" }),
    claimedJob({ _id: "job-discarded", email: "unknown@example.com" }),
  ];
  const completed = [];
  const queue = {
    async claimNextAccountEmailJob() {
      return jobs.shift() ?? null;
    },
    async completeAccountEmailJob(job) {
      completed.push(job._id);
      return { status: "completed" };
    },
  };
  const handlers = {
    password_reset: async (email) => ({
      status: email === "unknown@example.com" ? "discarded" : "sent",
      previewUrl: null,
    }),
  };

  const sent = await processNextAccountEmailJob({ handlers, jobQueue: queue });
  const discarded = await processNextAccountEmailJob({
    handlers,
    jobQueue: queue,
  });

  assert.deepEqual(sent, {
    status: "completed",
    outcome: "sent",
    type: "password_reset",
  });
  assert.deepEqual(discarded, {
    status: "completed",
    outcome: "discarded",
    type: "password_reset",
  });
  assert.deepEqual(completed, ["job-sent", "job-discarded"]);
});

test("account-email worker logs preview credentials only in development", async () => {
  const originalNodeEnvironment = process.env.NODE_ENV;
  const messages = [];
  const logger = {
    error() {},
    log(message) {
      messages.push(message);
    },
  };
  const createQueue = () => ({
    async claimNextAccountEmailJob() {
      return claimedJob();
    },
    async completeAccountEmailJob() {
      return { status: "completed" };
    },
  });
  const handlers = {
    password_reset: async () => ({
      status: "sent",
      previewUrl: "https://email.example/credential-bearing-preview",
    }),
  };

  try {
    process.env.NODE_ENV = "test";
    await processNextAccountEmailJob({
      handlers,
      jobQueue: createQueue(),
      logger,
    });
    assert.deepEqual(messages, []);

    process.env.NODE_ENV = "development";
    await processNextAccountEmailJob({
      handlers,
      jobQueue: createQueue(),
      logger,
    });
    assert.equal(messages.length, 1);
    assert.match(messages[0], /credential-bearing-preview/);
  } finally {
    if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnvironment;
  }
});

test("account-email worker retries failures without logging credentials", async () => {
  const job = claimedJob({
    email: "private@example.com",
    token: "secret-token",
  });
  const logArguments = [];
  let retriedJob;
  const result = await processNextAccountEmailJob({
    handlers: {
      password_reset: async () => {
        throw new Error("SMTP failed for private@example.com with secret-token");
      },
    },
    jobQueue: {
      async claimNextAccountEmailJob() {
        return job;
      },
      async retryAccountEmailJob(value) {
        retriedJob = value;
        return { status: "retry_scheduled" };
      },
    },
    logger: {
      error(...values) {
        logArguments.push(values);
      },
      log() {},
    },
  });

  assert.equal(retriedJob, job);
  assert.deepEqual(result, {
    status: "retry_scheduled",
    type: "password_reset",
  });
  const logged = JSON.stringify(logArguments);
  assert.doesNotMatch(logged, /private@example\.com/);
  assert.doesNotMatch(logged, /secret-token/);
  assert.doesNotMatch(logged, /SMTP failed/);
});

test("account-email worker validates polling configuration", () => {
  assert.throws(
    () => startAccountEmailWorker({ pollIntervalMs: 0 }),
    /pollIntervalMs must be a positive integer/,
  );
  assert.throws(
    () => startAccountEmailWorker({ processNext: null }),
    /processNext must be a function/,
  );
});

test("account-email worker waits for active work during shutdown", async () => {
  let finishRun;
  let runCalls = 0;
  let reportStarted;
  const started = new Promise((resolve) => {
    reportStarted = resolve;
  });
  const runResult = new Promise((resolve) => {
    finishRun = resolve;
  });
  const worker = startAccountEmailWorker({
    pollIntervalMs: 10_000,
    processNext() {
      runCalls += 1;
      reportStarted();
      return runResult;
    },
  });

  await started;
  const stopping = worker.stop();

  finishRun({ status: "idle" });
  await stopping;
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(runCalls, 1);
});

test("account-email worker contains iteration failures and keeps them generic", async () => {
  const errors = [];
  let reportError;
  const errorReported = new Promise((resolve) => {
    reportError = resolve;
  });
  const worker = startAccountEmailWorker({
    logger: {
      error(message) {
        errors.push(message);
        reportError();
      },
    },
    pollIntervalMs: 10_000,
    async processNext() {
      throw new Error("database credentials and private job data");
    },
  });

  await errorReported;
  await worker.stop();

  assert.deepEqual(errors, ["Account email worker iteration failed."]);
});
