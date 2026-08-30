function isValidEmail(email) {
  let trimedEmail = email.trim();
  const at_index = trimedEmail.indexOf("@");

  // check max valid length
  if (trimedEmail.length > 254) {
    return false;
  }

  // check index of @
  if (at_index == 0 || at_index == -1) {
    return false;
  }

  // check if there is more than one @
  if (at_index != trimedEmail.lastIndexOf("@")) {
    return false;
  }

  // spliting the before and after of prefix@domain in email
  const [prefix, domain] = trimedEmail.split("@");
  if (!prefix || !domain || prefix.length > 64 || domain.length > 253) {
    return false;
  }

  //check if the first and last char of prefix is alphabet or number
  if (prefix.startsWith(".") || prefix.endsWith(".") || prefix.includes("..")) {
    return false;
  }

  // spliting the before and after leftSide.domainExtension in email
  const domainList = domain.split(".");
  if (domainList.length != 2 || domainList[1].length < 2) {
    return false;
  }

  return true;
}

module.exports = isValidEmail;
