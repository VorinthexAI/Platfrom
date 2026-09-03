import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";

import { APP_STORE_URL, appStoreUrl, GOOGLE_PLAY_URL, shouldPromptForAppUpdate } from "./app-update";
import { isInternetConnectionOffline } from "./internet-connection";

const read = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

describe("internet connection state", () => {
  test("only reports offline after a negative connection signal", () => {
    expect(isInternetConnectionOffline({})).toBe(false);
    expect(isInternetConnectionOffline({ isConnected: true })).toBe(false);
    expect(isInternetConnectionOffline({ isConnected: false })).toBe(true);
    expect(isInternetConnectionOffline({ isConnected: true, isInternetReachable: false })).toBe(true);
    expect(isInternetConnectionOffline({ isConnected: false, isInternetReachable: true })).toBe(false);
  });
});

describe("app update prompt", () => {
  test("shows only for an undismissed registry mismatch", () => {
    expect(shouldPromptForAppUpdate("1.0.0", "1.1.0", null)).toBe(true);
    expect(shouldPromptForAppUpdate("1.0.0", "1.0.0", null)).toBe(false);
    expect(shouldPromptForAppUpdate("1.0.0", "1.1.0", "1.1.0")).toBe(false);
    expect(shouldPromptForAppUpdate(undefined, "1.1.0", null)).toBe(false);
  });

  test("routes each native platform to its store", () => {
    expect(appStoreUrl("android")).toBe(GOOGLE_PLAY_URL);
    expect(appStoreUrl("ios")).toBe(APP_STORE_URL);
  });
});

test("availability sheets use the shared sheet and cannot dismiss the offline overlay", () => {
  const component = read("../components/AppAvailabilitySheets.tsx");
  const root = read("../app/_layout.tsx");
  expect(component).toContain('dismissible={false}');
  expect(component).toContain('height="full"');
  expect(component).toContain("hideCloseButton");
  expect(component).toContain('open={isOffline}');
  expect(component).toContain('slug }) => slug === "vorinthex-ai"');
  expect(component).toContain("Constants.expoConfig?.version");
  expect(root).toContain("<AppAvailabilitySheets isOffline={isOffline} />");
  expect(root).toContain('isOffline || (status !== "bootstrapping"');
  expect(root).toContain("connectionResolved && !isOffline");
});
