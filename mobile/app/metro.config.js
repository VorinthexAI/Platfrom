// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getDefaultConfig } = require("expo/metro-config");
// eslint-disable-next-line @typescript-eslint/no-require-imports
const path = require("path");

const config = getDefaultConfig(__dirname);

// Force every importer to the same three.js build. With package exports
// enabled, Metro resolves `import`-sites to three.module.js and
// `require`-sites to three.cjs — two module instances in one bundle
// ("Multiple instances of Three.js being imported"). Every `instanceof`
// check across the react-three-fiber/three boundary then fails, so fiber
// raw-assigns read-only math props (e.g. Object3D.position), which Hermes
// rejects with a fatal TypeError while web V8 silently ignores it.
// require.resolve("three") lands on build/three.cjs; swap to the ESM build.
const threeEntry = path.join(
  path.dirname(require.resolve("three")),
  "three.module.js",
);
const defaultResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName === "three") {
    return { type: "sourceFile", filePath: threeEntry };
  }
  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
