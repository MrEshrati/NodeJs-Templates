const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const target = fromProject("services", "accountEmailJob.service.js");
const jobModel = fromProject("models", "accountEmailJob.model.js");

test("account-email enqueue stores one normalized, expiring work item", async () => {
  const now = new Date("2026-09-19T10:00:00.000Z");
  let created;
  const service = loadWithMocks(target, {
    [jobModel]: {
      async create(value) {
        created = value;
        return { _id: "job-1", ...value };
      },
    },
  });

  const result = await service.enqueueAccountEmailJob(
    service.ACCOUNT_EMAIL_JOB_TYPES.PASSWORD_RESET,
    " USER@Example.COM ",
    { now },
  );

  assert.deepEqual(result, { status: "queued", jobId: "job-1" });
  assert.equal(created.email, "user@example.com");
  assert.equal(created.status, "pending");
  assert.equal(created.attempts, 0);
  assert.equal(created.availableAt, now);
  assert.equal(
    created.expiresAt.getTime(),
    now.getTime() + service.JOB_TTL_MS,
  );
});

test("account-email enqueue rejects invalid jobs before database access", async () => {
  let createCalls = 0;
  const service = loadWithMocks(target, {
    [jobModel]: {
      async create() {
        createCalls += 1;
      },
    },
  });

  await assert.rejects(
    service.enqueueAccountEmailJob("unknown", "user@example.com"),
    /Unsupported account email job type/,
  );
  await assert.rejects(
    service.enqueueAccountEmailJob(
      service.ACCOUNT_EMAIL_JOB_TYPES.OTP_LOGIN,
      "",
    ),
    /email must be a non-empty string/,
  );
  assert.equal(createCalls, 0);
});

test("account-email claim atomically leases pending or abandoned work", async () => {
  const now = new Date("2026-09-19T10:00:00.000Z");
  let captured;
  const claimedJob = {
    _id: "job-1",
    type: "otp_login",
    email: "user@example.com",
    status: "processing",
    attempts: 1,
    lockId: "00000000-0000-4000-8000-000000000000",
    expiresAt: new Date(now.getTime() + 60_000),
  };
  const service = loadWithMocks(target, {
    [jobModel]: {
      findOneAndUpdate(filter, update, options) {
        captured = { filter, update, options };
        return { lean: async () => claimedJob };
      },
    },
  });

  const result = await service.claimNextAccountEmailJob({ now });

  assert.equal(result, claimedJob);
  assert.deepEqual(captured.filter.availableAt, { $lte: now });
  assert.deepEqual(captured.filter.expiresAt, { $gt: now });
  assert.deepEqual(captured.filter.$or, [
    { status: "pending" },
    { status: "processing", lockedUntil: { $lte: now } },
  ]);
  assert.equal(captured.update.$set.status, "processing");
  assert.match(
    captured.update.$set.lockId,
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  assert.equal(
    captured.update.$set.lockedUntil.getTime(),
    now.getTime() + service.JOB_LEASE_MS,
  );
  assert.deepEqual(captured.update.$inc, { attempts: 1 });
  assert.deepEqual(captured.options.sort, { createdAt: 1, _id: 1 });
  assert.equal(captured.options.returnDocument, "after");
});

test("account-email completion is scoped to the worker lease", async () => {
  let filter;
  const service = loadWithMocks(target, {
    [jobModel]: {
      async deleteOne(value) {
        filter = value;
        return { deletedCount: 1 };
      },
    },
  });
  const job = {
    _id: "job-1",
    lockId: "00000000-0000-4000-8000-000000000000",
    attempts: 1,
    expiresAt: new Date(Date.now() + 60_000),
  };

  assert.deepEqual(await service.completeAccountEmailJob(job), {
    status: "completed",
  });
  assert.deepEqual(filter, {
    _id: "job-1",
    status: "processing",
    lockId: job.lockId,
  });
});

test("failed account-email jobs use bounded backoff and discard after the limit", async () => {
  const now = new Date("2026-09-19T10:00:00.000Z");
  const updates = [];
  const deletes = [];
  const service = loadWithMocks(target, {
    [jobModel]: {
      async updateOne(filter, update) {
        updates.push({ filter, update });
        return { matchedCount: 1 };
      },
      async deleteOne(filter) {
        deletes.push(filter);
        return { deletedCount: 1 };
      },
    },
  });
  const baseJob = {
    _id: "job-1",
    lockId: "00000000-0000-4000-8000-000000000000",
    expiresAt: new Date(now.getTime() + service.JOB_TTL_MS),
  };

  const retry = await service.retryAccountEmailJob(
    { ...baseJob, attempts: 1 },
    { now },
  );

  assert.equal(retry.status, "retry_scheduled");
  assert.equal(
    retry.availableAt.getTime(),
    now.getTime() + service.BASE_RETRY_DELAY_MS,
  );
  assert.equal(updates[0].update.$set.status, "pending");
  assert.equal(updates[0].update.$set.lockId, null);
  assert.equal(updates[0].update.$set.lockedUntil, null);

  const discard = await service.retryAccountEmailJob(
    { ...baseJob, attempts: service.MAX_JOB_ATTEMPTS },
    { now },
  );

  assert.deepEqual(discard, { status: "discarded" });
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].lockId, baseJob.lockId);
});
