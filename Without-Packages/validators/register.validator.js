const validateEmail = require("./emailValidator");
const validatePassword = require("./passwordValidator");

function validateRegistration(body = {}) {
  const fields = {};
  const requestBody = body || {};
  const rawEmail = requestBody.email;
  const password = requestBody.password;
  let email;

  const emailMissing =
    rawEmail === undefined || rawEmail === null || rawEmail === "";

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
  } else {
    const passwordErrors = validatePassword(password);

    if (passwordErrors.length > 0) {
      fields.password = passwordErrors;
    }
  }

  return {
    data: {
      email,
      password,
    },
    fields,
  };
}

module.exports = validateRegistration;
