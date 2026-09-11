const mongoose = require("mongoose");
const Schema = mongoose.Schema;

const notificationSchema = new Schema(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      immutable: true,
    },
    type: {
      type: String,
      trim: true,
      required: true,
    },
    title: {
      type: String,
      trim: true,
      required: true,
    },
    body: {
      type: String,
      trim: true,
      required: true,
    },
    data: {
      type: Schema.Types.Mixed,
      default: () => ({}),
    },
    read: {
      type: Boolean,
      required: true,
      default: false,
    },
    readAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

notificationSchema.index(
  { user: 1, createdAt: -1, _id: -1 },
  { name: "notification_feed_idx" },
);

notificationSchema.index(
  { user: 1, read: 1, createdAt: -1, _id: -1 },
  {
    name: "notification_unread_feed_idx",
    partialFilterExpression: { read: false },
  },
);

module.exports = mongoose.model("Notification", notificationSchema);
