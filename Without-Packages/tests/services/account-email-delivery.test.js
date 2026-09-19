const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const userModel = fromProject("models", "user.model.js");
const emailService = fromProject("services", "email.service.js");
const queueService = fromProject("services", "accountEmailJob.service.js");

const queryResult = (value) => ({
  select() {
    return this;
  },
  async lean() {
    return value;
  },
});

const queueMock = {
  ACCOUNT_EMAIL_JOB_TYPES: {
    PASSWORD_RESET: "password_reset",
    OTP_LOGIN: "otp_login",
    EMAIL_VERIFICATION: "email_verification",
  },
  async enqueueAccountEmailJob() {
    return { status: "queued" };
  },
};

test("password-reset delivery silently discards an unknown account", async () => {
  const service = loadWithMocks(
    fromProject("services", "passwordReset.service.js"),
    {
      [queueService]: queueMock,
      [userModel]: {
        findOne() {
          return queryResult(null);
        },
      },
      [emailService]: {
        async sendPasswordResetEmail() {
          throw new Error("must not send");
        },
      },
    },
  );

  assert.deepEqual(
    await service.deliverPasswordResetEmail("unknown@example.com"),
    { status: "discarded", previewUrl: null },
  );
});

test("password-reset delivery removes its credential when SMTP fails", async () => {
  const expiresAt = new Date(Date.now() + 60_000);
  let deleted;
  const tokenModel = fromProject("models", "passwordResetToken.model.js");
  const tokenUtils = fromProject("utils", "token.utils.js");
  const service = loadWithMocks(
    fromProject("services", "passwordReset.service.js"),
    {
      [queueService]: queueMock,
      [userModel]: {
        findOne() {
          return queryResult({ _id: "user-1", email: "user@example.com" });
        },
      },
      [tokenModel]: {
        async findOneAndUpdate() {
          return null;
        },
        async create() {},
        async deleteOne(filter) {
          deleted = filter;
          return { deletedCount: 1 };
        },
      },
      [tokenUtils]: {
        generateToken: () => "plain-token",
        hashToken: () => "hashed-token",
      },
      [emailService]: {
        async sendPasswordResetEmail() {
          throw new Error("SMTP unavailable");
        },
      },
    },
  );

  const originalNow = Date.now;
  Date.now = () => expiresAt.getTime() - 60 * 60 * 1000;

  try {
    await assert.rejects(
      service.deliverPasswordResetEmail("user@example.com"),
      /SMTP unavailable/,
    );
  } finally {
    Date.now = originalNow;
  }

  assert.deepEqual(deleted, {
    user: "user-1",
    tokenHash: "hashed-token",
    expiresAt,
  });
});

test("OTP delivery removes its credential when SMTP fails", async () => {
  const expiresAt = new Date(Date.now() + 60_000);
  let deleted;
  const otpModel = fromProject("models", "otpCode.model.js");
  const otpUtils = fromProject("utils", "otp.utils.js");
  const service = loadWithMocks(fromProject("services", "otp.service.js"), {
    [queueService]: queueMock,
    [userModel]: {
      findOne() {
        return queryResult({ _id: "user-1", email: "user@example.com" });
      },
    },
    [otpModel]: {
      async init() {},
      findOneAndUpdate() {
        return queryResult({ _id: "otp-1", expiresAt });
      },
      async deleteOne(filter) {
        deleted = filter;
        return { deletedCount: 1 };
      },
    },
    [otpUtils]: {
      generateOtpCode: () => "123456",
      hashOtpCode: () => "a".repeat(64),
      verifyOtpCodeHash: () => false,
    },
    [emailService]: {
      async sendOtpCodeEmail() {
        throw new Error("SMTP unavailable");
      },
    },
  });

  await assert.rejects(
    service.deliverOtpCodeEmail("user@example.com"),
    /SMTP unavailable/,
  );
  assert.deepEqual(deleted, { user: "user-1", expiresAt });
});

test("verification delivery removes its credential when SMTP fails", async () => {
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  let deleted;
  const verificationModel = fromProject(
    "models",
    "emailVerificationToken.model.js",
  );
  const tokenUtils = fromProject("utils", "token.utils.js");
  const service = loadWithMocks(
    fromProject("services", "emailVerification.service.js"),
    {
      [queueService]: queueMock,
      [userModel]: {
        async findOne() {
          return {
            _id: "user-1",
            email: "user@example.com",
            emailVerified: false,
          };
        },
      },
      [verificationModel]: {
        async findOneAndUpdate() {
          return { _id: "verification-1" };
        },
        async deleteOne(filter) {
          deleted = filter;
          return { deletedCount: 1 };
        },
      },
      [tokenUtils]: {
        generateToken: () => "plain-token",
        hashToken: () => "hashed-token",
      },
      [emailService]: {
        async sendVerificationEmail() {
          throw new Error("SMTP unavailable");
        },
      },
    },
  );

  const originalNow = Date.now;
  Date.now = () => expiresAt.getTime() - 60 * 60 * 1000;

  try {
    await assert.rejects(
      service.deliverEmailVerification("user@example.com"),
      /SMTP unavailable/,
    );
  } finally {
    Date.now = originalNow;
  }

  assert.deepEqual(deleted, {
    user: "user-1",
    tokenHash: "hashed-token",
    expiresAt,
  });
});
