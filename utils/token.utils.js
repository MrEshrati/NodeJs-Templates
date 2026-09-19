const crypto = require("crypto");

const generateToken = () => {
  const randomBuffer = crypto.randomBytes(32);
  return randomBuffer.toString("base64url");
};

const hashToken = (token) => {
  const hash = crypto.createHash("sha256");
  return hash.update(token, "utf8").digest("hex");
};

module.exports = {
  generateToken,
  hashToken,
};
