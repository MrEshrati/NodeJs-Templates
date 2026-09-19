const { randomUUID } = require("node:crypto");
const AccountEmailJob = require("../models/accountEmailJob.model");
const {
  ACCOUNT_EMAIL_JOB_TYPES,
  ACCOUNT_EMAIL_JOB_TYPE_VALUES,
  ACCOUNT_EMAIL_JOB_STATUSES,
} = require("../utils/accountEmailJob.constants");

const JOB_TTL_MS = 15 * 60 * 1000;
const JOB_LEASE_MS = 60 * 1000;
const MAX_JOB_ATTEMPTS = 3;
const BASE_RETRY_DELAY_MS = 5 * 1000;

const assertDate = (value, name) => {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new TypeError(`${name} must be a valid Date.`);
  }
};

const normalizeEmail = (email) => {
  if (typeof email !== "string" || email.trim() === "") {
    throw new TypeError("email must be a non-empty string.");
  }

  const normalizedEmail = email.trim().toLowerCase();

  if (normalizedEmail.length > 254) {
    throw new TypeError("email must contain at most 254 characters.");
  }

  return normalizedEmail;
};

const enqueueAccountEmailJob = async (type, email, { now = new Date() } = {}) => {
  if (!ACCOUNT_EMAIL_JOB_TYPE_VALUES.includes(type)) {
    throw new TypeError("Unsupported account email job type.");
  }

  assertDate(now, "now");

  const job = await AccountEmailJob.create({
    type,
    email: normalizeEmail(email),
    status: ACCOUNT_EMAIL_JOB_STATUSES.PENDING,
    attempts: 0,
    availableAt: now,
    expiresAt: new Date(now.getTime() + JOB_TTL_MS),
  });

  return { status: "queued", jobId: job._id };
};

const claimNextAccountEmailJob = async ({ now = new Date() } = {}) => {
  assertDate(now, "now");

  const lockId = randomUUID();
  const lockedUntil = new Date(now.getTime() + JOB_LEASE_MS);

  return AccountEmailJob.findOneAndUpdate(
    {
      availableAt: { $lte: now },
      expiresAt: { $gt: now },
      $or: [
        { status: ACCOUNT_EMAIL_JOB_STATUSES.PENDING },
        {
          status: ACCOUNT_EMAIL_JOB_STATUSES.PROCESSING,
          lockedUntil: { $lte: now },
        },
      ],
    },
    {
      $set: {
        status: ACCOUNT_EMAIL_JOB_STATUSES.PROCESSING,
        lockId,
        lockedUntil,
      },
      $inc: { attempts: 1 },
    },
    {
      sort: { createdAt: 1, _id: 1 },
      returnDocument: "after",
      runValidators: true,
    },
  ).lean();
};

const assertClaimedJob = (job) => {
  if (
    !job ||
    job._id === undefined ||
    job._id === null ||
    typeof job.lockId !== "string" ||
    job.lockId === "" ||
    !Number.isInteger(job.attempts) ||
    job.attempts < 1 ||
    !(job.expiresAt instanceof Date) ||
    !Number.isFinite(job.expiresAt.getTime())
  ) {
    throw new TypeError("A claimed account email job is required.");
  }
};

const completeAccountEmailJob = async (job) => {
  assertClaimedJob(job);

  const result = await AccountEmailJob.deleteOne({
    _id: job._id,
    status: ACCOUNT_EMAIL_JOB_STATUSES.PROCESSING,
    lockId: job.lockId,
  });

  if (result.deletedCount !== 1) {
    throw new Error("Account email job ownership was lost before completion.");
  }

  return { status: "completed" };
};

const retryAccountEmailJob = async (job, { now = new Date() } = {}) => {
  assertClaimedJob(job);
  assertDate(now, "now");

  const retryDelayMs = Math.min(
    BASE_RETRY_DELAY_MS * 2 ** (job.attempts - 1),
    60 * 1000,
  );
  const availableAt = new Date(now.getTime() + retryDelayMs);

  if (
    job.attempts >= MAX_JOB_ATTEMPTS ||
    availableAt.getTime() >= job.expiresAt.getTime()
  ) {
    const result = await AccountEmailJob.deleteOne({
      _id: job._id,
      status: ACCOUNT_EMAIL_JOB_STATUSES.PROCESSING,
      lockId: job.lockId,
    });

    if (result.deletedCount !== 1) {
      throw new Error("Account email job ownership was lost before discard.");
    }

    return { status: "discarded" };
  }

  const result = await AccountEmailJob.updateOne(
    {
      _id: job._id,
      status: ACCOUNT_EMAIL_JOB_STATUSES.PROCESSING,
      lockId: job.lockId,
    },
    {
      $set: {
        status: ACCOUNT_EMAIL_JOB_STATUSES.PENDING,
        availableAt,
        lockId: null,
        lockedUntil: null,
      },
    },
    { runValidators: true },
  );

  if (result.matchedCount !== 1) {
    throw new Error("Account email job ownership was lost before retry.");
  }

  return { status: "retry_scheduled", availableAt };
};

module.exports = {
  ACCOUNT_EMAIL_JOB_TYPES,
  BASE_RETRY_DELAY_MS,
  JOB_LEASE_MS,
  JOB_TTL_MS,
  MAX_JOB_ATTEMPTS,
  claimNextAccountEmailJob,
  completeAccountEmailJob,
  enqueueAccountEmailJob,
  retryAccountEmailJob,
};
