const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const target = fromProject(
  "services",
  "notificationPreference.service.js",
);
const preferenceModel = fromProject(
  "models",
  "notificationPreference.model.js",
);

const loadPreferenceService = () => {
  const calls = [];
  const preference = {
    _id: "preference-1",
    user: "user-1",
    pushEnabled: true,
    emailEnabled: true,
  };
  const service = loadWithMocks(target, {
    [preferenceModel]: {
      findOneAndUpdate(filter, update, options) {
        const call = { filter, update, options, lean: false };
        calls.push(call);

        return {
          async lean() {
            call.lean = true;
            return preference;
          },
        };
      },
    },
  });

  return { calls, preference, service };
};

test("preference retrieval lazily upserts the user's defaults", async () => {
  const { calls, preference, service } = loadPreferenceService();

  assert.deepEqual(await service.getNotificationPreferences("user-1"), {
    status: "retrieved",
    preference,
  });
  assert.deepEqual(calls[0], {
    filter: { user: "user-1" },
    update: { $setOnInsert: { user: "user-1" } },
    options: {
      upsert: true,
      returnDocument: "after",
      runValidators: true,
      setDefaultsOnInsert: true,
    },
    lean: true,
  });
});

test("preference updates preserve false and whitelist partial changes", async () => {
  const { calls, preference, service } = loadPreferenceService();

  assert.deepEqual(
    await service.updateNotificationPreferences("user-1", {
      pushEnabled: false,
      ignored: true,
    }),
    {
      status: "updated",
      preference,
    },
  );
  assert.deepEqual(calls[0].filter, { user: "user-1" });
  assert.deepEqual(calls[0].update, {
    $setOnInsert: { user: "user-1" },
    $set: { pushEnabled: false },
  });
  assert.equal(Object.hasOwn(calls[0].update.$set, "emailEnabled"), false);
  assert.equal(Object.hasOwn(calls[0].update.$set, "ignored"), false);
  assert.equal(calls[0].lean, true);
});

test("preference updates can change both supported channels", async () => {
  const { calls, service } = loadPreferenceService();

  await service.updateNotificationPreferences("user-1", {
    pushEnabled: false,
    emailEnabled: false,
  });

  assert.deepEqual(calls[0].update.$set, {
    pushEnabled: false,
    emailEnabled: false,
  });
});

test("preference updates treat unusable or empty changes as lazy no-ops", async () => {
  const { calls, service } = loadPreferenceService();
  const changes = [undefined, null, [], "invalid", {}, { ignored: true }];

  for (const value of changes) {
    const result = await service.updateNotificationPreferences(
      "user-1",
      value,
    );

    assert.equal(result.status, "updated");
  }

  assert.equal(calls.length, changes.length);

  for (const call of calls) {
    assert.deepEqual(call.filter, { user: "user-1" });
    assert.deepEqual(call.update, {
      $setOnInsert: { user: "user-1" },
    });
    assert.equal(Object.hasOwn(call.update, "$set"), false);
    assert.equal(call.options.upsert, true);
    assert.equal(call.lean, true);
  }
});
