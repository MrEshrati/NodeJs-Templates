const test = require("node:test");
const assert = require("node:assert/strict");
const {
  validateDeviceRegistration,
  validateDeviceUnregistration,
} = require("../../validators/deviceToken.validator");
const validateNotificationList = require(
  "../../validators/notificationList.validator",
);
const validateNotificationPreference = require(
  "../../validators/notificationPreference.validator",
);

test("notification-list validator applies safe defaults", () => {
  assert.deepEqual(validateNotificationList(), {
    data: {
      unread: false,
      pageSize: 20,
      cursor: null,
    },
    fields: {},
  });

  assert.deepEqual(validateNotificationList(null), {
    data: {
      unread: false,
      pageSize: 20,
      cursor: null,
    },
    fields: {},
  });
});

test("notification-list validator normalizes supported query values", () => {
  assert.deepEqual(
    validateNotificationList({
      unread: "true",
      page_size: "50",
      cursor: "cursor-value",
    }).data,
    {
      unread: true,
      pageSize: 50,
      cursor: "cursor-value",
    },
  );

  assert.equal(validateNotificationList({ unread: "1" }).data.unread, true);
  assert.equal(validateNotificationList({ unread: "yes" }).data.unread, false);
  assert.equal(
    validateNotificationList({ page_size: "101" }).data.pageSize,
    100,
  );
});

test("notification-list validator rejects unusable pagination values", () => {
  for (const pageSize of ["0", "-1", "1.5", "abc", 25, null]) {
    assert.equal(
      validateNotificationList({ page_size: pageSize }).data.pageSize,
      20,
    );
  }

  for (const cursor of ["", 42, null, [], {}]) {
    assert.equal(
      validateNotificationList({ cursor }).data.cursor,
      null,
    );
  }
});

test("notification-preference validator maps partial boolean updates", () => {
  assert.deepEqual(
    validateNotificationPreference({
      push_enabled: false,
      email_enabled: true,
      ignored: "value",
    }),
    {
      data: {
        pushEnabled: false,
        emailEnabled: true,
      },
      fields: {},
    },
  );

  assert.deepEqual(validateNotificationPreference({ push_enabled: true }), {
    data: { pushEnabled: true },
    fields: {},
  });
  assert.deepEqual(validateNotificationPreference({}), {
    data: {},
    fields: {},
  });
});

test("notification-preference validator rejects non-boolean values", () => {
  for (const value of ["true", 1, null, {}, []]) {
    const result = validateNotificationPreference({ push_enabled: value });

    assert.deepEqual(result.data, {});
    assert.equal(result.fields.push_enabled[0].code, "invalid");
  }
});

test("device registration validator accepts supported platforms", () => {
  assert.deepEqual(
    validateDeviceRegistration({ token: " token-value ", platform: "ios" }),
    {
      data: {
        token: " token-value ",
        platform: "ios",
      },
      fields: {},
    },
  );

  assert.equal(
    validateDeviceRegistration({ token: "token", platform: "android" })
      .data.platform,
    "android",
  );
});

test("device registration validator enforces its field contract", () => {
  const missing = validateDeviceRegistration({});
  assert.equal(missing.fields.token[0].code, "required");
  assert.equal(missing.fields.platform[0].code, "required");

  assert.equal(
    validateDeviceRegistration({ token: 123, platform: "ios" }).fields
      .token[0].code,
    "invalid",
  );
  assert.equal(
    validateDeviceRegistration({ token: "x".repeat(512), platform: "ios" })
      .fields.token,
    undefined,
  );
  assert.equal(
    validateDeviceRegistration({ token: "x".repeat(513), platform: "ios" })
      .fields.token[0].code,
    "max_length",
  );

  for (const platform of ["windows", "IOS", 1, {}, []]) {
    assert.equal(
      validateDeviceRegistration({ token: "token", platform }).fields
        .platform[0].code,
      "invalid_choice",
    );
  }
});

test("device unregistration validator reuses the token contract", () => {
  assert.deepEqual(
    validateDeviceUnregistration({ token: "token", ignored: "value" }),
    {
      data: { token: "token" },
      fields: {},
    },
  );
  assert.equal(
    validateDeviceUnregistration({}).fields.token[0].code,
    "required",
  );
  assert.equal(
    validateDeviceUnregistration({ token: 42 }).fields.token[0].code,
    "invalid",
  );
  assert.equal(
    validateDeviceUnregistration({ token: "x".repeat(513) }).fields.token[0]
      .code,
    "max_length",
  );
});
