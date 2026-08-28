import { describe, expect, test } from "bun:test";
import { buildAndroidAssetLinks, buildAppleAppSiteAssociation } from "./app-links";

describe("mobile app associations", () => {
  test("limits iOS universal links to supported app routes", () => {
    expect(buildAppleAppSiteAssociation()).toEqual({
      applinks: {
        details: [{
          appIDs: ["3RMYX67679.app.vorinthex.com"],
          components: [
            { "/": "/public/auth/token", comment: "Mobile magic-link sign in" },
            { "/": "/capability/signal", comment: "Signal Gmail connection return" },
            { "/": "/share/books/*", comment: "Shared books" },
          ],
        }],
      },
    });
  });

  test("publishes only valid Android signing fingerprints", () => {
    const fingerprint = Array.from({ length: 32 }, () => "AB").join(":");
    const statements = buildAndroidAssetLinks(`invalid, ${fingerprint.toLowerCase()}`);

    expect(statements).toHaveLength(1);
    expect(statements[0]?.target.sha256_cert_fingerprints).toEqual([fingerprint]);
    expect(buildAndroidAssetLinks(undefined)).toEqual([]);
  });
});
