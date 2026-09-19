const validateEmail = require("./email.validator");

const validateLogin = (body = {}) => {
  const fields = {};
  const requestBody = body || {};

  const rawEmail = requestBody.email;
  const password = requestBody.password;
  let email;

  const emailMissing =
    rawEmail === undefined ||
    rawEmail === null ||
    (typeof rawEmail === "string" && rawEmail.trim() === "");

  if (emailMissing) {
    fields.non_field_errors = [
      {
        code: "invalid",
        message: 'Must include "email" and "password".',
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

  const passwordMissing =
    password === undefined || password === null || password === "";

  if (passwordMissing) {
    fields.password = [
      {
        code: "required",
        message: "This field is required.",
      },
    ];
  } else if (typeof password !== "string") {
    fields.password = [
      {
        code: "invalid",
        message: "Enter a valid password.",
      },
    ];
  }

  return {
    data: {
      email,
      password,
    },
    fields,
  };
};

module.exports = validateLogin;
