import { describe, expect, test } from "bun:test";
import { APP_LINK_ROUTES, appLinkHeaderSources, buildAndroidAssetLinks, buildAppleAppSiteAssociation } from "./app-links";
import { readFileSync } from "node:fs";

const openFallback = readFileSync(new URL("../app/open/page.tsx", import.meta.url), "utf8");

describe("mobile app associations", () => {
  test("limits iOS universal links to supported app routes", () => {
    const association = buildAppleAppSiteAssociation();
    expect(association).toEqual({
      applinks: {
        details: [{
          appIDs: ["3RMYX67679.app.vorinthex.com"],
          components: APP_LINK_ROUTES.map(({ associationPath, comment }) => ({ "/": associationPath, comment })),
        }],
      },
    });
    expect(JSON.stringify(association)).not.toContain("checkout");
  });

  test("publishes only valid Android signing fingerprints", () => {
    const fingerprint = Array.from({ length: 32 }, () => "AB").join(":");
    const statements = buildAndroidAssetLinks(`invalid, ${fingerprint.toLowerCase()}`);

    expect(statements).toHaveLength(1);
    expect(statements[0]?.target.sha256_cert_fingerprints).toEqual([fingerprint]);
    expect(statements[0]?.relation_extensions).toEqual({
      "delegate_permission/common.handle_all_urls": {
        dynamic_app_link_components: APP_LINK_ROUTES.map(({ associationPath, comment }) => ({ "/": associationPath, comment })),
      },
    });
    expect(JSON.stringify(statements)).not.toContain("checkout");
    expect(buildAndroidAssetLinks(undefined)).toEqual([]);
  });

  test("keeps every claimed route paired with a no-store fallback header", () => {
    expect(APP_LINK_ROUTES.map(({ fallback }) => fallback)).toEqual(["open", "magic", "mfa", "signal", "referral"]);
    expect(appLinkHeaderSources()).toEqual(["/open", "/public/auth/token", "/auth/mfa", "/capability/signal", "/referral/:path*"]);
    expect(JSON.stringify(APP_LINK_ROUTES)).not.toContain("share");
    expect(openFallback).toContain('href="vorinthexcore://"');
    expect(openFallback).toContain("<DownloadAppCta />");
    expect(openFallback).toContain("PRIVATE_ROUTE_METADATA");
  });
});
