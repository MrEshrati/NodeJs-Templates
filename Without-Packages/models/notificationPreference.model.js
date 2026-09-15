const mongoose = require("mongoose");

const Schema = mongoose.Schema;

const notificationPreferenceSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
      unique: true,
    },
    pushEnabled: {
      type: Boolean,
      required: true,
      default: true,
    },
    emailEnabled: {
      type: Boolean,
      required: true,
      default: true,
    },
  },
  { timestamps: true },
);

module.exports = mongoose.model(
  "NotificationPreference",
  notificationPreferenceSchema,
);
