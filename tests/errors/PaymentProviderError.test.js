const test = require("node:test");
const assert = require("node:assert/strict");
const PaymentProviderError = require("../../errors/PaymentProviderError");

test("PaymentProviderError stores rejected-payment metadata", () => {
  const error = new PaymentProviderError(
    "Stripe rejected the payment request.",
    {
      provider: "stripe",
      kind: "rejected",
      upstreamStatus: 402,
      providerCode: "card_declined",
      requestId: "req_1",
    },
  );

  assert.equal(error instanceof Error, true);
  assert.equal(error instanceof PaymentProviderError, true);
  assert.equal(error.name, "PaymentProviderError");
  assert.equal(error.message, "Stripe rejected the payment request.");
  assert.equal(error.provider, "stripe");
  assert.equal(error.kind, "rejected");
  assert.equal(error.upstreamStatus, 402);
  assert.equal(error.providerCode, "card_declined");
  assert.equal(error.requestId, "req_1");
  assert.equal(error.diagnosticCode, null);
});

test("PaymentProviderError stores unreachable-provider metadata", () => {
  const error = new PaymentProviderError("Could not reach ZarinPal.", {
    provider: "zarinpal",
    kind: "unreachable",
    upstreamStatus: 503,
    providerCode: "server_unavailable",
    requestId: "request-1",
    diagnosticCode: "ECONNRESET",
  });

  assert.equal(error.name, "PaymentProviderError");
  assert.equal(error.provider, "zarinpal");
  assert.equal(error.kind, "unreachable");
  assert.equal(error.upstreamStatus, 503);
  assert.equal(error.providerCode, "server_unavailable");
  assert.equal(error.requestId, "request-1");
  assert.equal(error.diagnosticCode, "ECONNRESET");
});

test("PaymentProviderError defaults optional metadata to null", () => {
  const error = new PaymentProviderError("Provider is unavailable.", {
    provider: "stripe",
    kind: "unreachable",
  });

  assert.equal(error.upstreamStatus, null);
  assert.equal(error.providerCode, null);
  assert.equal(error.requestId, null);
  assert.equal(error.diagnosticCode, null);
});

test("PaymentProviderError accepts HTTP status boundaries", () => {
  for (const upstreamStatus of [100, 599]) {
    const error = new PaymentProviderError("Provider response.", {
      provider: "stripe",
      kind: "rejected",
      upstreamStatus,
    });

    assert.equal(error.upstreamStatus, upstreamStatus);
  }
});

test("PaymentProviderError rejects invalid providers", () => {
  for (const provider of [undefined, null, "", "   ", 1, {}, []]) {
    assert.throws(
      () =>
        new PaymentProviderError("Provider failure.", {
          provider,
          kind: "unreachable",
        }),
      /provider must be a non-empty string/,
    );
  }
});

test("PaymentProviderError rejects unsupported error kinds", () => {
  for (const kind of [undefined, null, "", "timeout", "REJECTED", 1]) {
    assert.throws(
      () =>
        new PaymentProviderError("Provider failure.", {
          provider: "stripe",
          kind,
        }),
      /kind must be "rejected" or "unreachable"/,
    );
  }
});

test("PaymentProviderError rejects invalid upstream statuses", () => {
  for (const upstreamStatus of [
    99,
    600,
    -1,
    200.5,
    "500",
    false,
    Number.NaN,
    Number.POSITIVE_INFINITY,
  ]) {
    assert.throws(
      () =>
        new PaymentProviderError("Provider failure.", {
          provider: "stripe",
          kind: "rejected",
          upstreamStatus,
        }),
      /upstreamStatus must be a valid HTTP status/,
    );
  }
});

test("PaymentProviderError does not retain raw provider objects", () => {
  const rawError = new Error("socket details and credentials");
  const rawResponse = {
    body: "raw provider response",
    secret: "provider-secret",
  };
  const error = new PaymentProviderError("Could not reach Stripe.", {
    provider: "stripe",
    kind: "unreachable",
    diagnosticCode: "ECONNRESET",
    cause: rawError,
    rawResponse,
  });

  assert.equal(Object.hasOwn(error, "cause"), false);
  assert.equal(Object.hasOwn(error, "rawResponse"), false);
  assert.equal(JSON.stringify(error).includes("socket details"), false);
  assert.equal(JSON.stringify(error).includes("provider-secret"), false);
});
