const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("../helpers/module");

const target = fromProject("services", "deviceToken.service.js");
const deviceTokenModel = fromProject("models", "deviceToken.model.js");
const mongooseModule = require.resolve("mongoose");
const SESSION = { id: "session-1" };
const REGISTERED_DEVICE_TOKEN = {
  _id: "device-token-1",
  user: "user-1",
  token: "token-1",
  platform: "ios",
};

const loadDeviceTokenService = ({
  registeredDeviceToken = REGISTERED_DEVICE_TOKEN,
  excessDeviceTokens = [],
  evictionDeletedCount = excessDeviceTokens.length,
  unregisterDeletedCount = 0,
  discardTransactionResult = false,
} = {}) => {
  const calls = {
    init: 0,
    transaction: 0,
    find: 0,
    deleteMany: 0,
    deleteOne: 0,
  };
  const service = loadWithMocks(target, {
    [mongooseModule]: {
      connection: {
        async transaction(callback) {
          calls.transaction += 1;
          const result = await callback(SESSION);
          return discardTransactionResult ? null : result;
        },
      },
    },
    [deviceTokenModel]: {
      async init() {
        calls.init += 1;
      },
      findOneAndUpdate(filter, update, options) {
        calls.upsert = { filter, update, options, lean: false };

        return {
          async lean() {
            calls.upsert.lean = true;
            return registeredDeviceToken;
          },
        };
      },
      find(filter) {
        calls.find += 1;
        calls.evictionQuery = { filter };

        return {
          sort(value) {
            calls.evictionQuery.sort = value;
            return this;
          },
          skip(value) {
            calls.evictionQuery.skip = value;
            return this;
          },
          select(value) {
            calls.evictionQuery.select = value;
            return this;
          },
          session(value) {
            calls.evictionQuery.session = value;
            return this;
          },
          async lean() {
            calls.evictionQuery.lean = true;
            return excessDeviceTokens;
          },
        };
      },
      async deleteMany(filter, options) {
        calls.deleteMany += 1;
        calls.evictionDelete = { filter, options };
        return { deletedCount: evictionDeletedCount };
      },
      async deleteOne(filter) {
        calls.deleteOne += 1;
        calls.unregisterFilter = filter;
        return { deletedCount: unregisterDeletedCount };
      },
    },
  });

  return { calls, service };
};

test("device registration initializes indexes and performs a transactional upsert", async () => {
  const { calls, service } = loadDeviceTokenService();

  assert.deepEqual(
    await service.registerDeviceToken({
      userId: "user-1",
      token: "token-1",
      platform: "ios",
    }),
    {
      status: "registered",
      deviceToken: REGISTERED_DEVICE_TOKEN,
    },
  );
  assert.equal(calls.init, 1);
  assert.equal(calls.transaction, 1);
  assert.deepEqual(calls.upsert, {
    filter: { token: "token-1" },
    update: {
      $set: {
        user: "user-1",
        platform: "ios",
      },
      $setOnInsert: { token: "token-1" },
    },
    options: {
      upsert: true,
      returnDocument: "after",
      runValidators: true,
      setDefaultsOnInsert: true,
      session: SESSION,
    },
    lean: true,
  });
  assert.deepEqual(calls.evictionQuery, {
    filter: {
      user: "user-1",
      _id: { $ne: REGISTERED_DEVICE_TOKEN._id },
    },
    sort: { updatedAt: -1, _id: -1 },
    skip: 19,
    select: "_id",
    session: SESSION,
    lean: true,
  });
  assert.equal(calls.deleteMany, 0);
});

test("device registration removes every excess token in the transaction", async () => {
  const excessDeviceTokens = [{ _id: "old-1" }, { _id: "old-2" }];
  const { calls, service } = loadDeviceTokenService({ excessDeviceTokens });

  await service.registerDeviceToken({
    userId: "user-2",
    token: "token-1",
    platform: "android",
  });

  assert.deepEqual(calls.upsert.update.$set, {
    user: "user-2",
    platform: "android",
  });
  assert.deepEqual(calls.evictionQuery.filter, {
    user: "user-2",
    _id: { $ne: REGISTERED_DEVICE_TOKEN._id },
  });
  assert.equal(calls.deleteMany, 1);
  assert.deepEqual(calls.evictionDelete, {
    filter: { _id: { $in: ["old-1", "old-2"] } },
    options: { session: SESSION },
  });
});

test("device registration rejects an incomplete eviction", async () => {
  const { service } = loadDeviceTokenService({
    excessDeviceTokens: [{ _id: "old-1" }, { _id: "old-2" }],
    evictionDeletedCount: 1,
  });

  await assert.rejects(
    service.registerDeviceToken({
      userId: "user-1",
      token: "token-1",
      platform: "ios",
    }),
    /Unexpected device-token eviction result/,
  );
});

test("device registration rejects missing database results", async () => {
  const missingRegistration = loadDeviceTokenService({
    registeredDeviceToken: null,
  });
  await assert.rejects(
    missingRegistration.service.registerDeviceToken({
      userId: "user-1",
      token: "token-1",
      platform: "ios",
    }),
    /Unexpected device-token registration result/,
  );
  assert.equal(missingRegistration.calls.find, 0);

  const missingTransaction = loadDeviceTokenService({
    discardTransactionResult: true,
  });
  await assert.rejects(
    missingTransaction.service.registerDeviceToken({
      userId: "user-1",
      token: "token-1",
      platform: "ios",
    }),
    /Unexpected device-token transaction result/,
  );
});

test("device unregistration is ownership-scoped and idempotent", async () => {
  for (const deletedCount of [0, 1]) {
    const { calls, service } = loadDeviceTokenService({
      unregisterDeletedCount: deletedCount,
    });

    assert.deepEqual(
      await service.unregisterDeviceToken({
        userId: "user-1",
        token: "token-1",
      }),
      { status: "unregistered" },
    );
    assert.equal(calls.deleteOne, 1);
    assert.deepEqual(calls.unregisterFilter, {
      user: "user-1",
      token: "token-1",
    });
  }
});

test("device unregistration rejects an impossible delete count", async () => {
  const { service } = loadDeviceTokenService({
    unregisterDeletedCount: 2,
  });

  await assert.rejects(
    service.unregisterDeviceToken({
      userId: "user-1",
      token: "token-1",
    }),
    /Unexpected device-token deletion result/,
  );
});
