const PaymentProviderError = require("../../errors/PaymentProviderError");

const PAYMENT_REQUEST_URL =
  "https://api.zarinpal.com/pg/v4/payment/request.json";
const PAYMENT_VERIFY_URL =
  "https://api.zarinpal.com/pg/v4/payment/verify.json";
const START_PAY_URL = "https://payment.zarinpal.com/pg/StartPay";
const DEFAULT_DESCRIPTION = "Payment";
const DEFAULT_TIMEOUT_MS = 10_000;
const AUTHORITY_PATTERN = /^[A-Za-z0-9_-]{36}$/;
const SUCCESSFUL_VERIFICATION_CODES = new Set([100, 101]);

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

  if (input.currency !== "IRR") {
    throw new TypeError("the ZarinPal provider only supports IRR.");
  }

  if (
    input.description !== undefined &&
    (typeof input.description !== "string" ||
      input.description.length > 500)
  ) {
    throw new TypeError("description must be a string of at most 500 characters.");
  }
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
    throw new PaymentProviderError("ZarinPal returned an invalid response.", {
      provider: "zarinpal",
      kind: "unreachable",
      diagnosticCode: "invalid_response",
    });
  }
};

const getResponseRequestId = (response) => {
  const requestId =
    response.headers?.get?.("x-request-id") ??
    response.headers?.get?.("request-id");

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

const parseResponse = async (response) => {
  let responseText;

  try {
    responseText = await response.text();
  } catch (error) {
    throw new PaymentProviderError("Could not read the ZarinPal response.", {
      provider: "zarinpal",
      kind: "unreachable",
      upstreamStatus: response.status,
      requestId: getResponseRequestId(response),
      diagnosticCode: getDiagnosticCode(error),
    });
  }

  try {
    return JSON.parse(responseText);
  } catch (error) {
    throw new PaymentProviderError("ZarinPal returned an invalid response.", {
      provider: "zarinpal",
      kind: "unreachable",
      upstreamStatus: response.status,
      requestId: getResponseRequestId(response),
      diagnosticCode: getDiagnosticCode(error),
    });
  }
};

const getProviderCode = (responseBody) => {
  const rawCode = responseBody?.errors?.code ?? responseBody?.data?.code;

  if (typeof rawCode === "string" && rawCode.trim() !== "") {
    return rawCode.trim();
  }

  if (Number.isSafeInteger(rawCode)) {
    return String(rawCode);
  }

  return null;
};

const requestProvider = async ({ fetchImpl, timeoutMs, url, body }) => {
  let response;

  try {
    response = await fetchImpl(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "User-Agent": "Node.js API Template",
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (error) {
    throw new PaymentProviderError("Could not reach ZarinPal.", {
      provider: "zarinpal",
      kind: "unreachable",
      diagnosticCode: getDiagnosticCode(error),
    });
  }

  assertResponse(response);

  const responseBody = await parseResponse(response);

  if (response.status >= 500) {
    throw new PaymentProviderError("Could not reach ZarinPal.", {
      provider: "zarinpal",
      kind: "unreachable",
      upstreamStatus: response.status,
      providerCode: getProviderCode(responseBody),
      requestId: getResponseRequestId(response),
    });
  }

  return { response, responseBody };
};

const isValidAuthority = (value) =>
  typeof value === "string" && AUTHORITY_PATTERN.test(value);

const isValidReferenceId = (value) =>
  (Number.isSafeInteger(value) && value >= 0) ||
  (typeof value === "string" && /^[0-9]+$/.test(value));

const getSafeVerificationData = (data) => {
  const safeData = {};

  if (Number.isSafeInteger(data?.code)) {
    safeData.code = data.code;
  }

  if (isValidReferenceId(data?.ref_id)) {
    safeData.ref_id = data.ref_id;
  }

  if (
    typeof data?.card_pan === "string" &&
    data.card_pan.includes("*") &&
    /^[0-9*]+$/.test(data.card_pan) &&
    data.card_pan.length <= 32
  ) {
    safeData.card_pan = data.card_pan;
  }

  if (
    typeof data?.fee_type === "string" &&
    data.fee_type.length > 0 &&
    data.fee_type.length <= 64
  ) {
    safeData.fee_type = data.fee_type;
  }

  if (Number.isSafeInteger(data?.fee) && data.fee >= 0) {
    safeData.fee = data.fee;
  }

  return safeData;
};

const getSafeVerificationErrors = (errors) => {
  const rawCode = errors?.code;

  if (Number.isSafeInteger(rawCode)) {
    return { code: rawCode };
  }

  if (
    typeof rawCode === "string" &&
    rawCode.trim() !== "" &&
    rawCode.length <= 64
  ) {
    return { code: rawCode.trim() };
  }

  return {};
};

const assertPayment = (payment) => {
  if (
    payment === null ||
    typeof payment !== "object" ||
    Array.isArray(payment) ||
    payment.provider !== "zarinpal" ||
    !isValidAuthority(payment.externalId) ||
    !Number.isSafeInteger(payment.amount) ||
    payment.amount < 1 ||
    payment.currency !== "IRR" ||
    payment.providerData === null ||
    typeof payment.providerData !== "object" ||
    Array.isArray(payment.providerData)
  ) {
    throw new TypeError("payment must contain valid ZarinPal data.");
  }
};

const createZarinpalProvider = ({
  merchantId,
  callbackUrl,
  fetchImpl = globalThis.fetch,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) => {
  const zarinpalMerchantId = getRequiredString(merchantId, "merchantId");
  const zarinpalCallbackUrl = getRequiredString(callbackUrl, "callbackUrl");

  let parsedCallbackUrl;

  try {
    parsedCallbackUrl = new URL(zarinpalCallbackUrl);
  } catch {
    throw new TypeError("callbackUrl must be a valid HTTP or HTTPS URL.");
  }

  if (
    (parsedCallbackUrl.protocol !== "http:" &&
      parsedCallbackUrl.protocol !== "https:") ||
    parsedCallbackUrl.username !== "" ||
    parsedCallbackUrl.password !== ""
  ) {
    throw new TypeError("callbackUrl must be a valid HTTP or HTTPS URL.");
  }

  if (typeof fetchImpl !== "function") {
    throw new TypeError("fetchImpl must be a function.");
  }

  if (!Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw new TypeError("timeoutMs must be a positive integer.");
  }

  const createPayment = async (input = {}) => {
    assertCreateInput(input);

    const description =
      typeof input.description === "string" && input.description.trim() !== ""
        ? input.description.trim()
        : DEFAULT_DESCRIPTION;
    const { response, responseBody } = await requestProvider({
      fetchImpl,
      timeoutMs,
      url: PAYMENT_REQUEST_URL,
      body: {
        merchant_id: zarinpalMerchantId,
        amount: input.amount,
        callback_url: zarinpalCallbackUrl,
        description,
      },
    });
    const authority = responseBody?.data?.authority;

    if (
      response.ok !== true ||
      responseBody?.data?.code !== 100 ||
      !isValidAuthority(authority)
    ) {
      throw new PaymentProviderError(
        "ZarinPal rejected the payment request.",
        {
          provider: "zarinpal",
          kind: "rejected",
          upstreamStatus: response.status,
          providerCode: getProviderCode(responseBody),
          requestId: getResponseRequestId(response),
        },
      );
    }

    const redirectUrl = `${START_PAY_URL}/${authority}`;

    return {
      externalId: authority,
      providerData: {
        redirect_url: redirectUrl,
      },
      checkout: {
        redirectUrl,
      },
    };
  };

  const getCheckout = (payment) => {
    assertPayment(payment);

    const expectedRedirectUrl = `${START_PAY_URL}/${payment.externalId}`;

    if (payment.providerData.redirect_url !== expectedRedirectUrl) {
      throw new TypeError("payment must contain ZarinPal checkout data.");
    }

    return { redirectUrl: expectedRedirectUrl };
  };

  const verifyPayment = async (payment) => {
    assertPayment(payment);

    const { response, responseBody } = await requestProvider({
      fetchImpl,
      timeoutMs,
      url: PAYMENT_VERIFY_URL,
      body: {
        merchant_id: zarinpalMerchantId,
        amount: payment.amount,
        authority: payment.externalId,
      },
    });
    const verificationCode = responseBody?.data?.code;
    const safeVerificationData = getSafeVerificationData(responseBody?.data);
    const safeVerificationErrors = getSafeVerificationErrors(
      responseBody?.errors,
    );

    if (
      response.ok === true &&
      SUCCESSFUL_VERIFICATION_CODES.has(verificationCode)
    ) {
      if (!isValidReferenceId(responseBody.data.ref_id)) {
        throw new PaymentProviderError(
          "ZarinPal returned an invalid response.",
          {
            provider: "zarinpal",
            kind: "unreachable",
            upstreamStatus: response.status,
            requestId: getResponseRequestId(response),
            diagnosticCode: "missing_reference_id",
          },
        );
      }

      return {
        status: "succeeded",
        refundedAmount: 0,
        providerData: {
          ...payment.providerData,
          ref_id: responseBody.data.ref_id,
          verify: {
            data: safeVerificationData,
            errors: {},
          },
        },
      };
    }

    if (getProviderCode(responseBody) === null) {
      throw new PaymentProviderError(
        "ZarinPal returned an invalid response.",
        {
          provider: "zarinpal",
          kind: "unreachable",
          upstreamStatus: response.status,
          requestId: getResponseRequestId(response),
          diagnosticCode: "missing_verification_code",
        },
      );
    }

    return {
      status: "failed",
      refundedAmount: 0,
      providerData: {
        ...payment.providerData,
        verify: {
          data: safeVerificationData,
          errors: safeVerificationErrors,
        },
      },
    };
  };

  return {
    provider: "zarinpal",
    createPayment,
    getCheckout,
    verifyPayment,
  };
};

module.exports = {
  createZarinpalProvider,
};
