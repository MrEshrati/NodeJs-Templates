const mongoose = require("mongoose");
const {
  ACCOUNT_EMAIL_JOB_TYPE_VALUES,
  ACCOUNT_EMAIL_JOB_STATUSES,
  ACCOUNT_EMAIL_JOB_STATUS_VALUES,
} = require("../utils/accountEmailJob.constants");

const Schema = mongoose.Schema;

const accountEmailJobSchema = new Schema(
  {
    type: {
      type: String,
      required: true,
      immutable: true,
      enum: ACCOUNT_EMAIL_JOB_TYPE_VALUES,
    },
    email: {
      type: String,
      required: true,
      immutable: true,
      trim: true,
      lowercase: true,
      maxlength: 254,
    },
    status: {
      type: String,
      required: true,
      enum: ACCOUNT_EMAIL_JOB_STATUS_VALUES,
      default: ACCOUNT_EMAIL_JOB_STATUSES.PENDING,
    },
    attempts: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "attempts must be an integer.",
      },
    },
    availableAt: {
      type: Date,
      required: true,
    },
    lockId: {
      type: String,
      default: null,
      match: /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
    },
    lockedUntil: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

accountEmailJobSchema.index(
  { status: 1, availableAt: 1, lockedUntil: 1, createdAt: 1, _id: 1 },
  { name: "account_email_job_claim_idx" },
);

accountEmailJobSchema.index(
  { expiresAt: 1 },
  { name: "account_email_job_expiry_idx", expireAfterSeconds: 0 },
);

module.exports = mongoose.model("AccountEmailJob", accountEmailJobSchema);
