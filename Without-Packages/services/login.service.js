const bcrypt = require("bcrypt");
const User = require("../models/user.model");
const { issueTokenPair } = require("./token.service");
const {
  getLoginThrottleStatus,
  recordFailedLogin,
  clearLoginFailures,
} = require("./loginThrottle.service");

const DUMMY_PASSWORD_HASH =
  "$2b$12$sBBZBZGVKaVukz5bYE.lseIX7FmRqxeunErYXFefhKkLLw9jXzTQ6";

const authenticateUser = async (email, password) => {
  const throttle = await getLoginThrottleStatus(email);

  if (throttle.blocked) {
    return { status: "login_throttled" };
  }

  const user = await User.findOne({ email });
  const hasStoredPassword =
    typeof user?.password === "string" && user.password.length > 0;

  const comparisonHash = hasStoredPassword
    ? user.password
    : DUMMY_PASSWORD_HASH;

  const passwordWithinBcryptLimit = Buffer.byteLength(password, "utf8") <= 72;

  const passwordMatches = await bcrypt.compare(password, comparisonHash);

  if (
    !user ||
    !hasStoredPassword ||
    !passwordMatches ||
    !passwordWithinBcryptLimit
  ) {
    const throttle = await recordFailedLogin(email);
    if (throttle.blocked) {
      return { status: "login_throttled" };
    }
    return { status: "invalid_credentials" };
  }

  await clearLoginFailures(email);

  if (!user.isActive) {
    return { status: "account_disabled" };
  }

  if (!user.emailVerified) {
    return { status: "email_not_verified" };
  }

  const tokens = await issueTokenPair(user._id);
  return {
    status: "authenticated",
    tokens,
  };
};

module.exports = { authenticateUser };
