import { describe, expect, test } from "bun:test";

describe("push notification integration", () => {
  test("registers authenticated Expo tokens and configures rotation, receipts, and the app icon", async () => {
    const source = await Bun.file(new URL("./push-notifications.tsx", import.meta.url)).text();
    const app = await Bun.file(new URL("../../app.json", import.meta.url)).json() as any;
    const plugin = app.expo.plugins.find((entry: unknown) => Array.isArray(entry) && entry[0] === "expo-notifications");
    expect(source).toContain("getExpoPushTokenAsync({ projectId })");
    expect(source).toContain("addPushTokenListener");
    expect(source).toContain("addPushTokenListener(() => sync())");
    expect(source).toContain("signalThreadPushDataSchema.safeParse");
    expect(source).toContain('thread: parsed.data.signalThreadKey');
    expect(source).toContain('pathname: "/capability/[slug]"');
    expect(source).toContain("shouldShowBanner: false");
    expect(source).toContain('apiClient.put("/auth/me/push-subscription"');
    expect(plugin[1]).toEqual({ icon: "./assets/brand/notification-icon.png", color: "#FFFFFF", defaultChannel: "default" });
    expect(await Bun.file(new URL("../../assets/brand/notification-icon.png", import.meta.url)).exists()).toBe(true);
  });
});
