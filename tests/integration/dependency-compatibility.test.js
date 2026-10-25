const test = require("node:test");
const assert = require("node:assert/strict");
const { generateKeyPairSync, sign } = require("node:crypto");
const { readFileSync } = require("node:fs");
const dotenv = require("dotenv");
const nodemailer = require("nodemailer");
const { OAuth2Client } = require("google-auth-library");
const { fromProject, loadWithMocks } = require("../helpers/module");

const setEnvironment = (t, name, value) => {
  const original = process.env[name];
  process.env[name] = value;
  t.after(() => {
    if (original === undefined) delete process.env[name];
    else process.env[name] = original;
  });
};

test("dotenv loads the example without replacing existing settings", () => {
  const examplePath = fromProject(".env.example");
  const parsed = dotenv.parse(readFileSync(examplePath));
  const environment = { PORT: "4321" };
  const result = dotenv.config({
    path: examplePath,
    processEnv: environment,
    quiet: true,
  });

  assert.equal(result.error, undefined);
  assert.deepEqual(result.parsed, parsed);
  assert.equal(environment.PORT, "4321");
  assert.equal(environment.PAYMENT_FAKE_MODE, "true");
  assert.equal(environment.FRONTEND_URL, "http://localhost:5173");
});

test("account email composes with the real Nodemailer transport", async (t) => {
  setEnvironment(t, "NODE_ENV", "test");
  setEnvironment(t, "FRONTEND_URL", "https://frontend.example");
  let deliveredMessage;

  const service = loadWithMocks(fromProject("services/email.service.js"), {
    [require.resolve("nodemailer")]: {
      ...nodemailer,
      async createTestAccount() {
        return {
          smtp: { host: "smtp.example", port: 587, secure: false },
          user: "sender@example.com",
          pass: "test-password",
        };
      },
      createTransport(options, defaults) {
        const transporter = nodemailer.createTransport(
          { ...options, streamTransport: true, buffer: true },
          defaults,
        );
        return {
          async sendMail(message) {
            const info = await transporter.sendMail(message);
            deliveredMessage = info;
            return info;
          },
        };
      },
    },
  });

  const result = await service.sendVerificationEmail(
    "recipient@example.com",
    "verification-token",
  );

  assert.ok(result.messageId);
  assert.equal(result.previewUrl, null);
  assert.deepEqual(deliveredMessage.envelope, {
    from: "sender@example.com",
    to: ["recipient@example.com"],
  });
  const message = deliveredMessage.message.toString("utf8");
  assert.match(message, /Subject: Verify your email address/);
  assert.match(
    message,
    /https:\/\/frontend\.example\/confirm-email\/verification-token/,
  );
});

test("Google ID tokens use real verification and certificate caching", async (t) => {
  const audience = "dependency-test-client-id";
  const keyId = "dependency-test-key";
  const { privateKey, publicKey } = generateKeyPairSync("rsa", {
    modulusLength: 2048,
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  let certificateRequests = 0;
  const client = new OAuth2Client({
    transporterOptions: {
      async fetchImplementation(url) {
        assert.equal(String(url), "https://www.googleapis.com/oauth2/v1/certs");
        certificateRequests += 1;
        return new Response(JSON.stringify({ [keyId]: publicKey }), {
          headers: {
            "content-type": "application/json",
            "cache-control": "public, max-age=3600",
          },
        });
      },
    },
  });
  const service = loadWithMocks(fromProject("services/googleAuth.service.js"), {
    [require.resolve("google-auth-library")]: {
      OAuth2Client: class {
        constructor() {
          return client;
        }
      },
    },
  });
  setEnvironment(t, "GOOGLE_CLIENT_ID", audience);
  const now = Math.floor(Date.now() / 1000);
  const createToken = (overrides = {}) => {
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT", kid: keyId }),
    ).toString("base64url");
    const payload = Buffer.from(
      JSON.stringify({
        iss: "https://accounts.google.com",
        aud: audience,
        sub: "dependency-test-subject",
        email: "Verified@Example.COM",
        email_verified: true,
        iat: now - 10,
        exp: now + 3600,
        ...overrides,
      }),
    ).toString("base64url");
    const signed = header + "." + payload;
    const signature = sign("RSA-SHA256", Buffer.from(signed), privateKey);
    return signed + "." + signature.toString("base64url");
  };

  assert.deepEqual(await service.verifyGoogleIdToken(createToken()), {
    status: "verified",
    identity: {
      subject: "dependency-test-subject",
      email: "verified@example.com",
    },
  });
  assert.deepEqual(
    await service.verifyGoogleIdToken(createToken({ aud: "other-client" })),
    { status: "authentication_failed" },
  );
  assert.deepEqual(
    await service.verifyGoogleIdToken(
      createToken({ iat: now - 7200, exp: now - 3600 }),
    ),
    { status: "authentication_failed" },
  );
  const [header, payload, signature] = createToken().split(".");
  const tamperedSignature =
    (signature[0] === "A" ? "B" : "A") + signature.slice(1);
  assert.deepEqual(
    await service.verifyGoogleIdToken(
      header + "." + payload + "." + tamperedSignature,
    ),
    { status: "authentication_failed" },
  );
  assert.deepEqual(
    await service.verifyGoogleIdToken(createToken({ email_verified: false })),
    { status: "social_email_unverified" },
  );
  assert.equal(certificateRequests, 1);
});
