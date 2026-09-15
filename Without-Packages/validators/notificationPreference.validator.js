const PREFERENCE_FIELDS = [
  { requestKey: "push_enabled", dataKey: "pushEnabled" },
  { requestKey: "email_enabled", dataKey: "emailEnabled" },
];

const validateNotificationPreference = (body = {}) => {
  const data = {};
  const fields = {};
  const requestBody =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? body
      : {};

  for (const { requestKey, dataKey } of PREFERENCE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(requestBody, requestKey)) {
      continue;
    }

    const rawValue = requestBody[requestKey];

    if (typeof rawValue !== "boolean") {
      fields[requestKey] = [
        {
          code: "invalid",
          message: "Must be a valid boolean.",
        },
      ];
      continue;
    }

    data[dataKey] = rawValue;
  }

  return { data, fields };
};

module.exports = validateNotificationPreference;
