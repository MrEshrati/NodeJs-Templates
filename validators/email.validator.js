const LOCAL_PART_PATTERN = /^[A-Za-z0-9!#$%&'*+\/=?^_`{|}~.-]+$/;
const DOMAIN_LABEL_PATTERN =
  /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?$/;

function isValidEmail(email) {
  if (typeof email !== "string") {
    return false;
  }

  const normalizedEmail = email.trim();

  if (normalizedEmail === "" || normalizedEmail.length > 254) {
    return false;
  }

  const atIndex = normalizedEmail.indexOf("@");

  if (atIndex < 1 || atIndex !== normalizedEmail.lastIndexOf("@")) {
    return false;
  }

  const localPart = normalizedEmail.slice(0, atIndex);
  const domain = normalizedEmail.slice(atIndex + 1);

  if (
    localPart.length > 64 ||
    domain.length === 0 ||
    domain.length > 253 ||
    !LOCAL_PART_PATTERN.test(localPart) ||
    localPart.startsWith(".") ||
    localPart.endsWith(".") ||
    localPart.includes("..")
  ) {
    return false;
  }

  const domainLabels = domain.split(".");

  if (domainLabels.length < 2) {
    return false;
  }

  if (!domainLabels.every((label) => DOMAIN_LABEL_PATTERN.test(label))) {
    return false;
  }

  const topLevelDomain = domainLabels.at(-1);

  return topLevelDomain.length >= 2 && /[A-Za-z]/.test(topLevelDomain);
}

module.exports = isValidEmail;
