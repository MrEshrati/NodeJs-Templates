const MAX_TOKEN_LENGTH = 512;
const SUPPORTED_PLATFORMS = new Set(["ios", "android"]);

const getRequestBody = (body) =>
  body !== null && typeof body === "object" && !Array.isArray(body)
    ? body
    : {};

const validateToken = (requestBody, data, fields) => {
  const rawToken = requestBody.token;
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
  } else if (typeof rawToken !== "string") {
    fields.token = [
      {
        code: "invalid",
        message: "Not a valid string.",
      },
    ];
  } else if (rawToken.length > MAX_TOKEN_LENGTH) {
    fields.token = [
      {
        code: "max_length",
        message: "Ensure this field has no more than 512 characters.",
      },
    ];
  } else {
    data.token = rawToken;
  }
};

const validateDeviceRegistration = (body = {}) => {
  const data = {};
  const fields = {};
  const requestBody = getRequestBody(body);

  validateToken(requestBody, data, fields);

  const rawPlatform = requestBody.platform;
  const platformMissing =
    rawPlatform === undefined ||
    rawPlatform === null ||
    (typeof rawPlatform === "string" && rawPlatform.trim() === "");

  if (platformMissing) {
    fields.platform = [
      {
        code: "required",
        message: "This field is required.",
      },
    ];
  } else if (!SUPPORTED_PLATFORMS.has(rawPlatform)) {
    fields.platform = [
      {
        code: "invalid_choice",
        message: `"${String(rawPlatform)}" is not a valid choice.`,
      },
    ];
  } else {
    data.platform = rawPlatform;
  }

  return { data, fields };
};

const validateDeviceUnregistration = (body = {}) => {
  const data = {};
  const fields = {};
  const requestBody = getRequestBody(body);

  validateToken(requestBody, data, fields);

  return { data, fields };
};

module.exports = {
  validateDeviceRegistration,
  validateDeviceUnregistration,
};
