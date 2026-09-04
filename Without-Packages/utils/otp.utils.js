const crypto = require("node:crypto");

const OTP_CODE_PATTERN = /^[0-9]{6}$/;
const OTP_HASH_PATTERN = /^[a-f0-9]{64}$/;
const OTP_HASH_CONTEXT = "otp-code:v1";

const getOtpSecret = () => {
  const secret = process.env.OTP_SECRET;

  if (typeof secret !== "string" || Buffer.byteLength(secret, "utf8") < 32) {
    throw new Error("OTP_SECRET must contain at least 32 bytes.");
  }

  return secret;
};

const normalizeUserId = (userId) => {
  const normalizedUserId =
    userId === undefined || userId === null ? "" : String(userId).trim();

  if (normalizedUserId === "") {
    throw new TypeError("userId must be a non-empty value.");
  }

  return normalizedUserId;
};

const createOtpHash = (normalizedUserId, code) =>
  crypto
    .createHmac("sha256", getOtpSecret())
    .update(OTP_HASH_CONTEXT, "ascii")
    .update("\0", "ascii")
    .update(normalizedUserId, "utf8")
    .update("\0", "ascii")
    .update(code, "ascii")
    .digest("hex");

const generateOtpCode = () => {
  const otpCode = crypto.randomInt(0, 1_000_000);
  return String(otpCode).padStart(6, "0");
};

const hashOtpCode = (userId, code) => {
  const normalizedUserId = normalizeUserId(userId);

  if (typeof code !== "string" || !OTP_CODE_PATTERN.test(code)) {
    throw new TypeError("code must contain exactly six ASCII digits.");
  }

  return createOtpHash(normalizedUserId, code);
};

const verifyOtpCodeHash = (userId, code, storedHash) => {
  const normalizedUserId = normalizeUserId(userId);

  if (
    typeof code !== "string" ||
    !OTP_CODE_PATTERN.test(code) ||
    typeof storedHash !== "string" ||
    !OTP_HASH_PATTERN.test(storedHash)
  ) {
    return false;
  }

  const actualHash = Buffer.from(createOtpHash(normalizedUserId, code), "hex");
  const expectedHash = Buffer.from(storedHash, "hex");

  return crypto.timingSafeEqual(actualHash, expectedHash);
};

module.exports = {
  generateOtpCode,
  hashOtpCode,
  verifyOtpCodeHash,
};
