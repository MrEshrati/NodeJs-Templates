const test = require("node:test");
const assert = require("node:assert/strict");
const { fromProject, loadWithMocks } = require("./module");

const loadDatabaseHelper = (mongoose) =>
  loadWithMocks(fromProject("tests/helpers/database.js"), {
    [require.resolve("mongoose")]: mongoose,
  });

test("test database configuration accepts only a dedicated MongoDB database", () => {
  const helper = loadDatabaseHelper({});
  const config = helper.getTestDatabaseConfig({
    TEST_DB_URL:
      "  mongodb://127.0.0.1:27017/account_api_test?replicaSet=rs0  ",
  });

  assert.deepEqual(config, {
    databaseName: "account_api_test",
    databaseUrl:
      "mongodb://127.0.0.1:27017/account_api_test?replicaSet=rs0",
  });
});

test("test database configuration rejects unsafe targets", async (t) => {
  const helper = loadDatabaseHelper({});
  const cases = [
    ["missing URL", {}, /TEST_DB_URL environment variable is required/],
    ["invalid URL", { TEST_DB_URL: "not a URL" }, /valid MongoDB URL/],
    [
      "wrong protocol",
      { TEST_DB_URL: "https://localhost/account_api_test" },
      /valid MongoDB URL/,
    ],
    [
      "missing database",
      { TEST_DB_URL: "mongodb://127.0.0.1:27017" },
      /must end with "_test"/,
    ],
    [
      "development database",
      { TEST_DB_URL: "mongodb://127.0.0.1:27017/account-api" },
      /must end with "_test"/,
    ],
  ];

  for (const [name, environment, expectedError] of cases) {
    await t.test(name, () => {
      assert.throws(
        () => helper.getTestDatabaseConfig(environment),
        expectedError,
      );
    });
  }
});

test("connectTestDatabase validates the target and returns the connection", async () => {
  const connection = { name: "account_api_test" };
  const calls = [];
  const helper = loadDatabaseHelper({
    connection,
    connect: async (databaseUrl) => calls.push(databaseUrl),
  });

  const result = await helper.connectTestDatabase({
    TEST_DB_URL: "mongodb://127.0.0.1:27017/account_api_test",
  });

  assert.equal(result, connection);
  assert.deepEqual(calls, ["mongodb://127.0.0.1:27017/account_api_test"]);
});

test("clearTestDatabase removes documents while preserving collections", async () => {
  const deleted = [];
  const collections = ["users", "refreshsessions"].map((name) => ({
    deleteMany: async (filter) => deleted.push({ filter, name }),
  }));
  const helper = loadDatabaseHelper({
    connection: {
      name: "account_api_test",
      db: {
        collections: async () => collections,
      },
    },
  });

  await helper.clearTestDatabase();

  assert.deepEqual(deleted, [
    { filter: {}, name: "users" },
    { filter: {}, name: "refreshsessions" },
  ]);
});

test("clearTestDatabase refuses to touch a non-test database", async () => {
  let listedCollections = false;
  const helper = loadDatabaseHelper({
    connection: {
      name: "account-api",
      db: {
        collections: async () => {
          listedCollections = true;
          return [];
        },
      },
    },
  });

  await assert.rejects(
    helper.clearTestDatabase(),
    /must end with "_test"/,
  );
  assert.equal(listedCollections, false);
});

test("disconnectTestDatabase delegates to Mongoose", async () => {
  let disconnected = false;
  const helper = loadDatabaseHelper({
    disconnect: async () => {
      disconnected = true;
    },
  });

  await helper.disconnectTestDatabase();

  assert.equal(disconnected, true);
});
