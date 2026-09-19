const crypto = require("crypto");
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;
const MAX_JWT_LENGTH = 4096;
const CLOCK_SKEW_SECONDS = 30;
const { TextDecoder } = require("util");
const UTF8_DECODER = new TextDecoder("utf-8", {
  fatal: true,
});

const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET;

  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("JWT_SECRET must contain at least 32 bytes.");
  }

  return secret;
};

const encodeJson = (value) => {
  const json = JSON.stringify(value);
  return Buffer.from(json, "utf8").toString("base64url");
};

const isCanonicalBase64Url = (segment) => {
  if (
    typeof segment !== "string" ||
    segment.length === 0 ||
    !BASE64URL_PATTERN.test(segment) ||
    segment.length % 4 === 1
  ) {
    return false;
  }

  try {
    const decodedSegment = Buffer.from(segment, "base64url");
    return decodedSegment.toString("base64url") === segment;
  } catch {
    return false;
  }
};

const decodeJsonSegment = (segment) => {
  try {
    const bytes = Buffer.from(segment, "base64url");
    const json = UTF8_DECODER.decode(bytes);
    return JSON.parse(json);
  } catch {
    return null;
  }
};

const createJwt = ({ userId, tokenType, expiresInSeconds } = {}) => {
  const subject =
    userId === undefined || userId === null ? "" : String(userId).trim();

  if (subject === "") {
    throw new TypeError("userId must be a non-empty value.");
  }

  if (tokenType !== "access" && tokenType !== "refresh") {
    throw new TypeError('tokenType must be either "access" or "refresh".');
  }

  if (!Number.isSafeInteger(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new TypeError("expiresInSeconds must be a positive safe integer.");
  }

  const issuedAt = Math.floor(Date.now() / 1000);

  const expirationTime = issuedAt + expiresInSeconds;
  if (!Number.isSafeInteger(expirationTime)) {
    throw new RangeError("JWT expiration is outside the safe integer range.");
  }

  const jti = crypto.randomUUID();

  const header = {
    alg: "HS256",
    typ: "JWT",
  };

  const payload = {
    token_type: tokenType,
    sub: subject,
    jti,
    iat: issuedAt,
    exp: expirationTime,
  };

  const encodedHeader = encodeJson(header);
  const encodedPayload = encodeJson(payload);

  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = crypto
    .createHmac("sha256", getJwtSecret())
    .update(signingInput, "ascii")
    .digest("base64url");

  const token = `${signingInput}.${signature}`;

  return {
    token,
    jti,
    expiresAt: new Date(expirationTime * 1000),
  };
};

const verifyJwt = (token, expectedTokenType) => {
  if (expectedTokenType !== "access" && expectedTokenType !== "refresh") {
    throw new TypeError(
      'expectedTokenType must be either "access" or "refresh".',
    );
  }

  if (
    typeof token !== "string" ||
    token === "" ||
    token.length > MAX_JWT_LENGTH
  ) {
    return null;
  }

  const segments = token.split(".");
  if (segments.length !== 3) {
    return null;
  }

  const [encodedHeader, encodedPayload, encodedSignature] = segments;
  if (
    !isCanonicalBase64Url(encodedHeader) ||
    !isCanonicalBase64Url(encodedPayload) ||
    !isCanonicalBase64Url(encodedSignature)
  ) {
    return null;
  }

  const expectedHeader = encodeJson({
    alg: "HS256",
    typ: "JWT",
  });

  if (encodedHeader !== expectedHeader) {
    return null;
  }

  const providedSignature = Buffer.from(encodedSignature, "base64url");

  if (providedSignature.length !== 32) {
    return null;
  }

  const signingInput = `${encodedHeader}.${encodedPayload}`;

  const expectedSignature = crypto
    .createHmac("sha256", getJwtSecret())
    .update(signingInput, "ascii")
    .digest();

  if (!crypto.timingSafeEqual(providedSignature, expectedSignature)) {
    return null;
  }

  const payload = decodeJsonSegment(encodedPayload);

  if (
    payload === null ||
    typeof payload !== "object" ||
    Array.isArray(payload)
  ) {
    return null;
  }

  if (payload.token_type !== expectedTokenType) {
    return null;
  }

  if (
    typeof payload.sub !== "string" ||
    payload.sub.length === 0 ||
    payload.sub !== payload.sub.trim()
  ) {
    return null;
  }

  if (
    typeof payload.jti !== "string" ||
    payload.jti.length === 0 ||
    payload.jti !== payload.jti.trim()
  ) {
    return null;
  }

  if (
    !Number.isSafeInteger(payload.iat) ||
    payload.iat <= 0 ||
    !Number.isSafeInteger(payload.exp) ||
    payload.exp <= 0 ||
    payload.exp <= payload.iat
  ) {
    return null;
  }

  const currentTime = Math.floor(Date.now() / 1000);

  if (
    payload.exp <= currentTime ||
    payload.iat > currentTime + CLOCK_SKEW_SECONDS
  ) {
    return null;
  }

  return payload;
};

module.exports = {
  createJwt,
  verifyJwt,
};
