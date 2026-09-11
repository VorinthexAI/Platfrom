const APPLE_TEAM_ID = "3RMYX67679";
const APP_IDENTIFIER = "app.vorinthex.com";

export const APP_LINK_ROUTES = [
  { associationPath: "/open", comment: "Open Vorinthex AI", fallback: "open" },
  { associationPath: "/public/auth/token", comment: "Mobile magic-link sign in", fallback: "magic" },
  { associationPath: "/auth/mfa", comment: "Team MFA recovery", fallback: "mfa" },
  { associationPath: "/capability/signal", comment: "Signal capability OAuth return", fallback: "signal" },
  { associationPath: "/referral/*", comment: "Referral acquisition", fallback: "referral" },
] as const;

export const appLinkComponents = () => APP_LINK_ROUTES.map(({ associationPath, comment }) => ({ "/": associationPath, comment }));
export const appLinkHeaderSources = () => APP_LINK_ROUTES.map(({ associationPath }) => associationPath.endsWith("/*") ? associationPath.replace("/*", "/:path*") : associationPath);

export function buildAppleAppSiteAssociation() {
  return {
    applinks: {
      details: [{
        appIDs: [`${APPLE_TEAM_ID}.${APP_IDENTIFIER}`],
        components: appLinkComponents(),
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
    relation_extensions: {
      "delegate_permission/common.handle_all_urls": {
        dynamic_app_link_components: appLinkComponents(),
      },
    },
  }];
}
