import { describe, expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("notification hub integration", () => {
  test("uses authenticated presence and exposes a static full-screen notification list", async () => {
    const [presence, profile, route, sheet, avatar, provider] = await Promise.all([
      read("./presence.tsx"),
      read("../app/profile.tsx"),
      read("../app/notifications.tsx"),
      read("../components/NotificationsSheet.tsx"),
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
    expect(account).toContain('onPress={() => setSheet("notifications")}');
    expect(account).toContain('<NotificationsSheet onClose={() => setSheet(undefined)} open={sheet === "notifications"} />');
    expect(route).toContain('<NotificationsSheet onClose={close} open />');
    expect(sheet).toContain('height="full"');
    expect(sheet).toContain("<ActionPill");
    expect(sheet).toContain('enabled: open && Boolean(userKey && teamKey && scopeKey)');
    expect(sheet).toContain('if (!open || !userKey || !teamKey || !scopeKey) return;');
    expect(avatar).toContain("notificationBadge");
    expect(avatar).toContain("unreadCount");
  });
});
