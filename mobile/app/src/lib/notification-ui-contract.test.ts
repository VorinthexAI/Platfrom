import { describe, expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("Signal notification integration", () => {
  test("uses authenticated presence and routes notifications into the permanent internal inbox", async () => {
    const [presence, profile, signal, avatar, provider] = await Promise.all([
      read("./presence.tsx"),
      read("../app/profile.tsx"),
      read("../components/capability/SignalWorkspace.tsx"),
      read("../components/ProfileAvatarButton.tsx"),
      read("./query-client.tsx"),
    ]);
    expect(provider).toContain("<PresenceBridge />");
    expect(presence).toContain('apiClient.post("/presence/join", { source: "mobile" })');
    expect(presence).toContain('apiClient.post("/presence/beat"');
    expect(presence).toContain('apiClient.post("/presence/leave"');
    expect(presence).toContain("sessionKey.current || joining.current");
    expect(presence).toContain("generation !== lifecycleGeneration.current");
    expect(presence).toContain("useAuthStore.getState().status !== \"authenticated\"");
    expect(profile).toContain('<AccountScreen page="profile" />');
    const account = await Bun.file(new URL("../components/AccountScreen.tsx", import.meta.url)).text();
    expect(account).toContain('inbox: "internal"');
    expect(account).not.toContain("NotificationsSheet");
    expect(signal).toContain('accessibilityLabel="Open Vorinthex inbox"');
    expect(signal).toContain('source={contentPresentationIconSource.platform}');
    expect(signal).toContain('style={styles.managedAccountLogo}');
    expect(signal).not.toContain("<ChatBubbleIcon");
    expect(signal).toContain('thread.source.kind === "internal"');
    expect(signal).toContain('<SupportComposeSheets');
    expect(avatar).toContain("notificationBadge");
    expect(avatar).toContain("unreadCount");
  });
});
