const validatePassword = require("./password.validator");

const validatePasswordChange = (body = {}) => {
  const data = { old_password: null, new_password: null };
  const fields = {};
  const requestBody =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? body
      : {};

  const oldPassword = requestBody.old_password;
  const newPassword = requestBody.new_password;

  const oldPasswordMissing =
    oldPassword === undefined || oldPassword === null || oldPassword === "";

  if (oldPasswordMissing) {
    fields.old_password = [
      {
        code: "required",
        message: "This field is required.",
      },
    ];
  } else if (typeof oldPassword !== "string") {
    fields.old_password = [
      {
        code: "invalid",
        message:
          "Your old password was entered incorrectly. Please enter it again.",
      },
    ];
  } else {
    data.old_password = oldPassword;
  }

  const newPasswordMissing =
    newPassword === undefined || newPassword === null || newPassword === "";

  if (newPasswordMissing) {
    fields.new_password = [
      {
        code: "required",
        message: "This field is required.",
      },
    ];
  } else if (typeof newPassword !== "string") {
    fields.new_password = [
      {
        code: "invalid",
        message: "Invalid value",
      },
    ];
  } else {
    data.new_password = newPassword;
    const passwordErrors = validatePassword(newPassword);

    if (passwordErrors.length > 0) {
      fields.new_password = passwordErrors.map((error) => ({
        code: "invalid",
        message: error.message,
      }));
    }
  }

  return { data, fields };
};

module.exports = validatePasswordChange;
