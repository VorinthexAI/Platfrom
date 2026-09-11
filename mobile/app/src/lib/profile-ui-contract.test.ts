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
const onboardingBadge = readFileSync(new URL("../components/onboarding/OnboardingProfileBadge.tsx", import.meta.url), "utf8");
const sharedPackage = readFileSync(new URL("../../../../shared/package.json", import.meta.url), "utf8");
const workspaces = ["KnowledgeWorkspace", "GalleryWorkspace", "TravelWorkspace", "EmailWorkspace", "AscendWorkspace"].map((name) => readFileSync(new URL(`../components/capability/${name}.tsx`, import.meta.url), "utf8"));

function expectBefore(source: string, first: string, second: string) {
  expect(source.indexOf(first)).toBeGreaterThanOrEqual(0);
  expect(source.indexOf(first)).toBeLessThan(source.indexOf(second));
}

test("profile and settings are routed screens over bottom-presented child sheets", () => {
  expect(profile.match(/height="full"/g)?.length).toBeGreaterThanOrEqual(4);
  expect(profileRoute).toContain('<AccountScreen page="profile" />');
  expect(settingsRoute).toContain('<AccountScreen initialState={initialState} onReferralSheetClose={() => router.setParams({ sheet: undefined, mode: undefined })} page="settings" />');
  expect(profile).toContain('<AccountScreenShell rightAction={headerActions} title={page === "profile" ? "Profile" : "Settings"}>');
  expect(profile).not.toContain('open title="Profile"');
  expect(profile).not.toContain('focusKey="profile-settings"');
  expect(shell).toContain('accessibilityLabel={`Back from ${title}`}');
  expect(shell).toContain('<PersistentCoreComposer');
  expect(shell).toContain('<WorkspaceAppSwitcher active={active} onSelectActive={() => router.replace({ pathname: "/capability/[slug]", params: { slug: active } })} placeholder={{ icon: identityIcon, name: title }} />');
  expect(shell).toContain('name: title');
  expect(shell).toContain('const identityIcon = <ProfileAvatar avatarSize={36} />');
  expect(shell).toContain('<SparksBalanceButton />');
  expect(shell).not.toContain('<ProfileHeaderRight />');
  expect(shell).toContain('paddingTop: insets.top + 6');
  expect(shell).toContain('backgroundColor: palette.voidBlack');
  expect(shell).toContain('pageHeader: { alignItems: "center", flexDirection: "row", gap: spacing.sm, minHeight: 48, marginTop: spacing.md }');
  expect(layout).toContain('animation: "slide_from_right"');
  expect(profile).toContain('focusKey="profile-name"');
  expect(profile).toContain('focusKey="profile-faq"');
  expect(profile).toContain('focusKey="profile-referral"');
  expect(profile).toContain('focusKey="profile-scope-create"');
  expect(profile).toContain('focusKey="profile-cancel-subscription"');
  expect(profile).toContain('focusKey="profile-delete-account"');
  expect(profile).toContain('title="Delete account?"');
  expect(profile).not.toContain('accessibilityLabel="Account deletion confirmation"');
  expect(profile).toContain('title="Scopes"');
  expect(profile).toContain('title="Create scope"');
  expect(profile).toContain('<Text style={styles.scopeTitle}>Scopes</Text>');
  expectBefore(profile, '`Storage (${storageSparkCost} Sparks / GB / Month)`', '<Text style={styles.scopeTitle}>Scopes</Text>');
  expect(profile).toContain('state.sparkCosts.find((charge) => charge.kind === "storage")?.sparkCost');
  expect(profile).toContain('accessibilityLabel="How is storage charged?" contentMode="raw" iconOnly');
  expect(profile).toContain('open={sheet === "storage-help"} title="Storage"');
  expect(profile).toContain('Usage is measured continuously and charged in Sparks each hour');
  expect(profile).toContain('If storage remains unfunded for 90 days');
  expect(profile).not.toContain('new uploads are paused');
  expect(profile).toContain('formatStorageSummary(billingSummaryQuery.data.storage.bytes, billingSummaryQuery.data.storage.estimatedMonthlyMicroSparks)');
  expect(profile).not.toContain('Tap to change photo');
  expect(profile).not.toContain('borderBottomWidth: 1, gap: spacing.xs, marginTop: spacing.xl');
  expect(profile).toContain('accessibilityLabel="What are scopes?" contentMode="raw" iconOnly');
  expect(profile).toContain('size="xs" variant="icon"><HelpIcon size="sm" /></Button>');
  expect(profile).toContain('footer={<Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button>}');
  expect(profile).not.toContain("Show all");
  expect(profile).not.toContain('sheet === "scopes"');
  expect(profile).toContain("const scopeCardSize = Math.floor((width - spacing.md * 2 - 20) / 3)");
  expect(profile).toContain('content: { alignItems: "center", flexGrow: 1, paddingHorizontal: spacing.md');
  expect(profile).toContain('placeholder="Scope name"');
  expect(profile).toContain('placeholder="What belongs in this scope?"');
  expect(profile).toContain("queryClient.removeQueries");
  expect(profile).toContain("queryClient.invalidateQueries");
  expect(profile).toContain('pageKey={selectedFaq ? `answer-${faqQuestionIndex}` : "questions"}');
  expect(profile).toContain("setSheet(undefined);\n    const update = optimisticProfile({ name: nextName });");
  expect(profile.match(/loading=/g)?.length).toBeGreaterThanOrEqual(2);
  expect(profile).not.toContain("loading={deletingAccount}");
  expect(profile).toContain("multiline");
  expect(profile).toContain("onSubmitEditing={saveName}");
  expect(profile).toContain('<Text style={styles.inputLabel}>Name</Text>');
  expect(profile).toContain('accessibilityLabel="Edit name" contentMode="raw" onPress={openName}');
  expect(profile).not.toContain("EditIcon");
  expect(profile).toContain("function SettingsActionCard");
});

test("team selection is backend-gated and clears the previous team and scope cache", () => {
  expect(profile).toContain('const teamSelectionEnabled = useAuthStore((state) => state.teamSelectionEnabled)');
  expect(profile).toContain('{teamSelectionEnabled ? <SettingsActionCard icon={<SwitchTeamIcon size="lg" />} label="Switch team" onPress={() => setSheet("teams")}');
  expect(profile).toContain('queryFn: ({ signal }) => listTeams(signal), enabled: teamSelectionEnabled && sheet === "teams"');
  expect(profile).toContain('selectTeam(targetTeamKey, targetScopeKey)');
  expect(profile).toContain('queryBelongsToTeamScope(queryKey, previousTeamKey, previousScopeKey)');
  expect(profile).toContain('setPendingTeamMfa(result)');
});

test("every profile API action changes the UI before asynchronous work", () => {
  expectBefore(profile, "optimisticProfile({ avatarUrl: asset.uri })", "uploadProfileAvatar({ filename");
  expectBefore(profile, "optimisticProfile({ name: nextName })", "updateProfileName(nextName)");
  expectBefore(profile, "optimisticScope(optimisticCreated)", "createScope(teamKey");
  expect(profile).toContain("scopeUpdate.reconcile(selected)");
  expect(profile).toContain("scopeUpdate.rollback()");
  expect(profile).toContain("const optimisticList = markSelected(previous, scope)");
  expectBefore(profile, "queryClient.setQueryData(scopeQueryKey, optimisticList)", "selectScope(teamKey, scope.key)");
  expect(profile.match(/cancelQueries\(\{ queryKey: scopeQueryKey \}, \{ revert: false \}\)/g)).toHaveLength(2);
  expect(profile).toContain("const sortedScopes = [...scopes].sort((left, right) => left.position - right.position)");
  expect(profile).not.toContain("showSelectedFirst");
  expectBefore(auth.slice(auth.indexOf("signOut: async")), "set(signedOutState);", "tokenVault.read()");
  expectBefore(profile.slice(profile.indexOf("const permanentlyDeleteAccount")), "setSheet(undefined);", "deleteAccount()");
  expect(profile.slice(profile.indexOf("const permanentlyDeleteAccount"))).toContain('const deletion = deleteAccount();\n    queryClient.clear();\n    router.replace("/onboarding");');
  expectBefore(auth.slice(auth.indexOf("deleteAccount: async")), "set(signedOutState);", "await deletion;");
  expectBefore(auth.slice(auth.indexOf("deleteAccount: async")), "clearOnboardingCompletion()", "set(signedOutState);");
  expectBefore(profile.slice(profile.indexOf("const permanentlyDeleteAccount")), "queryClient.clear();", 'showToast({ title: "Your account has been deleted."');
  expect(profile).not.toContain("deletingAccount");
});

test("claiming an onboarding badge updates the profile and app header optimistically", () => {
  const claim = onboardingBadge.slice(onboardingBadge.indexOf("const claim ="), onboardingBadge.indexOf("const description ="));
  expectBefore(claim, "optimisticProfile({ avatarUrl: candidate.avatarUrl })", "claimProfileBadge(teamKey, scopeKey, candidate.candidateKey)");
  expectBefore(claim, "optimisticProfile({ avatarUrl: candidate.avatarUrl })", "onFinished()");
  expect(profile).toContain('uri={user?.avatarUrl}');
  expect(header).toContain('uri={user?.avatarUrl}');
  expect(onboardingBadge).toContain("update.reconcile");
  expect(onboardingBadge).toContain("update.rollback()");
});

test("avatar header integration is reusable, outlined, and visible in Core", () => {
  expect(header).toContain("export function ProfileHeaderRight()");
  expect(header).toContain('router.push("/profile")');
  expect(header).toContain("user?.avatarUrl");
  expect(sharedPackage).toContain('"./ui/avatar"');
  expect(sharedPackage).toContain('"react-native": "./packages/ui/components/avatar/avatar.mobile.tsx"');
  expect(header).toContain('variant="ghost"');
  expect(header).toContain('avatar: { backgroundColor: palette.voidBlack, borderColor: "#262D36", borderWidth: 1 }');
  expect(header).toContain('onPress={openPaywall} size="xs" textStyle={styles.balanceText} variant="secondary"');
  expect(header).not.toContain("balanceBadge");
  expect(header).toContain('borderColor: palette.voidBlack');
  expect(profile).toContain('avatar: { backgroundColor: palette.voidBlack, borderColor: palette.hairlineBright, borderWidth: 1 }');
  expect(core).toContain("<ProfileHeaderRight />");
  for (const workspace of workspaces) expect(workspace).toContain("<ProfileHeaderRight />");
});

test("profile and settings headers expose account actions", () => {
  expect(profile).toContain('accessibilityLabel="Open settings"');
  expect(profile).toContain('router.push("/settings")');
  expect(profile).toContain('<SettingsIcon size="sm" />');
  expect(profile).toContain('accessibilityLabel="Open notifications in Signal"');
  expect(profile).toContain('<BellIcon size="sm" />');
  expect(profile).not.toContain("NotificationsSheet");
  expect(profile).toContain('params: { slug: "signal", tab: "inbox", inbox: "internal" }');
  expect(profile).toContain('<SettingsActionCard danger icon={<SignOutIcon size="lg" variant="danger" />} label="Log out"');
  expectBefore(profile.slice(profile.indexOf("const logOut")), "await signOut();", 'router.replace("/auth")');
  expect(profile).toContain('await signOut();\n    queryClient.clear();\n    router.replace("/auth");');
  expect(profile).toContain('<SettingsActionCard icon={<FeedbackIcon size="lg" />} label="Feedback"');
  expect(profile).toContain('<SettingsActionCard icon={<IssueIcon size="lg" />} label="Report issue"');
  expect(profile).toContain('<Text numberOfLines={2} style={[styles.settingsCardLabel');
  expectBefore(profile, '<SettingsActionCard icon={<ReferralIcon size="lg" />} label="Referral"', '<SettingsActionCard danger icon={<DeleteAccountIcon');
  expectBefore(profile, 'label="Cancel subscription"', 'label="Delete account"');
  for (const icon of ["IssueIcon", "FeedbackIcon", "FaqIcon", "TermsIcon", "PrivacyIcon", "ReferralIcon", "WarningIcon", "DeleteAccountIcon", "SignOutIcon"]) expect(profile).toContain(`<${icon} size="lg"`);
});

test("settings exposes cancellation only for an active cancellable subscription", () => {
  expect(profile).toContain('useCurrentSubscription(page === "settings" ? user?.key : undefined)');
  expect(profile).toContain('subscriptionPresentation(subscription, subscriptionProduct)');
  expect(profile).toContain('subscriptionView?.action === "cancel" ? <SettingsActionCard danger');
  expect(profile).not.toContain('label="Restore renewal"');
  expect(profile).not.toContain('label="Restore subscription"');
});

test("subscription cancellation locks confirmation while pending and reconciles the active cache", () => {
  const cancellation = profile.slice(profile.indexOf('const cancelSubscription = useMutation'), profile.indexOf('useEffect(() =>'));
  expect(cancellation).toContain('mutationFn: () => setSubscriptionCancellation(true)');
  expectBefore(cancellation, 'queryClient.setQueryData(queryKey, updated)', 'queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "active" })');
  expectBefore(cancellation, 'queryClient.invalidateQueries({ queryKey, exact: true, refetchType: "active" })', 'setSheet(undefined)');
  expect(cancellation).toContain('showToast({ title: "Cancellation scheduled."');
  expect(cancellation).toContain('onError: () => showToast({ title: "Subscription could not be canceled. Please try again."');
  const confirmation = profile.slice(profile.indexOf('<BottomSheet dismissible={!cancelSubscription.isPending}'), profile.indexOf('<BottomSheet focusKey="profile-delete-account"'));
  expect(confirmation).toContain('disabled={cancelSubscription.isPending} loading={cancelSubscription.isPending}');
  expect(confirmation).toContain('if (!open && !cancelSubscription.isPending) setSheet(undefined)');
  expect(confirmation).toContain('disabled={cancelSubscription.isPending} onPress={() => setSheet(undefined)}');
  expect(confirmation).toContain('Your subscription remains active until ${cancellationPeriodEnd}, then it will not renew.');
  expect(confirmation).toContain('Your subscription remains active through the current billing period, then it will not renew.');
});

test("account deletion uses the compact confirmation pattern without secondary copy", () => {
  const confirmation = profile.slice(profile.indexOf('<BottomSheet focusKey="profile-delete-account"'), profile.indexOf('<BottomSheet description={referralMode'));
  expect(confirmation).toContain('title="Delete account?"');
  expect(confirmation).toContain('variant="primary">Delete</Button>');
  expect(confirmation).toContain('variant="secondary">Close</Button>');
  expect(confirmation).not.toContain("description=");
  expect(confirmation).not.toContain('height="full"');
  expect(confirmation).not.toContain("TextInput");
  expect(profile).not.toContain("DELETE_CONFIRMATION");
});

test("FAQ and referral use full-screen established patterns", () => {
  const referralSheet = profile.slice(profile.indexOf('<BottomSheet description={referralMode'), profile.indexOf('<BottomSheet description={selectedFaq'));
  expect(profile).toContain('shape="pill" size="md" style={styles.faqPill} variant="secondary"');
  expect(profile).toContain('faqPill: { justifyContent: "flex-start", minHeight: 40, paddingHorizontal: spacing.md, width: "100%" }');
  expect(profile).toContain('description={selectedFaq ? undefined : "Quick answers about plans and Sparks."}');
  expect(profile).toContain('{selectedFaq ? "Back" : "Close"}');
  expect(profile).toContain('enabled: Boolean(user?.key && sheet === "referral")');
  expect(profile).toContain('referralQuery.data.attributionCount === 0');
  expect(profile).toContain('referralQuery.data.code.code');
  expect(profile).toContain('invitee.firstPaidRewardStatus === "earned"');
  expect(profile).toContain('Earn 50 Sparks when your friend signs up, plus 100 more');
  expect(referralSheet).not.toContain("TabsList");
  expect(referralSheet).not.toContain("TabsTrigger");
  expect(referralSheet).toContain('<Tabs accessibilityLabel="Referral settings" accessibilityRole="tablist" style={styles.referralTabs}>');
  expect(referralSheet).toContain('accessibilityState={{ selected: referralMode === "share" }}');
  expect(referralSheet).toContain('accessibilityState={{ selected: referralMode === "redeem" }}');
  expect(profile).toContain('referralTabs: { alignSelf: "stretch", width: "100%" }');
  expect(profile).toContain('setTimeout(() => referralCodeInputRef.current?.focus(), 300)');
  expect(profile).toContain('autoFocusInBottomSheet={false}');
  expect(profile).toContain('await NativeShare.share({ message: code }, { dialogTitle: "Share referral" })');
  expect(profile).not.toContain('Join me on Vorinthex');
  expect(profile).toContain('redeemReferralCode(normalizedReferralCode)');
  expect(profile).toContain('disabled={!referralCodeValid || redeemingReferral || Boolean(referralRedemption)}');
});

test("scope cards expose optimistic long-press management actions", () => {
  expect(profile).toContain('delayLongPress={350} onLongPress={onLongPress}');
  expect(profile).toContain("void Haptics.selectionAsync()");
  expect(profile).toContain('<BottomSheet hideHeading');
  for (const action of ["Prioritize", "Change cover"]) expect(profile).toContain(`>${action}</BottomSheetItem>`);
  expect(profile).toContain('{canDeleteSelectedScope ? <BottomSheetItem');
  expect(profile).toContain('style={styles.scopeActionItem}>Delete</BottomSheetItem> : null}');
  expect(profile).toContain('scopeActionItem: { justifyContent: "center" }');
  expectBefore(profile, "queryClient.setQueryData(scopeQueryKey, prioritized)", "prioritizeScope(teamKey, target.key)");
  expectBefore(profile, "coverUrl: asset.uri", "uploadGalleryImages([");
  expect(profile).toContain('launchImageLibraryAsync({ mediaTypes: ["images"]');
  expect(profile).toContain('title="Delete scope?"');
  expect(profile).toContain('open={sheet === "scope-delete" && canDeleteSelectedScope}');
  expect(profile).toContain('scopes.some((scope) => scope.key !== selectedScope.key && !scope.key.startsWith("optimistic:"))');
  expect(profile).toContain("All data connected to this scope will be deleted. This action can&apos;t be undone.");
  expectBefore(profile, "previous.filter(({ key }) => key !== target.key)", "deleteScope(teamKey, target.key)");
  const deleteFailure = profile.slice(profile.indexOf('}).catch(async (error)', profile.indexOf('const deleteSelectedScope')), profile.indexOf('}).finally(() => setDeletingScope(false))'));
  expectBefore(deleteFailure, 'await hydrate().catch(() => undefined)', 'const authoritativeKey = String(useAuthStore.getState().scope?.key ?? "")');
  expect(deleteFailure).toContain('markCurrentKey(previous, authoritativeKey)');
  expect(deleteFailure).toContain('await queryClient.invalidateQueries({ queryKey: scopeQueryKey })');
  expect(profile).toContain('onLongPress={canManageScope(scope) ? () => openScopeActions(scope) : undefined}');
  expect(profile).toContain('onPress={() => pressScope(scope)} scope={scope}');
  expect(profile).toContain('<Text ellipsizeMode="tail" numberOfLines={1} style={[styles.scopeCardLabel, scope.coverUrl && styles.scopeCardLabelCovered]}>{scope.name}</Text>');
  expect(profile).toContain('scopeCardButtonCovered: { justifyContent: "flex-end", paddingBottom: 10 }');
  expect(profile).toContain('scopeCardLabelCovered: { paddingHorizontal: 5, paddingVertical: 4, borderRadius: radii.sm, backgroundColor: "rgba(0, 0, 0, 0.68)", color: "#FFFFFF" }');
  expect(profile).toContain('open={sheet === "scope-actions" && canManageScope(selectedScope)}');
  expect(profile).toContain('if (scope.key.startsWith("optimistic:") || !canManageScope(scope) || scopeManagementPending.current) return;');
  expect(profile).toContain('accessibilityHint={onLongPress ? "Long press for scope actions" : undefined}');
  expect(profile).toContain('const canManageScope = (scope?: ScopeSummary) => scope?.role === "owner" || scope?.role === "admin";');
});

test("scope management optimistic mutations cannot overlap", () => {
  expect(profile).toContain("const scopeManagementPending = useRef(false)");
  expect(profile).toContain("if (!selectedScope || !canManageScope(selectedScope) || scopeManagementPending.current) return;");
  expect((profile.match(/if \(!selectedScope \|\| !canManageScope\(selectedScope\) \|\| scopeManagementPending\.current\) return;/g) ?? []).length).toBe(2);
  expect(profile).toContain("if (!selectedScope || !canManageScope(selectedScope) || deletingScope || scopeManagementPending.current) return;");
  expect((profile.match(/scopeManagementPending\.current = true/g) ?? []).length).toBe(3);
  expect((profile.match(/scopeManagementPending\.current = false/g) ?? []).length).toBe(3);
});

test("support and feedback controls deep-link to Signal without community voting UI", () => {
  expect(profile).toContain('compose: "issue"');
  expect(profile).toContain('compose: "feedback"');
  expect(profile).not.toContain("setFeedbackVote");
  expect(profile).not.toContain("listFeedback");
  expect(profile).not.toContain("ActionPill");
});
