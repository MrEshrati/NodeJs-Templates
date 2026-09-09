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

async function sendAccountExistsEmail(email) {
  if (!process.env.FRONTEND_URL) {
    throw new Error("FRONTEND_URL environment variable is required.");
  }

  const loginUrl = new URL("/login", process.env.FRONTEND_URL).toString();
  const forgotPasswordUrl = new URL(
    "/forgot-password",
    process.env.FRONTEND_URL,
  ).toString();
  const transporter = await getTestTransporter();
  const info = await transporter.sendMail({
    to: email,
    subject: "An account already exists for this email address",
    text: [
      "Someone attempted to register using this email address.",
      "",
      "An account already exists for this address.",
      `Log in: ${loginUrl}`,
      `Forgot your password: ${forgotPasswordUrl}`,
      "",
      "If you did not attempt to register, you can ignore this email.",
    ].join("\n"),
    html: `
      <h1>An account already exists</h1>
      <p>Someone attempted to register using this email address.</p>
      <p>An account already exists for this address.</p>
      <p><a href="${loginUrl}">Log in</a></p>
      <p><a href="${forgotPasswordUrl}">Forgot your password?</a></p>
      <p>If you did not attempt to register, you can ignore this email.</p>
    `,
  });

  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info),
  };
}

async function sendOtpCodeEmail(email, code) {
  if (typeof code !== "string" || !/^[0-9]{6}$/.test(code)) {
    throw new TypeError("code must contain exactly six ASCII digits.");
  }
  const transporter = await getTestTransporter();
  const info = await transporter.sendMail({
    to: email,
    subject: "Your one-time sign-in code",
    text: [
      "Welcome!",
      "",
      `Code: ${code}`,
      "",
      "This code expires in 10 minutes and can be used only once.",
      "If you did not request this code, you can ignore this email.",
    ].join("\n"),
    html: `
      <h1>Your one-time sign-in code</h1>
      <p>Welcome!</p>
      <p>
        Code: ${code}
      </p>
      <p>This code expires in 10 minutes and can be used only once.</p>
      <p>If you did not request this code, you can ignore this email.</p>
    `,
  });

  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info),
  };
}

const sendPasswordResetEmail = async (email, userId, token) => {
  if (!process.env.FRONTEND_URL) {
    throw new Error("FRONTEND_URL environment variable is required.");
  }

  const resetPassLink = new URL(
    `/reset-password?uid=${encodeURIComponent(userId)}&token=${encodeURIComponent(token)}`,
    process.env.FRONTEND_URL,
  ).toString();
  const transporter = await getTestTransporter();
  const info = await transporter.sendMail({
    to: email,
    subject: "Reset your password",
    text: [
      "Reset your password by opening this link:",
      resetPassLink,
      "",
      "This link expires in one hour.",
      "If you did not request a reset password link, you can ignore this email.",
    ].join("\n"),
    html: `
      <h1>Reset your password</h1>
      <p>
        <a href="${resetPassLink}">Reset Password</a>
      </p>
      <p>This link expires in one hour.</p>
      <p>If you did not request a reset password link, you can ignore this email.</p>
    `,
  });

  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info),
  };
};

const sendPasswordChangedEmail = async (email) => {
  const transporter = await getTestTransporter();
  const info = await transporter.sendMail({
    to: email,
    subject: "Your password was changed",
    text: [
      "Your account password was changed successfully.",
      "",
      "If you did not make this change, request a password reset immediately.",
    ].join("\n"),
    html: `
      <h1>Your password was changed</h1>
      <p>Your account password was changed successfully.</p>
      <p>If you did not make this change, request a password reset immediately.</p>
    `,
  });

  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info),
  };
};

const sendEmailChangeConfirmationEmail = async (newEmail, token) => {
  if (!process.env.FRONTEND_URL) {
    throw new Error("FRONTEND_URL environment variable is required.");
  }

  const confirmationUrl = new URL(
    `/confirm-email-change?key=${encodeURIComponent(token)}`,
    process.env.FRONTEND_URL,
  ).toString();
  const transporter = await getTestTransporter();
  const info = await transporter.sendMail({
    to: newEmail,
    subject: "Confirm your new email address",
    text: [
      "Confirm this address as your new login email by opening this link:",
      confirmationUrl,
      "",
      "This link expires in one hour.",
      "If you did not request this change, you can ignore this email.",
    ].join("\n"),
    html: `
      <h1>Confirm your new email address</h1>
      <p>
        <a href="${confirmationUrl}">Confirm new email address</a>
      </p>
      <p>This link expires in one hour.</p>
      <p>If you did not request this change, you can ignore this email.</p>
    `,
  });

  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info),
  };
};

const sendEmailChangedEmail = async (oldEmail) => {
  const transporter = await getTestTransporter();
  const info = await transporter.sendMail({
    to: oldEmail,
    subject: "Your email address was changed",
    text: [
      "The login email address for your account was changed.",
      "You will need to sign in again on your devices.",
      "",
      "If you did not authorize this change, take immediate action to secure your account.",
    ].join("\n"),
    html: `
      <h1>Your email address was changed</h1>
      <p>The login email address for your account was changed.</p>
      <p>You will need to sign in again on your devices.</p>
      <p>If you did not authorize this change, take immediate action to secure your account.</p>
    `,
  });

  return {
    messageId: info.messageId,
    previewUrl: nodemailer.getTestMessageUrl(info),
  };
};

module.exports = {
  getTestTransporter,
  sendVerificationEmail,
  sendAccountExistsEmail,
  sendOtpCodeEmail,
  sendPasswordResetEmail,
  sendPasswordChangedEmail,
  sendEmailChangeConfirmationEmail,
  sendEmailChangedEmail,
};
