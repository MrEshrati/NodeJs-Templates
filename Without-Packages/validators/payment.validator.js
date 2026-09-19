const MAX_DESCRIPTION_LENGTH = 500;
const MAX_IDEMPOTENCY_KEY_LENGTH = 255;
const OBJECT_ID_PATTERN = /^[a-fA-F0-9]{24}$/;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]+$/;

const PROVIDER_RULES = Object.freeze({
  stripe: Object.freeze({
    currency: "USD",
    outcomes: new Set(["succeeded", "failed", "refunded"]),
  }),
  zarinpal: Object.freeze({
    currency: "IRR",
    outcomes: new Set(["succeeded", "failed"]),
  }),
});

const getProviderRules = (provider) => {
  const rules = PROVIDER_RULES[provider];

  if (!rules) {
    throw new TypeError('provider must be "stripe" or "zarinpal".');
  }

  return rules;
};

const getRequestBody = (body) =>
  body !== null && typeof body === "object" && !Array.isArray(body)
    ? body
    : {};

const requiredError = () => ({
  code: "required",
  message: "This field is required.",
});

const validateAmount = (requestBody, data, fields) => {
  const rawAmount = requestBody.amount;

  if (rawAmount === undefined || rawAmount === null) {
    fields.amount = [requiredError()];
  } else if (!Number.isSafeInteger(rawAmount)) {
    fields.amount = [
      {
        code: "invalid",
        message: "A valid integer is required.",
      },
    ];
  } else if (rawAmount < 1) {
    fields.amount = [
      {
        code: "min_value",
        message: "Ensure this value is greater than or equal to 1.",
      },
    ];
  } else {
    data.amount = rawAmount;
  }
};

const validateCurrency = (
  requestBody,
  expectedCurrency,
  data,
  fields,
) => {
  const rawCurrency = requestBody.currency;
  const currencyMissing =
    rawCurrency === undefined ||
    rawCurrency === null ||
    (typeof rawCurrency === "string" && rawCurrency.trim() === "");

  if (currencyMissing) {
    fields.currency = [requiredError()];
    return;
  }

  if (typeof rawCurrency !== "string") {
    fields.currency = [
      {
        code: "invalid",
        message: "Not a valid string.",
      },
    ];
    return;
  }

  const currency = rawCurrency.trim().toUpperCase();

  if (currency !== expectedCurrency) {
    fields.currency = [
      {
        code: "invalid_choice",
        message: `Only ${expectedCurrency} is supported.`,
      },
    ];
    return;
  }

  data.currency = currency;
};

const validateDescription = (requestBody, data, fields) => {
  if (!Object.prototype.hasOwnProperty.call(requestBody, "description")) {
    return;
  }

  const rawDescription = requestBody.description;

  if (typeof rawDescription !== "string") {
    fields.description = [
      {
        code: "invalid",
        message: "Not a valid string.",
      },
    ];
    return;
  }

  const description = rawDescription.trim();

  if (description.length > MAX_DESCRIPTION_LENGTH) {
    fields.description = [
      {
        code: "max_length",
        message: "Ensure this field has no more than 500 characters.",
      },
    ];
    return;
  }

  if (description !== "") {
    data.description = description;
  }
};

const validateIdempotencyKey = (requestBody, data, fields) => {
  if (!Object.prototype.hasOwnProperty.call(requestBody, "idempotency_key")) {
    fields.idempotency_key = [requiredError()];
    return;
  }

  const rawIdempotencyKey = requestBody.idempotency_key;

  if (typeof rawIdempotencyKey !== "string") {
    fields.idempotency_key = [
      {
        code: "invalid",
        message: "Not a valid string.",
      },
    ];
    return;
  }

  const idempotencyKey = rawIdempotencyKey.trim();

  if (idempotencyKey === "") {
    fields.idempotency_key = [
      {
        code: "blank",
        message: "This field may not be blank.",
      },
    ];
  } else if (idempotencyKey.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    fields.idempotency_key = [
      {
        code: "max_length",
        message: "Ensure this field has no more than 255 characters.",
      },
    ];
  } else if (!IDEMPOTENCY_KEY_PATTERN.test(idempotencyKey)) {
    fields.idempotency_key = [
      {
        code: "invalid",
        message:
          "Use only letters, numbers, periods, underscores, tildes, and hyphens.",
      },
    ];
  } else {
    data.idempotencyKey = idempotencyKey;
  }
};

const createPaymentValidator = (provider) => {
  const { currency: expectedCurrency } = getProviderRules(provider);

  return (body = {}) => {
    const requestBody = getRequestBody(body);
    const data = {};
    const fields = {};

    validateAmount(requestBody, data, fields);
    validateCurrency(requestBody, expectedCurrency, data, fields);
    validateDescription(requestBody, data, fields);
    validateIdempotencyKey(requestBody, data, fields);

    return { data, fields };
  };
};

const validatePaymentId = (requestBody, data, fields) => {
  const rawPaymentId = requestBody.payment_id;
  const paymentIdMissing =
    rawPaymentId === undefined ||
    rawPaymentId === null ||
    (typeof rawPaymentId === "string" && rawPaymentId.trim() === "");

  if (paymentIdMissing) {
    fields.payment_id = [requiredError()];
  } else if (
    typeof rawPaymentId !== "string" ||
    !OBJECT_ID_PATTERN.test(rawPaymentId.trim())
  ) {
    fields.payment_id = [
      {
        code: "invalid",
        message: "Not a valid payment ID.",
      },
    ];
  } else {
    data.paymentId = rawPaymentId.trim().toLowerCase();
  }
};

const validateOutcome = (requestBody, outcomes, data, fields) => {
  const rawOutcome = requestBody.outcome;
  const outcomeMissing =
    rawOutcome === undefined ||
    rawOutcome === null ||
    (typeof rawOutcome === "string" && rawOutcome.trim() === "");

  if (outcomeMissing) {
    fields.outcome = [requiredError()];
    return;
  }

  if (typeof rawOutcome !== "string") {
    fields.outcome = [
      {
        code: "invalid",
        message: "Not a valid string.",
      },
    ];
    return;
  }

  const outcome = rawOutcome.trim();

  if (!outcomes.has(outcome)) {
    fields.outcome = [
      {
        code: "invalid_choice",
        message: `"${outcome}" is not a valid choice.`,
      },
    ];
    return;
  }

  data.outcome = outcome;
};

const createPaymentSimulationValidator = (provider) => {
  const { outcomes } = getProviderRules(provider);

  return (body = {}) => {
    const requestBody = getRequestBody(body);
    const data = {};
    const fields = {};

    validatePaymentId(requestBody, data, fields);
    validateOutcome(requestBody, outcomes, data, fields);

    return { data, fields };
  };
};

module.exports = {
  createPaymentSimulationValidator,
  createPaymentValidator,
};
