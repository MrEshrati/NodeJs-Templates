const validateGoogleLogin = (body = {}) => {
  const requestBody =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? body
      : {};
  const data = { id_token: null };
  const fields = {};
  const rawIdToken = requestBody.id_token;
  const idTokenMissing =
    rawIdToken === undefined ||
    rawIdToken === null ||
    (typeof rawIdToken === "string" && rawIdToken.trim() === "");

  if (idTokenMissing) {
    fields.id_token = [
      {
        code: "required",
        message: "This field is required.",
      },
    ];
  } else if (typeof rawIdToken !== "string") {
    fields.id_token = [
      {
        code: "invalid",
        message: "Invalid value",
      },
    ];
  } else {
    data.id_token = rawIdToken.trim();
  }

  return { data, fields };
};

module.exports = validateGoogleLogin;
