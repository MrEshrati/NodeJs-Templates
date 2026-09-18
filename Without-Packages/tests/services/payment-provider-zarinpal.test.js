const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject } = require("../helpers/module");

const { createZarinpalProvider } = require(
  fromProject(
    "services",
    "paymentProviders",
    "zarinpal.provider.js",
  ),
);
const PaymentProviderError = require(
  fromProject("errors", "PaymentProviderError.js"),
);

const PAYMENT_REQUEST_URL =
  "https://api.zarinpal.com/pg/v4/payment/request.json";
const PAYMENT_VERIFY_URL =
  "https://api.zarinpal.com/pg/v4/payment/verify.json";
const AUTHORITY = "A12345678901234567890123456789012345";
const REDIRECT_URL =
  `https://payment.zarinpal.com/pg/StartPay/${AUTHORITY}`;

const createResponse = ({
  ok = true,
  status = 200,
  body = {
    data: { code: 100, authority: AUTHORITY },
    errors: {},
  },
  xRequestId = "req_zarinpal_1",
  requestId = null,
  textError,
} = {}) => ({
  ok,
  status,
  headers: {
    get(name) {
      if (name === "x-request-id") {
        return xRequestId;
      }

      if (name === "request-id") {
        return requestId;
      }

      return null;
    },
  },
  async text() {
    if (textError) {
      throw textError;
    }

    return typeof body === "string" ? body : JSON.stringify(body);
  },
});

const createProvider = (fetchImpl, overrides = {}) =>
  createZarinpalProvider({
    merchantId: "merchant-1",
    callbackUrl: "https://api.example/payments/callback",
    fetchImpl,
    timeoutMs: 2500,
    ...overrides,
  });

const createPayment = (overrides = {}) => ({
  provider: "zarinpal",
  externalId: AUTHORITY,
  amount: 50000,
  currency: "IRR",
  providerData: {
    redirect_url: REDIRECT_URL,
    existing: "preserved",
  },
  ...overrides,
});

test("ZarinPal provider validates construction options", () => {
  const fetchImpl = async () => createResponse();

  for (const merchantId of [undefined, null, "", "   ", 1]) {
    assert.throws(
      () =>
        createZarinpalProvider({
          merchantId,
          callbackUrl: "https://api.example/callback",
          fetchImpl,
        }),
      /merchantId must be a non-empty string/,
    );
  }

  for (const callbackUrl of [undefined, null, "", "   ", 1]) {
    assert.throws(
      () =>
        createZarinpalProvider({
          merchantId: "merchant-1",
          callbackUrl,
          fetchImpl,
        }),
      /callbackUrl must be a non-empty string/,
    );
  }

  for (const callbackUrl of [
    "not-a-url",
    "ftp://api.example/callback",
    "https://user:password@api.example/callback",
  ]) {
    assert.throws(
      () =>
        createZarinpalProvider({
          merchantId: "merchant-1",
          callbackUrl,
          fetchImpl,
        }),
      /callbackUrl must be a valid HTTP or HTTPS URL/,
    );
  }

  for (const invalidFetch of [null, {}, "fetch"]) {
    assert.throws(
      () =>
        createZarinpalProvider({
          merchantId: "merchant-1",
          callbackUrl: "https://api.example/callback",
          fetchImpl: invalidFetch,
        }),
      /fetchImpl must be a function/,
    );
  }

  for (const timeoutMs of [0, -1, 1.5, "1000", null]) {
    assert.throws(
      () =>
        createZarinpalProvider({
          merchantId: "merchant-1",
          callbackUrl: "https://api.example/callback",
          fetchImpl,
          timeoutMs,
        }),
      /timeoutMs must be a positive integer/,
    );
  }
});

test("ZarinPal payment creation sends the exact approved request", async () => {
  const calls = [];
  const provider = createZarinpalProvider({
    merchantId: "  merchant-1  ",
    callbackUrl: "  https://api.example/payments/callback  ",
    fetchImpl: async (url, options) => {
      calls.push({ url, options });
      return createResponse();
    },
    timeoutMs: 2500,
  });

  const result = await provider.createPayment({
    amount: 50000,
    currency: "IRR",
    description: "  Test order  ",
  });

  assert.equal(provider.provider, "zarinpal");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, PAYMENT_REQUEST_URL);
  assert.equal(calls[0].options.method, "POST");
  assert.deepEqual(calls[0].options.headers, {
    "Content-Type": "application/json",
    "User-Agent": "Without-Packages Payment API",
  });
  assert.deepEqual(JSON.parse(calls[0].options.body), {
    merchant_id: "merchant-1",
    amount: 50000,
    callback_url: "https://api.example/payments/callback",
    description: "Test order",
  });
  assert.equal(calls[0].options.signal instanceof AbortSignal, true);
  assert.equal(calls[0].options.signal.aborted, false);
  assert.deepEqual(result, {
    externalId: AUTHORITY,
    providerData: { redirect_url: REDIRECT_URL },
    checkout: { redirectUrl: REDIRECT_URL },
  });
});

test("ZarinPal payment creation applies its default description", async () => {
  const calls = [];
  const provider = createProvider(async (url, options) => {
    calls.push({ url, options });
    return createResponse();
  });

  for (const description of [undefined, "", "   "]) {
    await provider.createPayment({
      amount: 50000,
      currency: "IRR",
      description,
    });
  }

  assert.equal(calls.length, 3);

  for (const call of calls) {
    assert.equal(JSON.parse(call.options.body).description, "Payment");
  }
});

test("ZarinPal validates payment input before making a request", async () => {
  let fetchCalls = 0;
  const provider = createProvider(async () => {
    fetchCalls += 1;
    return createResponse();
  });

  for (const input of [null, [], "payment"]) {
    await assert.rejects(
      provider.createPayment(input),
      /input must be an object/,
    );
  }

  for (const amount of [undefined, 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    await assert.rejects(
      provider.createPayment({ amount, currency: "IRR" }),
      /amount must be a positive safe integer/,
    );
  }

  for (const currency of [undefined, "USD", "irr"]) {
    await assert.rejects(
      provider.createPayment({ amount: 50000, currency }),
      /ZarinPal provider only supports IRR/,
    );
  }

  for (const description of [null, 1, {}, "x".repeat(501)]) {
    await assert.rejects(
      provider.createPayment({
        amount: 50000,
        currency: "IRR",
        description,
      }),
      /description must be a string of at most 500 characters/,
    );
  }

  assert.equal(fetchCalls, 0);
});

test("ZarinPal checkout reconstruction validates stored payment data", () => {
  const provider = createProvider(async () => createResponse());

  assert.deepEqual(provider.getCheckout(createPayment()), {
    redirectUrl: REDIRECT_URL,
  });

  const invalidPayments = [
    null,
    [],
    {},
    createPayment({ provider: "stripe" }),
    createPayment({ externalId: "short" }),
    createPayment({ amount: 0 }),
    createPayment({ amount: 1.5 }),
    createPayment({ currency: "USD" }),
    createPayment({ providerData: null }),
    createPayment({ providerData: [] }),
    createPayment({ providerData: {} }),
  ];

  for (const invalidPayment of invalidPayments) {
    assert.throws(
      () => provider.getCheckout(invalidPayment),
      /payment must contain valid ZarinPal data|checkout data/,
    );
  }

  assert.throws(
    () =>
      provider.getCheckout(
        createPayment({
          providerData: { redirect_url: "https://example.com/wrong" },
        }),
      ),
    /payment must contain ZarinPal checkout data/,
  );
});

test("ZarinPal verification sends the exact request and accepts success codes", async () => {
  for (const verificationCode of [100, 101]) {
    const calls = [];
    const provider = createProvider(async (url, options) => {
      calls.push({ url, options });
      return createResponse({
        body: {
          data: {
            code: verificationCode,
            ref_id: verificationCode === 100 ? 123456789 : "987654321",
            card_pan: "502229******5995",
            fee_type: "Merchant",
            fee: 1000,
            unsafe_extra: "not-stored",
          },
          errors: {},
        },
      });
    });
    const payment = createPayment();
    const originalProviderData = { ...payment.providerData };
    const result = await provider.verifyPayment(payment);

    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, PAYMENT_VERIFY_URL);
    assert.equal(calls[0].options.method, "POST");
    assert.deepEqual(calls[0].options.headers, {
      "Content-Type": "application/json",
      "User-Agent": "Without-Packages Payment API",
    });
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      merchant_id: "merchant-1",
      amount: 50000,
      authority: AUTHORITY,
    });
    assert.equal(calls[0].options.signal instanceof AbortSignal, true);
    assert.equal(result.status, "succeeded");
    assert.equal(result.refundedAmount, 0);
    assert.equal(result.providerData.existing, "preserved");
    assert.equal(
      result.providerData.ref_id,
      verificationCode === 100 ? 123456789 : "987654321",
    );
    assert.deepEqual(result.providerData.verify, {
      data: {
        code: verificationCode,
        ref_id: verificationCode === 100 ? 123456789 : "987654321",
        card_pan: "502229******5995",
        fee_type: "Merchant",
        fee: 1000,
      },
      errors: {},
    });
    assert.equal(
      Object.hasOwn(result.providerData.verify.data, "unsafe_extra"),
      false,
    );
    assert.deepEqual(payment.providerData, originalProviderData);
  }
});

test("ZarinPal failed verification stores only sanitized fields", async () => {
  const provider = createProvider(async () =>
    createResponse({
      ok: false,
      status: 400,
      body: {
        data: {
          code: -51,
          ref_id: "not-numeric",
          card_pan: "5022291234565995",
          fee_type: "x".repeat(65),
          fee: -1,
        },
        errors: {
          code: "  -51  ",
          message: "Raw provider message that must not be stored",
          merchant_id: "merchant-1",
        },
      },
    }),
  );

  const result = await provider.verifyPayment(createPayment());

  assert.equal(result.status, "failed");
  assert.equal(result.refundedAmount, 0);
  assert.deepEqual(result.providerData.verify, {
    data: { code: -51 },
    errors: { code: "-51" },
  });
  assert.equal(
    JSON.stringify(result).includes("Raw provider message"),
    false,
  );
  assert.equal(JSON.stringify(result).includes("merchant-1"), false);
});

test("ZarinPal rejects missing successful references and verification codes", async () => {
  const missingReferenceProvider = createProvider(async () =>
    createResponse({
      body: { data: { code: 100 }, errors: {} },
      xRequestId: "req_missing_ref_1",
    }),
  );

  await assert.rejects(
    missingReferenceProvider.verifyPayment(createPayment()),
    (error) => {
      assert.equal(error instanceof PaymentProviderError, true);
      assert.equal(error.message, "ZarinPal returned an invalid response.");
      assert.equal(error.provider, "zarinpal");
      assert.equal(error.kind, "unreachable");
      assert.equal(error.upstreamStatus, 200);
      assert.equal(error.requestId, "req_missing_ref_1");
      assert.equal(error.diagnosticCode, "missing_reference_id");
      return true;
    },
  );

  const missingCodeProvider = createProvider(async () =>
    createResponse({
      body: { data: {}, errors: {} },
      xRequestId: null,
      requestId: "req_missing_code_1",
    }),
  );

  await assert.rejects(
    missingCodeProvider.verifyPayment(createPayment()),
    (error) => {
      assert.equal(error instanceof PaymentProviderError, true);
      assert.equal(error.message, "ZarinPal returned an invalid response.");
      assert.equal(error.kind, "unreachable");
      assert.equal(error.upstreamStatus, 200);
      assert.equal(error.requestId, "req_missing_code_1");
      assert.equal(error.diagnosticCode, "missing_verification_code");
      return true;
    },
  );
});

test("ZarinPal payment rejections expose only safe provider metadata", async () => {
  const provider = createProvider(async () =>
    createResponse({
      ok: false,
      status: 400,
      xRequestId: "req_rejected_1",
      body: {
        data: {},
        errors: {
          code: -9,
          message: "Raw rejection details must remain private",
          merchant_id: "merchant-1",
        },
      },
    }),
  );

  await assert.rejects(
    provider.createPayment({ amount: 50000, currency: "IRR" }),
    (error) => {
      assert.equal(error instanceof PaymentProviderError, true);
      assert.equal(error.message, "ZarinPal rejected the payment request.");
      assert.equal(error.provider, "zarinpal");
      assert.equal(error.kind, "rejected");
      assert.equal(error.upstreamStatus, 400);
      assert.equal(error.providerCode, "-9");
      assert.equal(error.requestId, "req_rejected_1");
      assert.equal(error.diagnosticCode, null);
      assert.equal(JSON.stringify(error).includes("Raw rejection"), false);
      assert.equal(JSON.stringify(error).includes("merchant-1"), false);
      return true;
    },
  );
});

test("ZarinPal server and transport failures become unreachable errors", async () => {
  const serverFailureProvider = createProvider(async () =>
    createResponse({
      ok: false,
      status: 503,
      xRequestId: "req_server_1",
      body: {
        data: {},
        errors: { code: "server_unavailable", message: "raw message" },
      },
    }),
  );

  await assert.rejects(
    serverFailureProvider.createPayment({ amount: 50000, currency: "IRR" }),
    (error) => {
      assert.equal(error.message, "Could not reach ZarinPal.");
      assert.equal(error.kind, "unreachable");
      assert.equal(error.upstreamStatus, 503);
      assert.equal(error.providerCode, "server_unavailable");
      assert.equal(error.requestId, "req_server_1");
      assert.equal(error.diagnosticCode, null);
      assert.equal(JSON.stringify(error).includes("raw message"), false);
      return true;
    },
  );

  const failures = [
    {
      error: Object.assign(new Error("socket reset"), {
        code: "ECONNRESET",
      }),
      diagnosticCode: "ECONNRESET",
    },
    {
      error: Object.assign(new Error("timed out"), {
        name: "TimeoutError",
      }),
      diagnosticCode: "TimeoutError",
    },
  ];

  for (const failure of failures) {
    const provider = createProvider(async () => {
      throw failure.error;
    });

    await assert.rejects(
      provider.createPayment({ amount: 50000, currency: "IRR" }),
      (error) => {
        assert.equal(error.message, "Could not reach ZarinPal.");
        assert.equal(error.provider, "zarinpal");
        assert.equal(error.kind, "unreachable");
        assert.equal(error.upstreamStatus, null);
        assert.equal(error.providerCode, null);
        assert.equal(error.requestId, null);
        assert.equal(error.diagnosticCode, failure.diagnosticCode);
        assert.equal(error.cause, undefined);
        return true;
      },
    );
  }
});

test("ZarinPal rejects invalid, unreadable, and malformed responses", async () => {
  const invalidResponses = [
    null,
    {},
    { ok: true, status: 200 },
    { ok: "true", status: 200, text: async () => "{}" },
    { ok: true, status: 99, text: async () => "{}" },
    { ok: true, status: 600, text: async () => "{}" },
  ];

  for (const response of invalidResponses) {
    const provider = createProvider(async () => response);

    await assert.rejects(
      provider.createPayment({ amount: 50000, currency: "IRR" }),
      (error) => {
        assert.equal(error instanceof PaymentProviderError, true);
        assert.equal(error.message, "ZarinPal returned an invalid response.");
        assert.equal(error.kind, "unreachable");
        assert.equal(error.diagnosticCode, "invalid_response");
        return true;
      },
    );
  }

  const unreadableProvider = createProvider(async () =>
    createResponse({
      status: 200,
      xRequestId: "req_unreadable_1",
      textError: Object.assign(new Error("read failed"), { code: "EPIPE" }),
    }),
  );
  await assert.rejects(
    unreadableProvider.createPayment({ amount: 50000, currency: "IRR" }),
    (error) => {
      assert.equal(error.message, "Could not read the ZarinPal response.");
      assert.equal(error.kind, "unreachable");
      assert.equal(error.upstreamStatus, 200);
      assert.equal(error.requestId, "req_unreadable_1");
      assert.equal(error.diagnosticCode, "EPIPE");
      return true;
    },
  );

  const malformedProvider = createProvider(async () =>
    createResponse({
      status: 200,
      xRequestId: "req_json_1",
      body: "not-json and merchant-1 must not escape",
    }),
  );
  await assert.rejects(
    malformedProvider.createPayment({ amount: 50000, currency: "IRR" }),
    (error) => {
      assert.equal(error.message, "ZarinPal returned an invalid response.");
      assert.equal(error.kind, "unreachable");
      assert.equal(error.upstreamStatus, 200);
      assert.equal(error.requestId, "req_json_1");
      assert.equal(error.diagnosticCode, "SyntaxError");
      assert.equal(JSON.stringify(error).includes("not-json"), false);
      assert.equal(JSON.stringify(error).includes("merchant-1"), false);
      return true;
    },
  );
});

test("ZarinPal verification rejects malformed stored payments before fetch", async () => {
  let fetchCalls = 0;
  const provider = createProvider(async () => {
    fetchCalls += 1;
    return createResponse();
  });
  const invalidPayments = [
    null,
    [],
    {},
    createPayment({ provider: "stripe" }),
    createPayment({ externalId: "short" }),
    createPayment({ amount: 0 }),
    createPayment({ currency: "USD" }),
    createPayment({ providerData: null }),
    createPayment({ providerData: [] }),
  ];

  for (const payment of invalidPayments) {
    await assert.rejects(
      provider.verifyPayment(payment),
      /payment must contain valid ZarinPal data/,
    );
  }

  assert.equal(fetchCalls, 0);
});
