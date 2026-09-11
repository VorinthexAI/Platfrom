import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const appConfig = JSON.parse(readFileSync(new URL("../../app.json", import.meta.url), "utf8"));
const route = readFileSync(new URL("../app/open.tsx", import.meta.url), "utf8");

test("the welcome-email universal link opens the app with an authenticated and signed-out fallback", () => {
  expect(appConfig.expo.ios.associatedDomains).toContain("applinks:vorinthex.com");
  expect(appConfig.expo.android.intentFilters[0].data).toContainEqual({ scheme: "https", host: "vorinthex.com", path: "/open" });
  expect(route).toContain('router.replace(useAuthStore.getState().user?.isOnboarded ? "/capability/archive" : "/onboarding")');
  expect(route).toContain('onboarding.complete || onboarding.previewComplete ? "/auth" : "/onboarding"');
});
