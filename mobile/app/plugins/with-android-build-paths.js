const { withAppBuildGradle, withProjectBuildGradle } = require("expo/config-plugins");
const { mergeContents } = require("@expo/config-plugins/build/utils/generateCode");

// Gradle 10 removes generated Groovy setters. Normalize only known properties
// in the generated app, leaving real method calls (e.g. buildConfigField) intact.
function modernizeAssignments(contents) {
  return contents.replace(
    /^(\s*)(ndkVersion|namespace|signingConfig|shrinkResources|crunchPngs|useLegacyPackaging|ignoreAssetsPattern|url) (?![=\s])(.+)$/gm,
    "$1$2 = $3",
  );
}

module.exports = function withAndroidBuildPaths(config) {
  config = withProjectBuildGradle(config, (mod) => {
    mod.modResults.contents = modernizeAssignments(mod.modResults.contents);
    return mod;
  });
  return withAppBuildGradle(config, (mod) => {
    mod.modResults.contents = mergeContents({
      tag: "short-windows-cmake-path",
      src: modernizeAssignments(mod.modResults.contents),
      anchor: /^android \{/m,
      offset: 1,
      comment: "//",
      newSrc: `    // Keep generated C++ object paths below Windows' 250-character limit.
    // Isolate checkouts so concurrent builds never share a CMake cache.
    if (System.getProperty("os.name").toLowerCase().contains("windows")) {
        def checkoutId = java.security.MessageDigest.getInstance("SHA-256")
            .digest(rootDir.canonicalPath.getBytes("UTF-8")).encodeHex().toString().take(12)
        externalNativeBuild {
            cmake {
                buildStagingDirectory = new File(gradle.gradleUserHomeDir, "cxx/" + checkoutId)
            }
        }
    }`,
    }).contents;
    return mod;
  });
};
