const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const target = fromProject("services", "email.service.js");
const nodemailerPath = require.resolve("nodemailer");

test("password-reset email states the one-hour expiry policy", async () => {
  let message;
  const originalFrontendUrl = process.env.FRONTEND_URL;
  process.env.FRONTEND_URL = "https://frontend.example";

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
  } finally {
    if (originalFrontendUrl === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = originalFrontendUrl;
  }
});
