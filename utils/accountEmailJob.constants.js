const ACCOUNT_EMAIL_JOB_TYPES = Object.freeze({
  PASSWORD_RESET: "password_reset",
  OTP_LOGIN: "otp_login",
  EMAIL_VERIFICATION: "email_verification",
});

const ACCOUNT_EMAIL_JOB_TYPE_VALUES = Object.freeze(
  Object.values(ACCOUNT_EMAIL_JOB_TYPES),
);

const ACCOUNT_EMAIL_JOB_STATUSES = Object.freeze({
  PENDING: "pending",
  PROCESSING: "processing",
});

const ACCOUNT_EMAIL_JOB_STATUS_VALUES = Object.freeze(
  Object.values(ACCOUNT_EMAIL_JOB_STATUSES),
);

module.exports = {
  ACCOUNT_EMAIL_JOB_TYPES,
  ACCOUNT_EMAIL_JOB_TYPE_VALUES,
  ACCOUNT_EMAIL_JOB_STATUSES,
  ACCOUNT_EMAIL_JOB_STATUS_VALUES,
};
