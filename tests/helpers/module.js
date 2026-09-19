const path = require("node:path");

const PROJECT_ROOT = path.resolve(__dirname, "../..");

const fromProject = (...segments) => path.join(PROJECT_ROOT, ...segments);

const loadWithMocks = (targetPath, mocks = {}) => {
  const resolvedTarget = require.resolve(targetPath);
  const originalTarget = require.cache[resolvedTarget];
  const originals = new Map();

  for (const [dependencyPath, exports] of Object.entries(mocks)) {
    const resolvedDependency = require.resolve(dependencyPath);
    originals.set(resolvedDependency, require.cache[resolvedDependency]);
    require.cache[resolvedDependency] = {
      id: resolvedDependency,
      filename: resolvedDependency,
      loaded: true,
      exports,
      children: [],
      paths: [],
    };
  }

  delete require.cache[resolvedTarget];

  try {
    return require(resolvedTarget);
  } finally {
    for (const [resolvedDependency, original] of originals) {
      if (original) {
        require.cache[resolvedDependency] = original;
      } else {
        delete require.cache[resolvedDependency];
      }
    }

    if (originalTarget) {
      require.cache[resolvedTarget] = originalTarget;
    } else {
      delete require.cache[resolvedTarget];
    }
  }
};

module.exports = {
  PROJECT_ROOT,
  fromProject,
  loadWithMocks,
};
