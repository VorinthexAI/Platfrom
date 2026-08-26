const APPLE_TEAM_ID = "3RMYX67679";
const APP_IDENTIFIER = "app.vorinthex.com";

export function buildAppleAppSiteAssociation() {
  return {
    applinks: {
      details: [{
        appIDs: [`${APPLE_TEAM_ID}.${APP_IDENTIFIER}`],
        components: [
          { "/": "/public/auth/token", comment: "Mobile magic-link sign in" },
          { "/": "/capability/signal", comment: "Signal Gmail connection return" },
        ],
      }],
    },
  };
}

export function buildAndroidAssetLinks(certificateFingerprints: string | undefined) {
  const fingerprints = (certificateFingerprints ?? "").split(",")
    .map((fingerprint) => fingerprint.trim().toUpperCase())
    .filter((fingerprint) => /^(?:[0-9A-F]{2}:){31}[0-9A-F]{2}$/.test(fingerprint))
    .filter((fingerprint, index, all) => all.indexOf(fingerprint) === index);

  return fingerprints.length === 0 ? [] : [{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: {
      namespace: "android_app",
      package_name: APP_IDENTIFIER,
      sha256_cert_fingerprints: fingerprints,
    },
  }];
}
