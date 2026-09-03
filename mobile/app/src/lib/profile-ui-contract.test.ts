import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";

const profile = readFileSync(new URL("../app/profile.tsx", import.meta.url), "utf8");
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

test("profile keeps its full-height base sheet open beneath bottom-presented child sheets", () => {
  expect(profile.match(/height="full"/g)?.length).toBe(5);
  expect(profile).toContain('open title="Profile"');
  expect(profile).toContain('focusKey="profile-name"');
  expect(profile).toContain('focusKey="profile-report"');
  expect(profile).toContain('focusKey="profile-feedback"');
  expect(profile).toContain('focusKey="profile-feedback-create"');
  expect(profile).not.toContain("pageKey=");
  expect(profile).toContain("setSheet(undefined);\n    const update = optimisticProfile({ name: nextName });");
  expect(profile).toContain("setSheet(undefined);\n    void createSupportTicket");
  expect(profile).toContain('setReportDraft("");\n    setSheet(undefined);');
  expect(profile).not.toContain("loading=");
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

test("every profile API action changes the UI before asynchronous work", () => {
  expectBefore(profile, "optimisticProfile({ avatarUrl: asset.uri })", "uploadProfileAvatar({ filename");
  expectBefore(profile, "optimisticProfile({ name: nextName })", "updateProfileName(nextName)");
  expectBefore(profile, "setSheet(undefined);", "createSupportTicket({ organizationKey");
  expectBefore(auth.slice(auth.indexOf("signOut: async")), "set(signedOutState);", "tokenVault.read()");
  expect(profile).not.toContain("loading=");
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

test("profile footer actions are ordered, iconless, secondary, and logout is immediate", () => {
  const close = '<Button onPress={() => router.back()} size="md" variant="secondary">Close</Button>';
  const logout = '<Button onPress={() => void signOut()} size="md" variant="secondary">Log out</Button>';
  const report = '<Button onPress={() => setSheet("report")} size="md" variant="secondary">Report an issue</Button>';
  const feedback = '<Button onPress={() => setSheet("feedback")} size="md" variant="secondary">Give us feedback</Button>';
  expectBefore(profile, feedback, report);
  expectBefore(profile, report, logout);
  expectBefore(profile, logout, close);
  expect(profile).not.toContain("LogOutIcon");
  expect(profile).not.toContain("WarningIcon");
  expect(profile).not.toContain("SendIcon");
});

test("feedback uses refresh-on-open, three loading pills, and shared accessible vote actions", () => {
  expect(profile).toContain('title="Give us feedback"');
  expect(profile).toContain('description="Share an idea, or upvote and downvote suggestions from others."');
  expect(profile).toContain('invalidateQueries({ queryKey: ["profile-feedback", organizationKey, scopeKey] }).then(() => refetchFeedback())');
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
  expect(profile).toContain('createFeedback({ organizationKey, scopeKey, message }, requestKey)');
  expectBefore(profile, 'setFeedbackDraft("")', 'createFeedback({ organizationKey, scopeKey, message }, requestKey)');
  expectBefore(profile, 'setReportDraft("")', 'createSupportTicket({ organizationKey, scopeKey, message }, requestKey)');
  expect(profile).toContain('accessibilityLabel="Feedback suggestion"');
  expect(profile).toContain('disabled={!feedbackDraft.trim() || !organizationKey || !scopeKey}');
});

test("feedback creation appends optimistically, scrolls to it, and reconciles the temporary pill", () => {
  expect(profile).toContain('const optimisticKey = `optimistic:${requestKey}`');
  expect(profile).toContain('items: [...(current?.items ?? []).filter(({ key }) => key !== optimisticKey), optimisticFeedback]');
  expectBefore(profile, 'queryClient.setQueryData<Awaited<ReturnType<typeof listFeedback>>>(feedbackQueryKey', 'createFeedback({ organizationKey, scopeKey, message }, requestKey)');
  expect(profile).toContain('item.key === optimisticKey ? created : item');
  expect(profile).toContain('items.filter(({ key }) => key !== optimisticKey)');
  expect(profile).toContain('feedbackSyncKeys.current.add(created.key)');
  expect(profile).toContain('feedbackScrollRef.current?.scrollToEnd({ animated: true })');
  expect(profile).toContain('item.key.startsWith("optimistic:")');
});
