const test = require("node:test");
const assert = require("node:assert/strict");
const {
  serializeDeviceToken,
  serializeNotification,
  serializeNotificationPreference,
} = require("../../utils/notification.utils");
const {
  decodeNotificationCursor,
  encodeNotificationCursor,
} = require("../../utils/notificationCursor.utils");

const OBJECT_ID = "abcdef0123456789abcdef01";
const CREATED_AT = new Date("2026-07-06T18:20:00.000Z");
const UPDATED_AT = new Date("2026-07-06T18:34:00.000Z");

const encodePayload = (payload) =>
  Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");

test("notification serializer returns the public unread shape", () => {
  const serialized = serializeNotification({
    _id: OBJECT_ID,
    user: "hidden-user",
    type: "payment_succeeded",
    title: "Payment received",
    body: "Your payment was successful.",
    data: { payment_id: "payment-1" },
    read: false,
    readAt: null,
    createdAt: CREATED_AT,
    updatedAt: UPDATED_AT,
  });

  assert.deepEqual(serialized, {
    id: OBJECT_ID,
    type: "payment_succeeded",
    title: "Payment received",
    body: "Your payment was successful.",
    data: { payment_id: "payment-1" },
    read: false,
    read_at: null,
    created_at: CREATED_AT.toISOString(),
  });
});

test("notification serializer formats a read timestamp", () => {
  const serialized = serializeNotification({
    _id: OBJECT_ID,
    type: "account_updated",
    title: "Account updated",
    body: "Your account was updated.",
    data: {},
    read: true,
    readAt: UPDATED_AT,
    createdAt: CREATED_AT,
  });

  assert.equal(serialized.read_at, UPDATED_AT.toISOString());
});

test("notification preference serializer preserves disabled channels", () => {
  assert.deepEqual(
    serializeNotificationPreference({
      _id: OBJECT_ID,
      user: "hidden-user",
      pushEnabled: false,
      emailEnabled: false,
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    }),
    {
      push_enabled: false,
      email_enabled: false,
    },
  );
});

test("device-token serializer omits ownership information", () => {
  assert.deepEqual(
    serializeDeviceToken({
      _id: OBJECT_ID,
      user: "hidden-user",
      token: "device-token",
      platform: "android",
      createdAt: CREATED_AT,
      updatedAt: UPDATED_AT,
    }),
    {
      id: OBJECT_ID,
      token: "device-token",
      platform: "android",
      created_at: CREATED_AT.toISOString(),
      updated_at: UPDATED_AT.toISOString(),
    },
  );
});

test("notification cursor round-trips both pagination directions", () => {
  for (const direction of ["next", "previous"]) {
    const cursor = encodeNotificationCursor({
      createdAt: CREATED_AT,
      id: OBJECT_ID.toUpperCase(),
      direction,
    });
    const decoded = decodeNotificationCursor(cursor);

    assert.deepEqual(decoded, {
      createdAt: CREATED_AT,
      id: OBJECT_ID,
      direction,
    });
  }

  const stringDateCursor = encodeNotificationCursor({
    createdAt: CREATED_AT.toISOString(),
    id: OBJECT_ID,
    direction: "next",
  });
  assert.equal(
    decodeNotificationCursor(stringDateCursor).createdAt.toISOString(),
    CREATED_AT.toISOString(),
  );
});

test("notification cursor encoding rejects invalid positions", () => {
  for (const createdAt of [undefined, null, "not-a-date", new Date("invalid")]) {
    assert.throws(
      () =>
        encodeNotificationCursor({
          createdAt,
          id: OBJECT_ID,
          direction: "next",
        }),
      TypeError,
    );
  }

  for (const id of [undefined, null, "short", "z".repeat(24)]) {
    assert.throws(
      () =>
        encodeNotificationCursor({
          createdAt: CREATED_AT,
          id,
          direction: "next",
        }),
      TypeError,
    );
  }

  for (const direction of [undefined, "forward", 1]) {
    assert.throws(
      () =>
        encodeNotificationCursor({
          createdAt: CREATED_AT,
          id: OBJECT_ID,
          direction,
        }),
      TypeError,
    );
  }
});

test("notification cursor decoding rejects malformed encodings", () => {
  const malformedJson = Buffer.from("not-json", "utf8").toString(
    "base64url",
  );

  for (const cursor of [
    null,
    42,
    "",
    "a".repeat(513),
    "invalid=padding",
    malformedJson,
    "Zh",
  ]) {
    assert.equal(decodeNotificationCursor(cursor), null);
  }
});

test("notification cursor decoding rejects invalid payloads", () => {
  const validPayload = {
    createdAt: CREATED_AT.toISOString(),
    id: OBJECT_ID,
    direction: "next",
  };
  const invalidPayloads = [
    null,
    [],
    {},
    { ...validPayload, createdAt: "not-a-date" },
    { ...validPayload, createdAt: "2026-07-06T18:20:00Z" },
    { ...validPayload, id: "invalid-id" },
    { ...validPayload, direction: "forward" },
    { id: OBJECT_ID, direction: "next" },
    { createdAt: CREATED_AT.toISOString(), direction: "next" },
  ];

  for (const payload of invalidPayloads) {
    assert.equal(decodeNotificationCursor(encodePayload(payload)), null);
  }
});
