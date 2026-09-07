const validateEmail = require("./email.validator");

const validatePasswordResetRequest = (body = {}) => {
  const data = { email: null };
  const fields = {};

  const requestBody =
    body !== null &&
    typeof body === "object" &&
    !Array.isArray(body)
      ? body
      : {};

  const rawEmail = requestBody.email;

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
  } else if (typeof rawEmail === "string") {
    const email = rawEmail.trim().toLowerCase();

    if (validateEmail(email)) {
      data.email = email;
    } else {
      fields.email = [
        {
          code: "required",
          message: "This field is required.",
        },
      ];
    }
  } else {
    fields.email = [
      {
        code: "required",
        message: "This field is required.",
      },
    ];
  }

  return { data, fields };
};

module.exports = validatePasswordResetRequest;