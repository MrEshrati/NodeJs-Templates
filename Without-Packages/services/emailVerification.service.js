const tokenGenerator = require("../utils/token.utils");
const emailVerification = require("../models/emailVerificationToken.model");
const User = require("../models/user.model");

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

const confirmEmailAddress = async (key) => {
  const hashedToken = tokenGenerator.hashToken(key);
  const verificationToken = await emailVerification.findOneAndDelete({
    tokenHash: hashedToken,
    expiresAt: {
      $gt: new Date(),
    },
  });

  if (!verificationToken) {
    return {
      status: "invalid",
    };
  }

  const user = await User.findOneAndUpdate(
    {
      _id: verificationToken.user,
      isActive: true,
    },
    {
      $set: {
        emailVerified: true,
      },
    },
    {
      new: true,
      runValidators: true,
    }
  );

  if (!user){
    return {
      status: "unable",
    }
  }

  return {
    status: "verified",
    user,
  }
};

module.exports = {
  issueEmailVerificationToken,
  confirmEmailAddress,
};
