function hasUppercase(password) {
  for (let i = 0; i < password.length; i++) {
    const ch = password[i];

    if (ch >= "A" && ch <= "Z") {
      return true;
    }
  }

  return false;
}

function hasLowercase(password) {
  for (let i = 0; i < password.length; i++) {
    const ch = password[i];

    if (ch >= "a" && ch <= "z") {
      return true;
    }
  }

  return false;
}

function hasNumber(password) {
  for (let i = 0; i < password.length; i++) {
    const ch = password[i];

    if (ch >= "0" && ch <= "9") {
      return true;
    }
  }

  return false;
}

function hasSpecialCharacter(password) {
  const specialChars = "!@#$%^&*()_-+=[]{}|;:'\",.<>/?`~";

  for (let i = 0; i < password.length; i++) {
    if (specialChars.includes(password[i])) {
      return true;
    }
  }

  return false;
}

function isValidPassword(password) {
  //check minimum 8 length
  if (password.length < 8 || password.length > 64) {
    return false;
  }

  //check if there is uppercase and lowercase and number and SC
  if (
    !hasUppercase(password) ||
    !hasLowercase(password) ||
    !hasNumber(password) ||
    !hasSpecialCharacter(password)
  ) {
    return false;
  }

  return true;
}

module.exports = isValidPassword;
