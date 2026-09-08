const validateEmailChangeConfirm = (body = {}) => {
  const requestBody =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? body
      : {};
  const data = { key: null };
  const fields = {};
  const rawKey = requestBody.key;
  const keyMissing =
    rawKey === undefined ||
    rawKey === null ||
    (typeof rawKey === "string" && rawKey.trim() === "");

  if (keyMissing) {
    fields.key = [
      {
        code: "required",
        message: "This field is required.",
      },
    ];
  } else if (typeof rawKey !== "string") {
    fields.key = [
      {
        code: "invalid",
        message: "Invalid or expired confirmation key.",
      },
    ];
  } else {
    data.key = rawKey.trim();
  }

  return { data, fields };
};

module.exports = validateEmailChangeConfirm;
