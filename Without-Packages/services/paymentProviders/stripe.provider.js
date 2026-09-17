const PaymentProviderError = require("../../errors/PaymentProviderError");

const STRIPE_PAYMENT_INTENTS_URL =
  "https://api.stripe.com/v1/payment_intents";
const DEFAULT_TIMEOUT_MS = 10_000;

const getRequiredString = (value, name) => {
  if (typeof value !== "string" || value.trim() === "") {
    throw new TypeError(`${name} must be a non-empty string.`);
  }

  return value.trim();
};

const assertCreateInput = (input) => {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new TypeError("input must be an object.");
  }

  if (!Number.isSafeInteger(input.amount) || input.amount < 1) {
    throw new TypeError("amount must be a positive safe integer.");
  }

  if (input.currency !== "USD") {
    throw new TypeError("the Stripe provider only supports USD.");
  }

  if (
    input.description !== undefined &&
    (typeof input.description !== "string" ||
      input.description.length > 500)
  ) {
    throw new TypeError("description must be a string of at most 500 characters.");
  }

  if (
    input.idempotencyKey !== undefined &&
    (typeof input.idempotencyKey !== "string" ||
      input.idempotencyKey.trim() === "" ||
      input.idempotencyKey.length < 1 ||
      input.idempotencyKey.length > 255)
  ) {
    throw new TypeError(
      "idempotencyKey must be a string from 1 to 255 characters.",
    );
  }
};

const getResponseRequestId = (response) => {
  const requestId = response.headers?.get?.("request-id");

  return typeof requestId === "string" && requestId !== ""
    ? requestId
    : null;
};

const getDiagnosticCode = (error) => {
  if (typeof error?.code === "string" && error.code !== "") {
    return error.code;
  }

  if (typeof error?.name === "string" && error.name !== "") {
    return error.name;
  }

  return null;
};

const assertResponse = (response) => {
  if (
    response === null ||
    typeof response !== "object" ||
    typeof response.text !== "function" ||
    typeof response.ok !== "boolean" ||
    !Number.isInteger(response.status) ||
    response.status < 100 ||
    response.status > 599
  ) {
    throw new PaymentProviderError("Stripe returned an invalid response.", {
      provider: "stripe",
      kind: "unreachable",
      diagnosticCode: "invalid_response",
    });
  }
};

const parseStripeResponse = async (response) => {
  let responseText;

  try {
    responseText = await response.text();
  } catch (error) {
    throw new PaymentProviderError("Could not read the Stripe response.", {
      provider: "stripe",
      kind: "unreachable",
      upstreamStatus:
        Number.isInteger(response.status) && response.status >= 100
          ? response.status
          : null,
      requestId: getResponseRequestId(response),
      diagnosticCode: getDiagnosticCode(error),
    });
  }

  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new PaymentProviderError("Stripe returned an invalid response.", {
      provider: "stripe",
      kind: "unreachable",
      upstreamStatus:
        Number.isInteger(response.status) && response.status >= 100
          ? response.status
          : null,
      requestId: getResponseRequestId(response),
      diagnosticCode: getDiagnosticCode(error),
    });
  }
};

const assertPaymentIntent = (paymentIntent, response) => {
  if (
    paymentIntent === null ||
    typeof paymentIntent !== "object" ||
    Array.isArray(paymentIntent) ||
    typeof paymentIntent.id !== "string" ||
    paymentIntent.id === "" ||
    typeof paymentIntent.client_secret !== "string" ||
    paymentIntent.client_secret === "" ||
    typeof paymentIntent.status !== "string" ||
    paymentIntent.status === ""
  ) {
    throw new PaymentProviderError("Stripe returned an invalid response.", {
      provider: "stripe",
      kind: "unreachable",
      upstreamStatus: response.status,
      requestId: getResponseRequestId(response),
      diagnosticCode: "invalid_payment_intent",
    });
  }
};

const createStripeProvider = ({
  secretKey,
  publishableKey,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const stripeSecretKey = getRequiredString(secretKey, "secretKey");
  const stripePublishableKey = getRequiredString(
    publishableKey,
    "publishableKey",
  );

  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function.");
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("timeoutMs must be a positive integer.");
  }

  const createPayment = async (input = {}) => {
    assertCreateInput(input);

    const requestBody = new URLSearchParams({
      amount: String(input.amount),
      currency: input.currency.toLowerCase(),
      "automatic_payment_methods[enabled]": "true",
    });

    if (input.description !== undefined && input.description !== "") {
      requestBody.set("description", input.description);
    }

    const headers = {
      Authorization: `Bearer ${stripeSecretKey}`,
      "Content-Type": "application/x-www-form-urlencoded",
    };

    if (input.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = input.idempotencyKey;
    }

    let response;

    try {
      response = await fetchImpl(STRIPE_PAYMENT_INTENTS_URL, {
        method: "POST",
        headers,
        body: requestBody,
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      throw new PaymentProviderError("Could not reach Stripe.", {
        provider: "stripe",
        kind: "unreachable",
        diagnosticCode: getDiagnosticCode(error),
      });
    }

    assertResponse(response);

    const responseBody = await parseStripeResponse(response);

    if (response.ok !== true) {
      const providerCode =
        typeof responseBody?.error?.code === "string"
          ? responseBody.error.code
          : null;

      throw new PaymentProviderError(
        "Stripe rejected the payment request.",
        {
          provider: "stripe",
          kind: "rejected",
          upstreamStatus: response.status,
          providerCode,
          requestId: getResponseRequestId(response),
        },
      );
    }

    assertPaymentIntent(responseBody, response);

    return {
      externalId: responseBody.id,
      providerData: {
        client_secret: responseBody.client_secret,
        payment_intent_status: responseBody.status,
      },
      checkout: {
        clientSecret: responseBody.client_secret,
        publishableKey: stripePublishableKey,
      },
    };
  };

  const getCheckout = (payment) => {
    if (
      payment === null ||
      typeof payment !== "object" ||
      Array.isArray(payment) ||
      payment.provider !== "stripe" ||
      payment.providerData === null ||
      typeof payment.providerData !== "object" ||
      Array.isArray(payment.providerData) ||
      typeof payment.providerData.client_secret !== "string" ||
      payment.providerData.client_secret === ""
    ) {
      throw new TypeError("payment must contain Stripe checkout data.");
    }

    return {
      clientSecret: payment.providerData.client_secret,
      publishableKey: stripePublishableKey,
    };
  };

  return {
    provider: "stripe",
    createPayment,
    getCheckout,
  };
};

module.exports = {
  createStripeProvider,
};
