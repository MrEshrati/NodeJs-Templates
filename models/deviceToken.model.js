const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const deviceTokenSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    token: {
      type: String,
      required: true,
      unique: true,
      immutable: true,
      maxlength: 512,
    },
    platform: {
      type: String,
      required: true,
      enum: ["ios", "android"],
    },
  },
  { timestamps: true },
);

deviceTokenSchema.index(
  { user: 1, updatedAt: 1, _id: 1 },
  { name: "device_token_eviction_idx" },
);

module.exports = mongoose.model("DeviceToken", deviceTokenSchema);
