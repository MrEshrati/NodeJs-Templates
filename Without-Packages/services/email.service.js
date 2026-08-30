const nodemailer = require("nodemailer");

let transporterPromise;

async function createEtherealTransporter() {
  const testAccount = await nodemailer.createTestAccount();

  return nodemailer.createTransport(
    {
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass,
      },
    },
    {
      from: `"Account Template" <${testAccount.user}>`,
    },
  );
}

async function getTestTransporter() {
  if (!transporterPromise) {
    transporterPromise = createEtherealTransporter();
  }

  try {
    return await transporterPromise;
  } catch (error) {
    transporterPromise = undefined;
    throw error;
  }
}

async function sendVerificationEmail(email, token) {
  if (!process.env.FRONTEND_URL) {
    throw new Error("FRONTEND_URL environment variable is required.");
  }

  const verificationUrl = new URL(
    `/confirm-email/${encodeURIComponent(token)}`,
    process.env.FRONTEND_URL,
  ).toString();
  const transporter = await getTestTransporter();
  const info = await transporter.sendMail({
    to: email,
    subject: "Verify your email address",
    text: [
      "Welcome!",
      "",
      "Verify your email address by opening this link:",
      verificationUrl,
      "",
      "This link expires in one hour.",
      "If you did not create this account, you can ignore this email.",
    ].join("\n"),
    html: `
      <h1>Verify your email address</h1>
      <p>Welcome!</p>
      <p>
        <a href="${verificationUrl}">Verify email address</a>
      </p>
      <p>This link expires in one hour.</p>
      <p>If you did not create this account, you can ignore this email.</p>
    `,
  });

  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info),
  };
}

module.exports = {
  getTestTransporter,
  sendVerificationEmail,
};
