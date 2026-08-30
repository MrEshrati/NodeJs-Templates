const validateVerifyEmail = (body = {}) => {
  const fields = {};
  let keyValue = body.key;
  const keyMissing =
    keyValue === undefined || keyValue === null || keyValue === "";

  if (keyMissing) {
    fields.key = [
      {
        code: "required",
        message: "This field is required.",
      },
    ];
  } else if (typeof keyValue !== "string") {
    fields.key = [
      {
        code: "invalid",
        message: "Invalid or expired confirmation key.",
      },
    ];
  } else {
    keyValue = keyValue.trim();

    if (keyValue === "") {
      fields.key = [
        {
          code: "invalid",
          message: "Invalid or expired confirmation key.",
        },
      ];
    }
  }

  return {
    data: {
      key: keyValue,
    },
    fields,
  };
};

module.exports = validateVerifyEmail;
