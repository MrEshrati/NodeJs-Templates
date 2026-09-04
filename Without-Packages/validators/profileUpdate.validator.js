const MAX_NAME_LENGTH = 150;

const NAME_FIELDS = [
  { requestKey: "first_name", dataKey: "firstName" },
  { requestKey: "last_name", dataKey: "lastName" },
];

const validateProfileUpdate = (body = {}) => {
  const data = {};
  const fields = {};
  const requestBody =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? body
      : {};

  for (const { requestKey, dataKey } of NAME_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(requestBody, requestKey)) {
      continue;
    }

    const rawValue = requestBody[requestKey];

    if (rawValue === null) {
      fields[requestKey] = [
        {
          code: "null",
          message: "This field may not be null.",
        },
      ];
      continue;
    }

    if (typeof rawValue !== "string") {
      fields[requestKey] = [
        {
          code: "invalid",
          message: "Not a valid string.",
        },
      ];
      continue;
    }

    const normalizedValue = rawValue.trim();

    if (normalizedValue.length > MAX_NAME_LENGTH) {
      fields[requestKey] = [
        {
          code: "max_length",
          message: "Ensure this field has no more than 150 characters.",
        },
      ];
      continue;
    }

    data[dataKey] = normalizedValue;
  }

  return { data, fields };
};

module.exports = validateProfileUpdate;