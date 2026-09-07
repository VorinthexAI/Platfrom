import { describe, expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("notification hub integration", () => {
  test("uses authenticated presence and exposes a static full-screen notification list", async () => {
    const [presence, profile, route, avatar, provider] = await Promise.all([
      read("./presence.tsx"),
      read("../app/profile.tsx"),
      read("../app/notifications.tsx"),
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
    expect(account).toContain('router.push("/notifications")');
    expect(route).toContain('height="full"');
    expect(route).toContain("<ActionPill");
    expect(route).not.toContain("onPress={item");
    expect(avatar).toContain("notificationBadge");
    expect(avatar).toContain("unreadCount");
  });
});
