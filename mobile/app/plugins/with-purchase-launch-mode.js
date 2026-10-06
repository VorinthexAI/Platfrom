const { withAndroidManifest } = require("expo/config-plugins");

module.exports = function withPurchaseLaunchMode(config) {
  return withAndroidManifest(config, (mod) => {
    const activities = mod.modResults.manifest.application?.[0]?.activity ?? [];
    for (const activity of activities) {
      if (activity.$?.["android:name"] === ".MainActivity") activity.$["android:launchMode"] = "singleTop";
    }
    return mod;
  });
};
