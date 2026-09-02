const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const loginThrottleSchema = new Schema(
  {
    emailHmac: {
      type: String,
      required: true,
      unique: true,
      match: /^[a-f0-9]{64}$/,
    },
    failedAttempts: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "failedAttempts must be an integer.",
      },
    },
    windowStartedAt: {
      type: Date,
      required: true,
    },
    blockedUntil: {
      type: Date,
      default: null,
    },
    expiresAt: {
      type: Date,
      required: true,
      expires: 0,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("LoginThrottle", loginThrottleSchema);
