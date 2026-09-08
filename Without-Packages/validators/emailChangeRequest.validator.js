const validateEmail = require("./email.validator");

const validateEmailChangeRequest = (body = {}) => {
  const requestBody =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? body
      : {};
  const data = {
    new_email: null,
    password: null,
    code: null,
  };
  const fields = {};

  const rawNewEmail = requestBody.new_email;
  const newEmailMissing =
    rawNewEmail === undefined ||
    rawNewEmail === null ||
    (typeof rawNewEmail === "string" && rawNewEmail.trim() === "");

  if (newEmailMissing) {
    fields.new_email = [
      {
        code: "required",
        message: "This field is required.",
      },
    ];
  } else if (typeof rawNewEmail !== "string") {
    fields.new_email = [
      {
        code: "invalid",
        message: "Enter a valid email address.",
      },
    ];
  } else {
    const newEmail = rawNewEmail.trim().toLowerCase();

    if (validateEmail(newEmail)) {
      data.new_email = newEmail;
    } else {
      fields.new_email = [
        {
          code: "invalid",
          message: "Enter a valid email address.",
        },
      ];
    }
  }

  const rawPassword = requestBody.password;
  const rawCode = requestBody.code;
  const passwordProvided =
    typeof rawPassword === "string" && rawPassword !== "";
  const codeProvided =
    typeof rawCode === "string" && rawCode.trim() !== "";

  if (
    rawPassword !== undefined &&
    rawPassword !== null &&
    rawPassword !== "" &&
    typeof rawPassword !== "string"
  ) {
    fields.password = [
      {
        code: "reauth_required",
        message: "Incorrect password.",
      },
    ];
  } else if (passwordProvided) {
    data.password = rawPassword;
  }

  if (
    rawCode !== undefined &&
    rawCode !== null &&
    rawCode !== "" &&
    typeof rawCode !== "string"
  ) {
    fields.code = [
      {
        code: "reauth_required",
        message: "Invalid or expired code.",
      },
    ];
  } else if (codeProvided) {
    data.code = rawCode.trim();
  }

  const invalidCredentialType = fields.password || fields.code;

  if (!passwordProvided && !codeProvided && !invalidCredentialType) {
    fields.non_field_errors = [
      {
        code: "reauth_required",
        message:
          "This action requires your password or an emailed sign-in code.",
      },
    ];
  }

  return { data, fields };
};

module.exports = validateEmailChangeRequest;
