const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");
const {
  decodeNotificationCursor,
  encodeNotificationCursor,
} = require("../../utils/notificationCursor.utils");

const target = fromProject("services", "notificationFeed.service.js");
const notificationModel = fromProject("models", "notification.model.js");

const notification = (suffix, timestamp) => ({
  _id: `0000000000000000000000${suffix}`,
  createdAt: new Date(timestamp),
  title: `Notification ${suffix}`,
});

const loadFeedService = ({ documents = [], count = 0 } = {}) => {
  const calls = { find: 0, count: 0 };
  const service = loadWithMocks(target, {
    [notificationModel]: {
      find(filter) {
        calls.find += 1;
        calls.filter = filter;

        return {
          sort(value) {
            calls.sort = value;
            return this;
          },
          limit(value) {
            calls.limit = value;
            return this;
          },
          async lean() {
            calls.lean = true;
            return [...documents];
          },
        };
      },
      async countDocuments(filter) {
        calls.count += 1;
        calls.countFilter = filter;
        return count;
      },
    },
  });

  return { calls, service };
};

test("notification feed rejects invalid page sizes before querying", async () => {
  const { calls, service } = loadFeedService();

  for (const pageSize of [undefined, null, "20", 0, -1, 1.5, 101]) {
    await assert.rejects(
      service.listNotifications({ userId: "user-1", pageSize }),
      /pageSize must be an integer from 1 to 100/,
    );
  }

  assert.equal(calls.find, 0);
});

test("notification feed rejects an invalid cursor before querying", async () => {
  const { calls, service } = loadFeedService();

  assert.deepEqual(
    await service.listNotifications({
      userId: "user-1",
      pageSize: 20,
      cursor: "invalid!",
    }),
    { status: "invalid_cursor" },
  );
  assert.equal(calls.find, 0);
});

test("notification feed returns a stable unread first page", async () => {
  const newest = notification("03", "2026-07-06T18:03:00.000Z");
  const middle = notification("02", "2026-07-06T18:02:00.000Z");
  const oldest = notification("01", "2026-07-06T18:01:00.000Z");
  const { calls, service } = loadFeedService({
    documents: [newest, middle, oldest],
  });

  const result = await service.listNotifications({
    userId: "user-1",
    unread: true,
    pageSize: 2,
  });

  assert.equal(result.status, "listed");
  assert.deepEqual(result.notifications, [newest, middle]);
  assert.deepEqual(calls.filter, { user: "user-1", read: false });
  assert.deepEqual(calls.sort, { createdAt: -1, _id: -1 });
  assert.equal(calls.limit, 3);
  assert.equal(calls.lean, true);
  assert.equal(result.previousCursor, null);
  assert.deepEqual(decodeNotificationCursor(result.nextCursor), {
    createdAt: middle.createdAt,
    id: middle._id,
    direction: "next",
  });
});

test("notification feed applies a next-page cursor", async () => {
  const anchor = notification("04", "2026-07-06T18:04:00.000Z");
  const first = notification("03", "2026-07-06T18:03:00.000Z");
  const second = notification("02", "2026-07-06T18:02:00.000Z");
  const cursor = encodeNotificationCursor({
    createdAt: anchor.createdAt,
    id: anchor._id,
    direction: "next",
  });
  const { calls, service } = loadFeedService({
    documents: [first, second],
  });

  const result = await service.listNotifications({
    userId: "user-1",
    pageSize: 2,
    cursor,
  });

  assert.deepEqual(calls.filter, {
    user: "user-1",
    $or: [
      { createdAt: { $lt: anchor.createdAt } },
      {
        createdAt: anchor.createdAt,
        _id: { $lt: anchor._id },
      },
    ],
  });
  assert.deepEqual(calls.sort, { createdAt: -1, _id: -1 });
  assert.deepEqual(result.notifications, [first, second]);
  assert.equal(result.nextCursor, null);
  assert.deepEqual(decodeNotificationCursor(result.previousCursor), {
    createdAt: first.createdAt,
    id: first._id,
    direction: "previous",
  });
});

test("notification feed reverses a previous-page database result", async () => {
  const anchor = notification("00", "2026-07-06T18:00:00.000Z");
  const closest = notification("01", "2026-07-06T18:01:00.000Z");
  const middle = notification("02", "2026-07-06T18:02:00.000Z");
  const extra = notification("03", "2026-07-06T18:03:00.000Z");
  const cursor = encodeNotificationCursor({
    createdAt: anchor.createdAt,
    id: anchor._id,
    direction: "previous",
  });
  const { calls, service } = loadFeedService({
    documents: [closest, middle, extra],
  });

  const result = await service.listNotifications({
    userId: "user-1",
    pageSize: 2,
    cursor,
  });

  assert.deepEqual(calls.filter, {
    user: "user-1",
    $or: [
      { createdAt: { $gt: anchor.createdAt } },
      {
        createdAt: anchor.createdAt,
        _id: { $gt: anchor._id },
      },
    ],
  });
  assert.deepEqual(calls.sort, { createdAt: 1, _id: 1 });
  assert.deepEqual(result.notifications, [middle, closest]);
  assert.deepEqual(decodeNotificationCursor(result.nextCursor), {
    createdAt: closest.createdAt,
    id: closest._id,
    direction: "next",
  });
  assert.deepEqual(decodeNotificationCursor(result.previousCursor), {
    createdAt: middle.createdAt,
    id: middle._id,
    direction: "previous",
  });
});

test("notification feed returns null cursors for an empty page", async () => {
  const { service } = loadFeedService();

  assert.deepEqual(
    await service.listNotifications({ userId: "user-1", pageSize: 20 }),
    {
      status: "listed",
      notifications: [],
      nextCursor: null,
      previousCursor: null,
    },
  );
});

test("unread count is scoped to the user's unread notifications", async () => {
  const { calls, service } = loadFeedService({ count: 7 });

  assert.deepEqual(await service.getUnreadNotificationCount("user-1"), {
    status: "counted",
    count: 7,
  });
  assert.equal(calls.count, 1);
  assert.deepEqual(calls.countFilter, {
    user: "user-1",
    read: false,
  });
});
