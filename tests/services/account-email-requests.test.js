const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const queueService = fromProject("services", "accountEmailJob.service.js");
const userModel = fromProject("models", "user.model.js");

const JOB_TYPES = Object.freeze({
  PASSWORD_RESET: "password_reset",
  OTP_LOGIN: "otp_login",
  EMAIL_VERIFICATION: "email_verification",
});

const assertRequestOnlyQueues = async ({ target, exportName, type }) => {
  const queued = [];
  const service = loadWithMocks(target, {
    [queueService]: {
      ACCOUNT_EMAIL_JOB_TYPES: JOB_TYPES,
      async enqueueAccountEmailJob(jobType, email) {
        queued.push({ jobType, email });
        return { status: "queued", jobId: `job-${queued.length}` };
      },
    },
    [userModel]: {
      findOne() {
        throw new Error("The request path must not query the user.");
      },
    },
  });

  const first = await service[exportName]("known@example.com");
  const second = await service[exportName]("unknown@example.com");

  assert.deepEqual(first, { status: "accepted" });
  assert.deepEqual(second, first);
  assert.deepEqual(queued, [
    { jobType: type, email: "known@example.com" },
    { jobType: type, email: "unknown@example.com" },
  ]);
};

test("password-reset requests enqueue identical work without account lookup", () =>
  assertRequestOnlyQueues({
    target: fromProject("services", "passwordReset.service.js"),
    exportName: "requestPasswordReset",
    type: JOB_TYPES.PASSWORD_RESET,
  }));

test("OTP requests enqueue identical work without account lookup", () =>
  assertRequestOnlyQueues({
    target: fromProject("services", "otp.service.js"),
    exportName: "requestOtpCode",
    type: JOB_TYPES.OTP_LOGIN,
  }));

test("verification resend enqueues identical work without account lookup", () =>
  assertRequestOnlyQueues({
    target: fromProject("services", "emailVerification.service.js"),
    exportName: "resendEmailVerification",
    type: JOB_TYPES.EMAIL_VERIFICATION,
  }));
