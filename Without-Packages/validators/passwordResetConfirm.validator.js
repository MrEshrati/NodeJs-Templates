const validatePassword = require("./password.validator");

const validatePasswordResetConfirm = (body = {}) => {
  const data = { uid: null, token: null, new_password: null };
  const fields = {};
  const requestBody =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? body
      : {};

  const rawUid = requestBody.uid;
  const rawToken = requestBody.token;
  const password = requestBody.new_password;

  const uidMissing =
    rawUid === undefined ||
    rawUid === null ||
    (typeof rawUid === "string" && rawUid.trim() === "");

  if (uidMissing) {
    fields.uid = [
      {
        code: "required",
        message: "This field is required.",
      },
    ];
  } else if (
    typeof rawUid !== "string" ||
    !/^[a-fA-F0-9]{24}$/.test(rawUid.trim())
  ) {
    fields.uid = [
      {
        code: "invalid",
        message: "Invalid value",
      },
    ];
  } else {
    data.uid = rawUid.trim();
  }

  const tokenMissing =
    rawToken === undefined ||
    rawToken === null ||
    (typeof rawToken === "string" && rawToken.trim() === "");

  if (tokenMissing) {
    fields.token = [
      {
        code: "required",
        message: "This field is required.",
      },
    ];
  } else if (typeof rawToken === "string") {
    data.token = rawToken.trim();
  }

  const passwordMissing =
    password === undefined || password === null || password === "";

  if (passwordMissing) {
    fields.new_password = [
      {
        code: "required",
        message: "This field is required.",
      },
    ];
  } else if (typeof password !== "string") {
    fields.new_password = [
      {
        code: "invalid",
        message: "Invalid value",
      },
    ];
  } else {
    data.new_password = password;
    const passwordErrors = validatePassword(password);

    if (passwordErrors.length > 0) {
      fields.new_password = passwordErrors.map((error) => ({
        code: "invalid",
        message: error.message,
      }));
    }
  }

  return { data, fields };
};

module.exports = validatePasswordResetConfirm;
