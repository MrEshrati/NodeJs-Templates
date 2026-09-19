require("dotenv").config({ quiet: true });

const test = require("node:test");
const assert = require("node:assert/strict");
const bcrypt = require("bcrypt");
const { fromProject, loadWithMocks } = require("../helpers/module");
const {
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
} = require("../helpers/database");

const TEST_EMAIL = "email-change@example.com";
const NEW_EMAIL = "updated-email-change@example.com";
const UNAVAILABLE_EMAIL = "unavailable-email-change@example.com";
const TEST_PASSWORD = "correct-horse-battery-16";
const FRONTEND_ORIGIN = "https://account-e2e.example";
const JWT_SECRET = "email-e2e-jwt-secret-with-at-least-32-bytes";
const LOGIN_THROTTLE_SECRET =
  "email-e2e-login-throttle-secret-with-at-least-32-bytes";
const REQUEST_THROTTLE_SECRET =
  "email-e2e-request-throttle-secret-with-at-least-32-bytes";

const testDatabaseConfigured =
  typeof process.env.TEST_DB_URL === "string" &&
  process.env.TEST_DB_URL.trim() !== "";

const closeServer = async (server) => {
  if (!server) {
    return;
  }

  await new Promise((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
};

const startServer = async (app) =>
  new Promise((resolve, reject) => {
    const server = app.listen(0, "127.0.0.1", () => resolve(server));
    server.once("error", reject);
  });

const postJson = async (baseUrl, path, body, token) => {
  const headers = {
    "Content-Type": "application/json",
    Origin: FRONTEND_ORIGIN,
  };

  if (token !== undefined) {
    headers.Authorization = `Bearer ${token}`;
  }

  const response = await fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });

  return {
    response,
    payload: await response.json(),
  };
};

test(
  "email change consumes its key, updates login, and revokes sessions",
  {
    skip:
      !testDatabaseConfigured &&
      "Set TEST_DB_URL to a dedicated database ending in _test.",
  },
  async (t) => {
    process.env.FRONTEND_URL = FRONTEND_ORIGIN;
    process.env.JWT_SECRET = JWT_SECRET;
    process.env.LOGIN_THROTTLE_SECRET = LOGIN_THROTTLE_SECRET;
    process.env.REQUEST_THROTTLE_SECRET = REQUEST_THROTTLE_SECRET;

    const confirmationEmails = [];
    const changedEmails = [];
    const emailServicePath = fromProject("services/email.service.js");
    const { app } = loadWithMocks(fromProject("app.js"), {
      [emailServicePath]: {
        sendEmailChangeConfirmationEmail: async (email, token) => {
          confirmationEmails.push({ email, token });

          return {
            messageId: "email-change-confirmation-test-message",
            previewUrl: null,
          };
        },
        sendEmailChangedEmail: async (email) => {
          changedEmails.push(email);

          return {
            messageId: "email-changed-test-message",
            previewUrl: null,
          };
        },
      },
    });

    const User = require(fromProject("models/user.model.js"));
    const EmailChangeToken = require(
      fromProject("models/emailChangeToken.model.js"),
    );
    const RefreshSession = require(
      fromProject("models/refreshSession.model.js"),
    );
    const { hashToken } = require(fromProject("utils/token.utils.js"));

    let server;

    await connectTestDatabase();

    t.after(async () => {
      await closeServer(server);
      await clearTestDatabase();
      await disconnectTestDatabase();
    });

    await clearTestDatabase();

    const passwordHash = await bcrypt.hash(TEST_PASSWORD, 12);
    const user = await User.create({
      email: TEST_EMAIL,
      password: passwordHash,
      emailVerified: true,
      isActive: true,
    });

    await User.create({
      email: UNAVAILABLE_EMAIL,
      password: await bcrypt.hash("other-horse-battery-17", 12),
      emailVerified: true,
      isActive: true,
    });

    server = await startServer(app);

    const address = server.address();
    const baseUrl = `http://127.0.0.1:${address.port}`;

    const firstLogin = await postJson(baseUrl, "/auth/login", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });
    const secondLogin = await postJson(baseUrl, "/auth/login", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    assert.equal(firstLogin.response.status, 200);
    assert.equal(secondLogin.response.status, 200);
    assert.equal(
      await RefreshSession.countDocuments({ user: user._id, revokedAt: null }),
      2,
    );

    const rejectedRequest = await postJson(
      baseUrl,
      "/email/change",
      {
        new_email: NEW_EMAIL,
        password: "incorrect-password",
      },
      firstLogin.payload.access,
    );

    assert.equal(rejectedRequest.response.status, 400);
    assert.equal(rejectedRequest.payload.code, "validation_error");
    assert.equal(
      rejectedRequest.payload.fields.password[0].message,
      "Incorrect password.",
    );
    assert.equal(confirmationEmails.length, 0);
    assert.equal(await EmailChangeToken.countDocuments(), 0);

    const unavailableRequest = await postJson(
      baseUrl,
      "/email/change",
      {
        new_email: UNAVAILABLE_EMAIL,
        password: TEST_PASSWORD,
      },
      firstLogin.payload.access,
    );

    assert.equal(unavailableRequest.response.status, 200);
    assert.deepEqual(unavailableRequest.payload, {
      detail:
        "If that address is available, a confirmation email has been sent to it.",
    });
    assert.equal(confirmationEmails.length, 0);
    assert.equal(await EmailChangeToken.countDocuments(), 0);

    const changeRequest = await postJson(
      baseUrl,
      "/email/change",
      {
        new_email: NEW_EMAIL,
        password: TEST_PASSWORD,
      },
      secondLogin.payload.access,
    );

    assert.equal(changeRequest.response.status, 200);
    assert.deepEqual(changeRequest.payload, unavailableRequest.payload);
    assert.equal(confirmationEmails.length, 1);

    const confirmationEmail = confirmationEmails[0];

    assert.equal(confirmationEmail.email, NEW_EMAIL);
    assert.match(confirmationEmail.token, /^[A-Za-z0-9_-]{43}$/);

    const userBeforeConfirmation = await User.findById(user._id).lean();
    const storedChangeToken = await EmailChangeToken.findOne({
      user: user._id,
    }).lean();

    assert.equal(userBeforeConfirmation.email, TEST_EMAIL);
    assert.ok(storedChangeToken);
    assert.equal(storedChangeToken.oldEmail, TEST_EMAIL);
    assert.equal(storedChangeToken.newEmail, NEW_EMAIL);
    assert.equal(
      storedChangeToken.tokenHash,
      hashToken(confirmationEmail.token),
    );
    assert.notEqual(storedChangeToken.tokenHash, confirmationEmail.token);

    const rejectedConfirmation = await postJson(
      baseUrl,
      "/email/change/confirm",
      { key: "incorrect-email-change-key" },
    );

    assert.equal(rejectedConfirmation.response.status, 400);
    assert.equal(rejectedConfirmation.payload.code, "validation_error");
    assert.equal(
      rejectedConfirmation.payload.fields.key[0].message,
      "Invalid or expired confirmation key.",
    );

    const userAfterRejectedConfirmation = await User.findById(user._id).lean();

    assert.equal(userAfterRejectedConfirmation.email, TEST_EMAIL);
    assert.ok(await EmailChangeToken.exists({ _id: storedChangeToken._id }));
    assert.equal(
      await RefreshSession.countDocuments({ user: user._id, revokedAt: null }),
      2,
    );

    const confirmation = await postJson(
      baseUrl,
      "/email/change/confirm",
      { key: confirmationEmail.token },
    );

    assert.equal(confirmation.response.status, 200);
    assert.deepEqual(confirmation.payload, {
      detail: "Email address updated.",
    });
    assert.deepEqual(changedEmails, [TEST_EMAIL]);

    const changedUser = await User.findById(user._id).lean();
    const sessionsAfterChange = await RefreshSession.find({
      user: user._id,
    }).lean();

    assert.equal(changedUser.email, NEW_EMAIL);
    assert.equal(changedUser.emailVerified, true);
    assert.equal(
      await EmailChangeToken.exists({ _id: storedChangeToken._id }),
      null,
    );
    assert.equal(sessionsAfterChange.length, 2);
    assert.ok(
      sessionsAfterChange.every(
        (session) => session.revokedAt instanceof Date,
      ),
    );

    const oldEmailLogin = await postJson(baseUrl, "/auth/login", {
      email: TEST_EMAIL,
      password: TEST_PASSWORD,
    });

    assert.equal(oldEmailLogin.response.status, 400);
    assert.equal(oldEmailLogin.payload.code, "validation_error");

    const newEmailLogin = await postJson(baseUrl, "/auth/login", {
      email: NEW_EMAIL,
      password: TEST_PASSWORD,
    });

    assert.equal(newEmailLogin.response.status, 200);
    assert.equal(typeof newEmailLogin.payload.access, "string");
    assert.equal(typeof newEmailLogin.payload.refresh, "string");

    const reusedConfirmation = await postJson(
      baseUrl,
      "/email/change/confirm",
      { key: confirmationEmail.token },
    );

    assert.equal(reusedConfirmation.response.status, 400);
    assert.equal(reusedConfirmation.payload.code, "validation_error");
    assert.equal(
      reusedConfirmation.payload.fields.key[0].message,
      "Invalid or expired confirmation key.",
    );
  },
);
