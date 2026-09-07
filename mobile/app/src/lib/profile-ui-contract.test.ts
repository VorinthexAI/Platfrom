import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const profileRoute = readFileSync(new URL("../app/profile.tsx", import.meta.url), "utf8");
const settingsRoute = readFileSync(new URL("../app/settings.tsx", import.meta.url), "utf8");
const profile = readFileSync(new URL("../components/AccountScreen.tsx", import.meta.url), "utf8");
const shell = readFileSync(new URL("../components/AccountScreenShell.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../app/_layout.tsx", import.meta.url), "utf8");
const auth = readFileSync(new URL("../state/auth.ts", import.meta.url), "utf8");
const header = readFileSync(new URL("../components/ProfileAvatarButton.tsx", import.meta.url), "utf8");
const core = readFileSync(new URL("../components/PersistentCoreComposer.tsx", import.meta.url), "utf8");
const sharedPackage = readFileSync(new URL("../../../../shared/package.json", import.meta.url), "utf8");
const actionPill = readFileSync(new URL("../../../../shared/packages/ui/components/action-pill/action-pill.mobile.tsx", import.meta.url), "utf8");
const workspaces = ["KnowledgeWorkspace", "GalleryWorkspace", "TravelWorkspace", "EmailWorkspace", "AscendWorkspace"].map((name) => readFileSync(new URL(`../components/capability/${name}.tsx`, import.meta.url), "utf8"));

function expectBefore(source: string, first: string, second: string) {
  expect(source.indexOf(first)).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(first)).toBeLessThan(source.indexOf(second));
}

test("profile and settings are routed screens over bottom-presented child sheets", () => {
  expect(profile.match(/height="full"/g)?.length).toBe(8);
  expect(profileRoute).toContain('<AccountScreen page="profile" />');
  expect(settingsRoute).toContain('<AccountScreen page="settings" />');
  expect(profile).toContain('<AccountScreenShell rightAction={settingsAction} title={page === "profile" ? "Profile" : "Settings"}>');
  expect(profile).not.toContain('open title="Profile"');
  expect(profile).not.toContain('focusKey="profile-settings"');
  expect(shell).toContain('accessibilityLabel={`Back from ${title}`}');
  expect(shell).toContain('<PersistentCoreComposer');
  expect(shell).toContain('paddingTop: insets.top + 6');
  expect(layout).toContain('animation: "slide_from_right"');
  expect(profile).toContain('focusKey="profile-name"');
  expect(profile).toContain('focusKey="profile-faq"');
  expect(profile).toContain('focusKey="profile-report"');
  expect(profile).toContain('focusKey="profile-feedback"');
  expect(profile).toContain('focusKey="profile-feedback-create"');
  expect(profile).toContain('focusKey="profile-scopes"');
  expect(profile).toContain('focusKey="profile-scope-create"');
  expect(profile).toContain('dismissible={!deletingAccount} focusKey="profile-delete-account"');
  expect(profile).toContain('title="Delete account?"');
  expect(profile).not.toContain('accessibilityLabel="Account deletion confirmation"');
  expect(profile).toContain('title="Scope"');
  expect(profile).toContain('title="Scopes"');
  expect(profile).toContain('title="Create scope"');
  expect(profile).toContain("Switch between scopes to keep your work organized and separate.");
  expect(profile).toContain('placeholder="Scope name"');
  expect(profile).toContain('placeholder="What belongs in this scope?"');
  expect(profile).toContain("[0, 1, 2].map");
  expect(profile).toContain("queryClient.removeQueries");
  expect(profile).toContain("queryClient.invalidateQueries");
  expect(profile).not.toContain("pageKey=");
  expect(profile).toContain("setSheet(undefined);\n    const update = optimisticProfile({ name: nextName });");
  expect(profile).toContain("setSheet(undefined);\n    void createSupportTicket");
  expect(profile).toContain('reportRequestKey.current = undefined;\n      setReportDraft("");');
  expect(profile.match(/loading=/g)).toHaveLength(1);
  expect(profile).toContain("loading={deletingAccount}");
  expect(profile).toContain("multiline");
  expect(profile).toContain("onSubmitEditing={saveName}");
  expect(profile).toContain('showToast({ title: "Issue report sent."');
  expect(profile).toContain('setSheet("report")');
  expect(profile).toContain('<Text style={styles.inputLabel}>Name</Text>');
  expect(profile).toContain('<Text style={styles.inputLabel}>Issue description</Text>');
  expect(profile).toContain('accessibilityLabel="Edit name" contentMode="raw" onPress={openName}');
  expect(profile).not.toContain("EditIcon");
  expect(profile).not.toContain("icon={<");
});

test("team selection is backend-gated and clears the previous team and scope cache", () => {
  expect(profile).toContain('const teamSelectionEnabled = useAuthStore((state) => state.teamSelectionEnabled)');
  expect(profile).toContain('{teamSelectionEnabled ? <Button onPress={() => setSheet("teams")} size="md" variant="secondary">Switch team</Button> : null}');
  expect(profile).toContain('queryFn: ({ signal }) => listTeams(signal), enabled: teamSelectionEnabled && sheet === "teams"');
  expect(profile).toContain('selectTeam(targetTeamKey, targetScopeKey)');
  expect(profile).toContain('queryBelongsToTeamScope(queryKey, previousTeamKey, previousScopeKey)');
  expect(profile).toContain('setPendingTeamMfa(result)');
});

test("every profile API action changes the UI before asynchronous work", () => {
  expectBefore(profile, "optimisticProfile({ avatarUrl: asset.uri })", "uploadProfileAvatar({ filename");
  expectBefore(profile, "optimisticProfile({ name: nextName })", "updateProfileName(nextName)");
  expectBefore(profile, "setSheet(undefined);", "createSupportTicket({ teamKey");
  expectBefore(auth.slice(auth.indexOf("signOut: async")), "set(signedOutState);", "tokenVault.read()");
  expectBefore(profile, "setDeletingAccount(true);", "await deleteAccount()");
});

test("avatar header integration is reusable, outlined, and visible in Core", () => {
  expect(header).toContain("export function ProfileHeaderRight()");
  expect(header).toContain('router.push("/profile")');
  expect(header).toContain("user?.avatarUrl");
  expect(sharedPackage).toContain('"./ui/avatar"');
  expect(sharedPackage).toContain('"react-native": "./packages/ui/components/avatar/avatar.mobile.tsx"');
  expect(header).toContain('variant="ghost"');
  expect(header).toContain('avatar: { borderColor: "#262D36", borderWidth: 1 }');
  expect(profile).toContain('avatar: { borderColor: palette.hairlineBright, borderWidth: 1 }');
  expect(core).toContain("<ProfileHeaderRight />");
  for (const workspace of workspaces) expect(workspace).toContain("<ProfileHeaderRight />");
});

test("profile header opens the routed Settings screen and Settings owns account actions", () => {
  expect(profile).toContain('accessibilityLabel="Open settings"');
  expect(profile).toContain('router.push("/settings")');
  expect(profile).toContain('<SettingsIcon size="sm" />');
  expect(profile).toContain('<Button onPress={() => router.push("/notifications")} size="md" variant="secondary">Notifications</Button>');
  expect(profile).toContain('<Button onPress={logOut} size="md" variant="secondary">Log out</Button>');
  expectBefore(profile.slice(profile.indexOf("const logOut")), "const completion = signOut();", 'router.replace("/auth")');
  expect(profile).toContain('queryClient.clear();\n    router.replace("/auth");\n    void completion;');
  expect(profile).toContain('<Button onPress={() => setSheet("feedback")} size="md" variant="secondary">Give feedback</Button>');
  expect(profile).toContain('<Button onPress={() => setSheet("report")} size="md" variant="secondary">Report an issue</Button>');
  expect(profile).not.toContain("LogOutIcon");
  expect(profile).not.toContain("WarningIcon");
  expect(profile).not.toContain("SendIcon");
});

test("account deletion uses the compact confirmation pattern without secondary copy", () => {
  const confirmation = profile.slice(profile.indexOf('<BottomSheet dismissible={!deletingAccount}'), profile.indexOf('<BottomSheet description="Quick answers'));
  expect(confirmation).toContain('title="Delete account?"');
  expect(confirmation).toContain('variant="primary">Delete</Button>');
  expect(confirmation).toContain('variant="secondary">Close</Button>');
  expect(confirmation).not.toContain("description=");
  expect(confirmation).not.toContain('height="full"');
  expect(confirmation).not.toContain("TextInput");
  expect(profile).not.toContain("DELETE_CONFIRMATION");
});

test("feedback uses refresh-on-open, three loading pills, and shared accessible vote actions", () => {
  expect(profile).toContain('title="Give us feedback"');
  expect(profile).toContain('description="Share an idea, or upvote and downvote suggestions from others."');
  expect(profile).toContain('invalidateQueries({ queryKey: ["profile-feedback", teamKey, scopeKey] }).then(() => refetchFeedback())');
  expect(profile).toContain('[0, 1, 2].map((index) => <Skeleton');
  expect(profile).toContain('numberOfLines={1}');
  expect(profile).toContain('<ActionPill');
  expect(profile).toContain('appearance="reorder"');
  expect(profile).toContain('secondaryActionLabel={`Downvote: ${item.message}`}');
  expect(actionPill).toContain('secondaryAction?: ReactNode');
  expect(actionPill).toContain('accessibilityState={{ selected: secondaryActionSelected }}');
  expect(actionPill).toContain('reorderRoot: { backgroundColor: colors.page, borderColor: colors.hairline, height: 48, minHeight: 48, padding: 0 }');
  expect(actionPill).toContain('reorderAction: { backgroundColor: colors.page, height: 32, minHeight: 32');
  expect(actionPill).toContain('staticMain: { alignItems: "flex-start", justifyContent: "center" }');
  expect(sharedPackage).toContain('"./ui/action-pill"');
  expect(profile).toContain('feedbackList: { flexGrow: 1');
  expect(profile).toContain('feedbackState: { alignItems: "center", flex: 1, justifyContent: "center" }');
});

test("feedback list and create sheets keep vertical md footers and message-only creation", () => {
  expect(profile).toContain('<Button disabled={submittingFeedback} onPress={() => setSheet("feedback-create")} size="md" variant="primary">New</Button><Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button>');
  expect(profile).toContain('createFeedback({ teamKey, scopeKey, message }, requestKey)');
  expectBefore(profile, 'setFeedbackDraft("")', 'createFeedback({ teamKey, scopeKey, message }, requestKey)');
  expectBefore(profile, 'createSupportTicket({ teamKey, scopeKey, message }, requestKey)', 'setReportDraft("")');
  expect(profile).toContain('accessibilityLabel="Feedback suggestion"');
  expect(profile).toContain('disabled={!feedbackDraft.trim() || !teamKey || !scopeKey}');
});

test("feedback creation appends optimistically, scrolls to it, and reconciles the temporary pill", () => {
  expect(profile).toContain('const optimisticKey = `optimistic:${requestKey}`');
  expect(profile).toContain('items: [...(current?.items ?? []).filter(({ key }) => key !== optimisticKey), optimisticFeedback]');
  expectBefore(profile, 'queryClient.setQueryData<Awaited<ReturnType<typeof listFeedback>>>(feedbackQueryKey', 'createFeedback({ teamKey, scopeKey, message }, requestKey)');
  expect(profile).toContain('item.key === optimisticKey ? created : item');
  expect(profile).toContain('items.filter(({ key }) => key !== optimisticKey)');
  expect(profile).toContain('feedbackSyncKeys.current.add(created.key)');
  expect(profile).toContain('feedbackScrollRef.current?.scrollToEnd({ animated: true })');
  expect(profile).toContain('item.key.startsWith("optimistic:")');
});
