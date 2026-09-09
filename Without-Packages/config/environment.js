const MINIMUM_SECRET_BYTES = 32;
const SECRET_NAMES = [
  "JWT_SECRET",
  "OTP_SECRET",
  "LOGIN_THROTTLE_SECRET",
  "REQUEST_THROTTLE_SECRET",
];

const getRequiredString = (environment, name) => {
  const value = environment[name];

  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${name} environment variable is required.`);
  }

  return value.trim();
};

const validatePort = (environment) => {
  const rawPort = getRequiredString(environment, "PORT");

  if (!/^[0-9]+$/.test(rawPort)) {
    throw new Error("PORT must be an integer from 1 to 65535.");
  }

  const port = Number(rawPort);

  if (!Number.isSafeInteger(port) || port < 1 || port > 65_535) {
    throw new Error("PORT must be an integer from 1 to 65535.");
  }

  return port;
};

const validateFrontendUrl = (environment) => {
  const rawUrl = getRequiredString(environment, "FRONTEND_URL");
  let url;

  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("FRONTEND_URL must be a valid HTTP or HTTPS URL.");
  }

  if (
    (url.protocol !== "http:" && url.protocol !== "https:") ||
    url.username !== "" ||
    url.password !== ""
  ) {
    throw new Error("FRONTEND_URL must be a valid HTTP or HTTPS URL.");
  }
};

const validateSecret = (environment, name) => {
  const secret = getRequiredString(environment, name);

  if (Buffer.byteLength(secret, "utf8") < MINIMUM_SECRET_BYTES) {
    throw new Error(`${name} must contain at least 32 bytes.`);
  }
};

const validateEnvironment = (environment = process.env) => {
  if (
    environment === null ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    throw new TypeError("environment must be an object.");
  }

  const port = validatePort(environment);
  const databaseUrl = getRequiredString(environment, "DB_URL");

  validateFrontendUrl(environment);
  getRequiredString(environment, "GOOGLE_CLIENT_ID");

  for (const name of SECRET_NAMES) {
    validateSecret(environment, name);
  }

  return {
    port,
    databaseUrl,
  };
};

module.exports = {
  validateEnvironment,
};
