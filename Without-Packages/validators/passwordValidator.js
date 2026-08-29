const commonPasswords = new Set([
  "password",
  "password123",
  "12345678",
  "123456789",
  "qwerty123",
  "letmein",
]);

function isEntirelyNumeric(password) {
  if (password.length === 0) {
    return false;
  }

  for (const character of password) {
    if (character < "0" || character > "9") {
      return false;
    }
  }

  return true;
}

function validatePassword(password) {
  const errors = [];

  if (password.length < 8) {
    errors.push({
      code: "password_too_short",
      message: "This password is too short. It must contain at least 8 characters.",
    });
  }

  if (isEntirelyNumeric(password)) {
    errors.push({
      code: "password_entirely_numeric",
      message: "This password is entirely numeric.",
    });
  }

  if (commonPasswords.has(password.toLowerCase())) {
    errors.push({
      code: "password_too_common",
      message: "This password is too common.",
    });
  }

  if (Buffer.byteLength(password, "utf8") > 72) {
    errors.push({
      code: "password_too_long",
      message: "This password is too long.",
    });
  }

  return errors;
}

module.exports = validatePassword;
