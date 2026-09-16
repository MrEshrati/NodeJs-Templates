const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const notificationTarget = fromProject(
  "services",
  "notification.service.js",
);
const actionTarget = fromProject(
  "services",
  "notificationAction.service.js",
);
const notificationModel = fromProject("models", "notification.model.js");
const NOTIFICATION_ID = "abcdef0123456789abcdef01";

test("notify persists its payload and returns a plain notification", async () => {
  let createdData;
  let converted = false;
  const plainNotification = {
    _id: NOTIFICATION_ID,
    user: "user-1",
    type: "payment_succeeded",
  };
  const { notify } = loadWithMocks(notificationTarget, {
    [notificationModel]: {
      async create(data) {
        createdData = data;
        return {
          toObject() {
            converted = true;
            return plainNotification;
          },
        };
      },
    },
  });

  const result = await notify({
    userId: "user-1",
    type: "payment_succeeded",
    title: "Payment received",
    body: "Your payment was successful.",
    data: { paymentId: "payment-1" },
  });

  assert.deepEqual(createdData, {
    user: "user-1",
    type: "payment_succeeded",
    title: "Payment received",
    body: "Your payment was successful.",
    data: { paymentId: "payment-1" },
  });
  assert.equal(converted, true);
  assert.equal(result, plainNotification);
});

test("notify supplies independent empty data when it is omitted", async () => {
  const createdValues = [];
  const { notify } = loadWithMocks(notificationTarget, {
    [notificationModel]: {
      async create(data) {
        createdValues.push(data);
        return { toObject: () => data };
      },
    },
  });

  await notify({ userId: "user-1", type: "one", title: "One", body: "One" });
  await notify({ userId: "user-1", type: "two", title: "Two", body: "Two" });

  assert.deepEqual(createdValues[0].data, {});
  assert.deepEqual(createdValues[1].data, {});
  assert.notEqual(createdValues[0].data, createdValues[1].data);
});

test("notification deletion rejects invalid identifiers without a query", async () => {
  let queried = false;
  const { deleteNotification } = loadWithMocks(actionTarget, {
    [notificationModel]: {
      async deleteOne() {
        queried = true;
        return { deletedCount: 1 };
      },
    },
  });

  assert.deepEqual(
    await deleteNotification({ userId: "user-1", notificationId: "invalid" }),
    { status: "not_found" },
  );
  assert.equal(queried, false);
});

test("notification deletion is ownership-scoped and maps delete counts", async () => {
  let deletedCount = 1;
  let filter;
  const { deleteNotification } = loadWithMocks(actionTarget, {
    [notificationModel]: {
      async deleteOne(value) {
        filter = value;
        return { deletedCount };
      },
    },
  });
  const input = {
    userId: "user-1",
    notificationId: NOTIFICATION_ID,
  };

  assert.deepEqual(await deleteNotification(input), { status: "deleted" });
  assert.deepEqual(filter, {
    _id: NOTIFICATION_ID,
    user: "user-1",
  });

  deletedCount = 0;
  assert.deepEqual(await deleteNotification(input), { status: "not_found" });

  deletedCount = 2;
  await assert.rejects(
    deleteNotification(input),
    /Unexpected notification deletion result/,
  );
});

test("mark-all-read updates only the user's unread notifications", async () => {
  let modifiedCount = 3;
  let filter;
  let update;
  const { markAllNotificationsRead } = loadWithMocks(actionTarget, {
    [notificationModel]: {
      async updateMany(query, value) {
        filter = query;
        update = value;
        return { modifiedCount };
      },
    },
  });

  assert.deepEqual(await markAllNotificationsRead("user-1"), {
    status: "updated",
    markedRead: 3,
  });
  assert.deepEqual(filter, { user: "user-1", read: false });
  assert.equal(update.$set.read, true);
  assert.ok(update.$set.readAt instanceof Date);

  modifiedCount = 0;
  assert.deepEqual(await markAllNotificationsRead("user-1"), {
    status: "updated",
    markedRead: 0,
  });
});

test("mark-one-read rejects invalid identifiers without a query", async () => {
  let queried = false;
  const { markNotificationRead } = loadWithMocks(actionTarget, {
    [notificationModel]: {
      findOneAndUpdate() {
        queried = true;
        return { lean: async () => ({}) };
      },
    },
  });

  assert.deepEqual(
    await markNotificationRead({
      userId: "user-1",
      notificationId: "invalid",
    }),
    { status: "not_found" },
  );
  assert.equal(queried, false);
});

test("mark-one-read uses an idempotent ownership-scoped update pipeline", async () => {
  let filter;
  let update;
  let options;
  let returnedNotification = {
    _id: NOTIFICATION_ID,
    user: "user-1",
    read: true,
  };
  const { markNotificationRead } = loadWithMocks(actionTarget, {
    [notificationModel]: {
      findOneAndUpdate(query, value, settings) {
        filter = query;
        update = value;
        options = settings;
        return { lean: async () => returnedNotification };
      },
    },
  });
  const input = {
    userId: "user-1",
    notificationId: NOTIFICATION_ID,
  };

  assert.deepEqual(await markNotificationRead(input), {
    status: "updated",
    notification: returnedNotification,
  });
  assert.deepEqual(filter, {
    _id: NOTIFICATION_ID,
    user: "user-1",
  });
  assert.deepEqual(update, [
    {
      $set: {
        read: true,
        readAt: {
          $cond: [{ $eq: ["$read", false] }, "$$NOW", "$readAt"],
        },
        updatedAt: {
          $cond: [{ $eq: ["$read", false] }, "$$NOW", "$updatedAt"],
        },
      },
    },
  ]);
  assert.deepEqual(options, {
    returnDocument: "after",
    updatePipeline: true,
    timestamps: false,
  });

  returnedNotification = null;
  assert.deepEqual(await markNotificationRead(input), {
    status: "not_found",
  });
});
