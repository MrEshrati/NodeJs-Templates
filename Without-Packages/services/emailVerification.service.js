const tokenGenerator = require("../utils/token.utils");
const emailVerification = require("../models/emailVerificationToken.model");

const issueEmailVerificationToken = async (userId) => {
  const token = tokenGenerator.generateToken();
  const hashedToken = tokenGenerator.hashToken(token);
  const expireTime = new Date(Date.now() + 60 * 60 * 1000);

  await emailVerification.findOneAndUpdate(
    { user: userId },
    {
      $set: {
        tokenHash: hashedToken,
        expiresAt: expireTime,
      },
    },
    { upsert: true, runValidators: true },
  );

  return {
    token,
    expiresAt: expireTime,
  };
};

module.exports = {
  issueEmailVerificationToken,
};
