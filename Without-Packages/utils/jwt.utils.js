const crypto = require("crypto");

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

module.exports = {
  createJwt,
};