const mongoose = require("mongoose");

const Schema = mongoose.Schema;
const IDEMPOTENCY_KEY_PATTERN = /^[A-Za-z0-9._~-]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const PROVIDER_REQUEST_KEY_PATTERN = /^payment_v1_[a-f0-9]{64}$/;

const paymentCreationSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    idempotencyKey: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      maxlength: 255,
      match: IDEMPOTENCY_KEY_PATTERN,
    },
    requestFingerprint: {
      type: String,
      required: true,
      immutable: true,
      match: SHA256_PATTERN,
    },
    provider: {
      type: String,
      required: true,
      immutable: true,
      enum: ["stripe", "zarinpal"],
    },
    providerRequestKey: {
      type: String,
      required: true,
      immutable: true,
      match: PROVIDER_REQUEST_KEY_PATTERN,
    },
    status: {
      type: String,
      required: true,
      enum: ["processing", "succeeded", "failed"],
      default: "processing",
    },
    payment: {
      type: Schema.Types.ObjectId,
      ref: "Payment",
      default: null,
    },
    failureKind: {
      type: String,
      enum: ["rejected", "unreachable"],
      default: null,
    },
    failureMessage: {
      type: String,
      trim: true,
      maxlength: 255,
      default: null,
    },
  },
  { timestamps: true },
);

paymentCreationSchema.index(
  { user: 1, idempotencyKey: 1 },
  { name: "payment_creation_user_key_uq", unique: true },
);

paymentCreationSchema.index(
  { status: 1, updatedAt: 1 },
  { name: "payment_creation_status_updated_idx" },
);

module.exports = mongoose.model("PaymentCreation", paymentCreationSchema);
