import { describe, expect, test } from "bun:test";

const read = (path: string) => Bun.file(new URL(path, import.meta.url)).text();

describe("Signal notification integration", () => {
  test("uses authenticated presence and routes notifications into the permanent internal inbox", async () => {
    const [presence, profile, signal, signalRoot, avatar, provider] = await Promise.all([
      read("./presence.tsx"),
      read("../app/profile.tsx"),
      read("../components/capability/SignalWorkspace.tsx"),
      read("../components/capability/EmailWorkspace.tsx"),
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
    expect(signalRoot).toContain('accessibilityLabel="Open Vorinthex AI inbox"');
    expect(signalRoot).toContain('source={contentPresentationIconSource.platform}');
    expect(signalRoot).toContain('style={styles.managedInboxLogo}');
    expect(signal).toContain('accessibilityLabel={threadKey ? "Back to Vorinthex AI inbox" : "Back to Signal root"}');
    expect(signal).not.toContain("<ChatBubbleIcon");
    expect(signal).toContain('label: "Messages"');
    expect(signal).toContain('label: "Sent"');
    expect(signal).not.toContain('"drafts"');
    expect(signal).toContain('accessibilityLabel="Search Vorinthex AI messages"');
    expect(signal).toContain('accessibilityLabel="Filter Vorinthex AI inbox"');
    expect(signal).toContain('>Report an issue</BottomSheetItem>');
    expect(signal).toContain('>Give us feedback</BottomSheetItem>');
    expect(signal).toContain('>Mark as read</BottomSheetItem>');
    expect(signal).toContain('>Mark as unread</BottomSheetItem>');
    expect(signal).toContain('textStyle={styles.menuText}');
    expect(signal).not.toContain("INBOX_FACETS");
    expect(signal).not.toContain("Urgent");
    expect(signal).not.toContain("Purchases");
    expect(signal).toContain('<SupportComposeSheets');
    expect(avatar).toContain("notificationBadge");
    expect(avatar).toContain("unreadCount");
  });
});
