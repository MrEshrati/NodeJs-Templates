const validateEmail = require("./email.validator");

const validateOtpRequest = (body = {}) => {
  const data = {};
  const fields = {};
  let email;
  const rawEmail = body.email;

  const emailMissing =
    rawEmail === undefined ||
    rawEmail === null ||
    (typeof rawEmail === "string" && rawEmail.trim() === "");

  if (emailMissing) {
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
    } else {
      data.email = email;
    }
  }

  return { data, fields };
};

module.exports = validateOtpRequest;
