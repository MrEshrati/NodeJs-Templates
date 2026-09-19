const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const otpCodeSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
      index: true,
    },
    codeHash: {
      type: String,
      required: true,
    },
    expiresAt: {
      type: Date,
      required: true,
      expires: 0,
    },
    failedAttempts: {
      type: Number,
      required: true,
      default: 0,
      min: 0,
      max: 5,
    },
    sentAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    consumedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

module.exports = mongoose.model("OtpCode", otpCodeSchema);
