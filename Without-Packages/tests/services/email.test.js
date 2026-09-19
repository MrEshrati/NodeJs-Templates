const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const target = fromProject("services", "email.service.js");
const nodemailerPath = require.resolve("nodemailer");

test("password-reset email states the one-hour expiry policy", async () => {
  let message;
  let transportOptions;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  process.env.FRONTEND_URL = "https://frontend.example";
  process.env.NODE_ENV = "development";

  const nodemailer = {
    async createTestAccount() {
      return {
        smtp: { host: "smtp.example", port: 587, secure: false },
        user: "test@example.com",
        pass: "test-password",
      };
    },
    createTransport(options) {
      transportOptions = options;
      return {
        async sendMail(value) {
          message = value;
          return { messageId: "message-id" };
        },
      };
    },
    getTestMessageUrl: () => "https://email.example/message-id",
  };

  try {
    const { sendPasswordResetEmail } = loadWithMocks(target, {
      [nodemailerPath]: nodemailer,
    });

    const result = await sendPasswordResetEmail(
      "user@example.com",
      "user-id",
      "reset-token",
    );

    assert.match(message.text, /expires in one hour/i);
    assert.match(message.html, /expires in one hour/i);
    assert.doesNotMatch(message.text, /24 hours/i);
    assert.doesNotMatch(message.html, /24 hours/i);
    assert.equal(result.messageId, "message-id");
    assert.equal(result.previewUrl, "https://email.example/message-id");
    assert.equal(transportOptions.disableFileAccess, true);
    assert.equal(transportOptions.disableUrlAccess, true);
    assert.equal(transportOptions.maxRecipients, 1);
  } finally {
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
    if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnvironment;
  }
});

test("email previews are suppressed outside development", async () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  let previewCalls = 0;
  process.env.FRONTEND_URL = "https://frontend.example";
  process.env.NODE_ENV = "test";

  const nodemailer = {
    async createTestAccount() {
      return {
        smtp: { host: "smtp.example", port: 587, secure: false },
        user: "test@example.com",
        pass: "test-password",
      };
    },
    createTransport() {
      return {
        async sendMail() {
          return { messageId: "message-id" };
        },
      };
    },
    getTestMessageUrl() {
      previewCalls += 1;
      return "https://email.example/message-id";
    },
  };

  try {
    const { sendPasswordResetEmail } = loadWithMocks(target, {
      [nodemailerPath]: nodemailer,
    });

    const result = await sendPasswordResetEmail(
      "user@example.com",
      "user-id",
      "reset-token",
    );

    assert.equal(result.previewUrl, null);
    assert.equal(previewCalls, 0);
  } finally {
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
    if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnvironment;
  }
});

test("Ethereal transport is disabled in production", async () => {
  const originalFrontendUrl = process.env.FRONTEND_URL;
  const originalNodeEnvironment = process.env.NODE_ENV;
  let accountCalls = 0;
  process.env.FRONTEND_URL = "https://frontend.example";
  process.env.NODE_ENV = "production";

  const nodemailer = {
    async createTestAccount() {
      accountCalls += 1;
      throw new Error("must not be called");
    },
    createTransport() {
      throw new Error("must not be called");
    },
    getTestMessageUrl() {
      throw new Error("must not be called");
    },
  };

  try {
    const { sendPasswordResetEmail } = loadWithMocks(target, {
      [nodemailerPath]: nodemailer,
    });

    await assert.rejects(
      sendPasswordResetEmail("user@example.com", "user-id", "reset-token"),
      /Ethereal email delivery is disabled in production/,
    );
    assert.equal(accountCalls, 0);
  } finally {
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
    if (originalNodeEnvironment === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnvironment;
  }
});
