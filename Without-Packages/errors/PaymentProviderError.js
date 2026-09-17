const ERROR_KINDS = new Set(["rejected", "unreachable"]);

class PaymentProviderError extends Error {
  constructor(
    message,
    {
      provider,
      kind,
      upstreamStatus = null,
      providerCode = null,
      requestId = null,
      diagnosticCode = null,
    } = {},
  ) {
    super(message);

    if (typeof provider !== "string" || provider.trim() === "") {
      throw new TypeError("provider must be a non-empty string.");
    }

    if (!ERROR_KINDS.has(kind)) {
      throw new TypeError('kind must be "rejected" or "unreachable".');
    }

    if (
      upstreamStatus !== null &&
      (!Number.isInteger(upstreamStatus) ||
        upstreamStatus < 100 ||
        upstreamStatus > 599)
    ) {
      throw new TypeError("upstreamStatus must be a valid HTTP status.");
    }

    this.name = "PaymentProviderError";
    this.provider = provider;
    this.kind = kind;
    this.upstreamStatus = upstreamStatus;
    this.providerCode = providerCode;
    this.requestId = requestId;
    this.diagnosticCode = diagnosticCode;
  }
}

module.exports = PaymentProviderError;
