const mongoose = require("mongoose");

const Schema = mongoose.Schema;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]+$/;

const isSafeNonNegativeInteger = (value) =>
  Number.isSafeInteger(value) && value >= 0;

const paymentSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    provider: {
      type: String,
      required: true,
      immutable: true,
      enum: ["stripe", "zarinpal"],
    },
    externalId: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: 255,
    },
    amount: {
      type: Number,
      required: true,
      immutable: true,
      min: 1,
      validate: {
        validator: Number.isSafeInteger,
        message: "Amount must be a safe integer.",
      },
    },
    currency: {
      type: String,
      required: true,
      immutable: true,
      enum: ["USD", "IRR"],
    },
    description: {
      type: String,
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      required: true,
      enum: ["pending", "succeeded", "failed", "refunded"],
      default: "pending",
    },
    refundedAmount: {
      type: Number,
      required: true,
      default: 0,
      validate: {
        validator: isSafeNonNegativeInteger,
        message: "Refunded amount must be a non-negative safe integer.",
      },
    },
    providerData: {
      type: Schema.Types.Mixed,
      default: () => ({}),
      validate: {
        validator: (value) =>
          value !== null && typeof value === "object" && !Array.isArray(value),
        message: "Provider data must be an object.",
      },
    },
    idempotencyKey: {
      type: String,
      immutable: true,
      trim: true,
      maxlength: 255,
      match: IDEMPOTENCY_KEY_PATTERN,
      validate: {
        validator: (value) => value === undefined || value.length > 0,
        message: "Idempotency key cannot be blank.",
      },
    },
  },
  { timestamps: true },
);

paymentSchema.index(
  { provider: 1, externalId: 1 },
  { name: "payment_provider_external_id_uq", unique: true },
);

paymentSchema.index(
  { user: 1, idempotencyKey: 1 },
  {
    name: "payment_user_idempotency_key_uq",
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  },
);

paymentSchema.index(
  { user: 1, createdAt: -1, _id: -1 },
  { name: "payment_user_created_idx" },
);

module.exports = mongoose.model("Payment", paymentSchema);
