const validateAccountDelete = (body = {}) => {
  const data = { password: null, code: null };
  const fields = {};

  const requestBody =
    body !== null && typeof body === "object" && !Array.isArray(body)
      ? body
      : {};

  if (!requestBody) {
    return {};
  }

  const password = requestBody.password;
  const code = requestBody.code;
  
  if (typeof password === "string") {
    data.password = password;
  }

  if (typeof code === "string") {
    data.code = code;
  }
  
  const passwordMissing = data.password === null || data.password === "";
  const codeMissing = data.code === null || data.code === "";

  if (passwordMissing && codeMissing) {
    fields.password = [
      {
        code: "reauth_required",
        message: "Incorrect password.",
      },
    ];
  }


  return { data, fields };
};

module.exports = validateAccountDelete;
