const validateRefreshToken = (body = {}) => {
  const fields = {};
  const requestBody = body || {};
  const refresh = requestBody.refresh;

  const refreshMissing =
    refresh === undefined ||
    refresh === null ||
    refresh === "";

  if (refreshMissing) {
    fields.refresh = [{
      code: "required",
      message: "This field is required.",
    }];
  }

  return {
    data: { refresh },
    fields,
  };
};

module.exports = validateRefreshToken;
