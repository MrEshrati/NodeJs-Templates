const formatPaymentAmount = (amount, currency) => {
  if (!Number.isSafeInteger(amount) || amount < 0) {
    throw new TypeError("amount must be a non-negative safe integer.");
  }

  if (currency === "IRR") {
    return String(amount);
  }

  if (currency === "USD") {
    const amountInCents = BigInt(amount);
    const wholeDollars = amountInCents / 100n;
    const cents = String(amountInCents % 100n).padStart(2, "0");

    return `${wholeDollars}.${cents}`;
  }

  throw new TypeError("currency must be USD or IRR.");
};

const serializePayment = (payment) => ({
  id: String(payment._id),
  provider: payment.provider,
  external_id: payment.externalId,
  amount: payment.amount,
  amount_display: formatPaymentAmount(payment.amount, payment.currency),
  currency: payment.currency,
  status: payment.status,
  refunded_amount: payment.refundedAmount,
  provider_data: payment.providerData,
  created_at: payment.createdAt.toISOString(),
  updated_at: payment.updatedAt.toISOString(),
});

module.exports = {
  formatPaymentAmount,
  serializePayment,
};
