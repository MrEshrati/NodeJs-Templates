const validateEmail = require("./email.validator");

const validateResendVerification = (body = {}) => {
  const fields = {};
  let email;
  const rawEmail = body.email;
  const missingEmail =
    rawEmail === undefined || rawEmail === "" || rawEmail === null;

  if (missingEmail) {
    fields.email = [
      {
        code: "required",
        message: "This field is required.",
      },
    ];
  } else if (typeof rawEmail !== "string") {
    fields.email = [
      {
        code: "invalid",
        message: "Enter a valid email address.",
      },
    ];
  } else {
    email = rawEmail.trim().toLowerCase();

    if (!validateEmail(email)) {
      fields.email = [
        {
          code: "invalid",
          message: "Enter a valid email address.",
        },
      ];
    }
  }

  return {
    data: {
      email,
    },
    fields,
  };
};

module.exports = validateResendVerification;