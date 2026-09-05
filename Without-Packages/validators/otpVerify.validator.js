const validateEmail = require("./email.validator");

const validateOtpVerify = (body = {}) => {
  const requestBody = body || {};
  const data = { email: null, code: null };
  const fields = {};

  const rawEmail = requestBody.email;
  const code = requestBody.code;

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
    }
  }

  const codeMissing = code === undefined || code === null || code === "";

  if (codeMissing) {
    fields.code = [
      {
        code: "required",
        message: "This field is required.",
      },
    ];
  } else if (typeof code === "string") {
    data.code = code;
  }

  return {
    data,
    fields,
  };
};

module.exports = validateOtpVerify;
