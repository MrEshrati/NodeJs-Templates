const mongoose = require("mongoose");

const TEST_DATABASE_SUFFIX = "_test";

const assertTestDatabaseName = (databaseName) => {
  if (
    typeof databaseName !== "string" ||
    databaseName.trim() === "" ||
    !databaseName.endsWith(TEST_DATABASE_SUFFIX)
  ) {
    throw new Error(
      `Test database name must end with "${TEST_DATABASE_SUFFIX}".`,
    );
  }
};

const getTestDatabaseConfig = (environment = process.env) => {
  if (
    environment === null ||
    typeof environment !== "object" ||
    Array.isArray(environment)
  ) {
    throw new TypeError("environment must be an object.");
  }

  const rawDatabaseUrl = environment.TEST_DB_URL;

  if (typeof rawDatabaseUrl !== "string" || rawDatabaseUrl.trim() === "") {
    throw new Error("TEST_DB_URL environment variable is required.");
  }

  const databaseUrl = rawDatabaseUrl.trim();
  let parsedUrl;

  try {
    parsedUrl = new URL(databaseUrl);
  } catch {
    throw new Error("TEST_DB_URL must be a valid MongoDB URL.");
  }

  if (parsedUrl.protocol !== "mongodb:" && parsedUrl.protocol !== "mongodb+srv:") {
    throw new Error("TEST_DB_URL must be a valid MongoDB URL.");
  }

  const encodedDatabaseName = parsedUrl.pathname.replace(/^\/+/, "");
  let databaseName;

  try {
    databaseName = decodeURIComponent(encodedDatabaseName);
  } catch {
    throw new Error("TEST_DB_URL must contain a valid database name.");
  }

  if (databaseName.includes("/")) {
    throw new Error("TEST_DB_URL must contain one database name.");
  }

  assertTestDatabaseName(databaseName);

  return {
    databaseName,
    databaseUrl,
  };
};

const connectTestDatabase = async (environment = process.env) => {
  const { databaseUrl } = getTestDatabaseConfig(environment);

  await mongoose.connect(databaseUrl);
  assertTestDatabaseName(mongoose.connection.name);

  return mongoose.connection;
};

const clearTestDatabase = async () => {
  assertTestDatabaseName(mongoose.connection.name);

  const database = mongoose.connection.db;

  if (!database || typeof database.collections !== "function") {
    throw new Error("Test database is not connected.");
  }

  const collections = await database.collections();

  await Promise.all(
    collections.map((collection) => collection.deleteMany({})),
  );
};

const disconnectTestDatabase = async () => {
  await mongoose.disconnect();
};

module.exports = {
  assertTestDatabaseName,
  clearTestDatabase,
  connectTestDatabase,
  disconnectTestDatabase,
  getTestDatabaseConfig,
};
