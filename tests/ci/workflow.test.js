const test = require("node:test");
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const { resolve } = require("node:path");

const projectRoot = resolve(__dirname, "..", "..");
const workflowPath = resolve(
  projectRoot,
  ".github",
  "workflows",
  "ci.yml",
);
const workflow = readFileSync(workflowPath, "utf8");

test("CI runs locked Node.js 24 tests and the production audit", () => {
  assert.match(workflow, /node-version:\s*24/);
  assert.equal(workflow.match(/run:\s*npm ci/g)?.length, 2);

  const auditIndex = workflow.indexOf("run: npm run audit:prod");
  const testIndex = workflow.indexOf("run: npm test");

  assert.notEqual(auditIndex, -1);
  assert.notEqual(testIndex, -1);
  assert.ok(auditIndex < testIndex);
});

test("CI runs database workflows against a guarded MongoDB replica set", () => {
  assert.match(workflow, /mongo:8\.0/);
  assert.match(workflow, /--replSet rs0/);
  assert.match(
    workflow,
    /TEST_DB_URL:\s*mongodb:\/\/127\.0\.0\.1:27017\/account_api_test\?replicaSet=rs0/,
  );
  assert.match(workflow, /run:\s*npm run test:coverage:all/);
});

test("CI runs from the repository root on pushes and pull requests", () => {
  assert.match(workflow, /^  push:/m);
  assert.match(workflow, /^  pull_request:/m);
  assert.doesNotMatch(workflow, /working-directory:/);
  assert.equal(
    workflow.match(/cache-dependency-path:\s*package-lock\.json/g)?.length,
    2,
  );
});
