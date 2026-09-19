const accountEmailJobs = require("../services/accountEmailJob.service");
const {
  deliverPasswordResetEmail,
} = require("../services/passwordReset.service");
const { deliverOtpCodeEmail } = require("../services/otp.service");
const {
  deliverEmailVerification,
} = require("../services/emailVerification.service");

const DEFAULT_POLL_INTERVAL_MS = 1000;

const DEFAULT_HANDLERS = Object.freeze({
  [accountEmailJobs.ACCOUNT_EMAIL_JOB_TYPES.PASSWORD_RESET]:
    deliverPasswordResetEmail,
  [accountEmailJobs.ACCOUNT_EMAIL_JOB_TYPES.OTP_LOGIN]: deliverOtpCodeEmail,
  [accountEmailJobs.ACCOUNT_EMAIL_JOB_TYPES.EMAIL_VERIFICATION]:
    deliverEmailVerification,
});

const processNextAccountEmailJob = async ({
  handlers = DEFAULT_HANDLERS,
  jobQueue = accountEmailJobs,
  logger = console,
} = {}) => {
  const job = await jobQueue.claimNextAccountEmailJob();

  if (!job) {
    return { status: "idle" };
  }

  try {
    const handler = handlers[job.type];

    if (typeof handler !== "function") {
      throw new Error("Unsupported account email job type.");
    }

    const result = await handler(job.email);

    if (result?.status !== "sent" && result?.status !== "discarded") {
      throw new Error("Unexpected account email delivery status.");
    }

    if (
      process.env.NODE_ENV?.trim().toLowerCase() === "development" &&
      result.previewUrl
    ) {
      logger.log(`Email preview (${job.type}): ${result.previewUrl}`);
    }

    await jobQueue.completeAccountEmailJob(job);

    return { status: "completed", outcome: result.status, type: job.type };
  } catch {
    const retry = await jobQueue.retryAccountEmailJob(job);

    logger.error("Account email delivery failed.", {
      attempt: job.attempts,
      jobId: String(job._id),
      outcome: retry.status,
      type: job.type,
    });

    return { status: retry.status, type: job.type };
  }
};

const startAccountEmailWorker = ({
  logger = console,
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  processNext = processNextAccountEmailJob,
} = {}) => {
  if (!Number.isInteger(pollIntervalMs) || pollIntervalMs <= 0) {
    throw new TypeError("pollIntervalMs must be a positive integer.");
  }

  if (typeof processNext !== "function") {
    throw new TypeError("processNext must be a function.");
  }

  let activeRun = null;
  let stopped = false;
  let timer = null;

  const schedule = (delay) => {
    if (stopped) return;

    timer = setTimeout(run, delay);
    timer.unref?.();
  };

  const run = async () => {
    if (stopped) return;

    try {
      activeRun = processNext({ logger });
      const result = await activeRun;
      schedule(result?.status === "idle" ? pollIntervalMs : 0);
    } catch {
      logger.error("Account email worker iteration failed.");
      schedule(pollIntervalMs);
    } finally {
      activeRun = null;
    }
  };

  schedule(0);

  return Object.freeze({
    async stop() {
      stopped = true;

      if (timer) {
        clearTimeout(timer);
        timer = null;
      }

      if (activeRun) {
        await activeRun;
      }
    },
  });
};

module.exports = {
  DEFAULT_POLL_INTERVAL_MS,
  processNextAccountEmailJob,
  startAccountEmailWorker,
};
