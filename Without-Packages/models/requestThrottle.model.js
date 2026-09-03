const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const requestThrottleSchema = new Schema(
  {
    keyHmac: {
      type: String,
      required: true,
      unique: true,
      match: /^[a-f0-9]{64}$/,
    },
    requestCount: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      validate: {
        validator: Number.isInteger,
        message: "requestCount must be an integer.",
      },
    },
    windowStartedAt: {
      type: Date,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      expires: 0,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model("RequestThrottle", requestThrottleSchema);
