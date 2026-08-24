import { expect, test } from "bun:test";

const workspace = await Bun.file(new URL("../components/capability/EmailWorkspace.tsx", import.meta.url)).text();
const picker = await Bun.file(new URL("../components/capability/EmailAttachmentPicker.tsx", import.meta.url)).text();
const route = await Bun.file(new URL("../app/capability/[slug].tsx", import.meta.url)).text();
const client = await Bun.file(new URL("./email-client.ts", import.meta.url)).text();
const trashAggregation = await Bun.file(new URL("./email-trash-aggregation.ts", import.meta.url)).text();
const emailAttachmentPicker = await Bun.file(new URL("./email-attachment-picker.ts", import.meta.url)).text();

test("Signal provides global identity and inbox/thread local headers", () => {
  expect(workspace).toMatch(/<WorkspaceAppSwitcher[\s\S]*?active="signal"[\s\S]*?onBeforeSelect/);
  expect(workspace).toContain('trigger="back"');
  expect(workspace).toContain('selected ? selectedMessage?.subject ?? selected.thread.subject : initialConnectorKey ? selectedAccount?.name ?? "" : "Signal"');
  expect(workspace).toContain('accessibilityLabel="Open Signal AI Brain menu"');
  expect(workspace).toContain('accessibilityLabel="Filter Signal"');
  expect(workspace).toContain('accessibilityLabel="Create in Signal"');
  expect(workspace).toContain('accessibilityLabel="More inbox actions"');
  expect(workspace).toContain('accessibilityLabel="New email"');
});

test("Signal exposes Read/Unread tabs and four independent normalized facets", () => {
  for (const value of ['{ facet: "urgent", label: "Urgent" }', '{ facet: "important", label: "Important" }', '{ facet: "filtered", label: "Filtered" }', '{ facet: "favorite", label: "Favorite" }']) expect(workspace).toContain(value);
  expect(workspace).toContain("const defaultInboxQuery = () => normalizeEmailOverviewQuery()");
  expect(workspace).toContain('accessibilityLabel="Email read state"');
  expect(workspace).toContain('accessibilityLabel="Filter inbox"');
  expect(workspace).toContain('setSheet("inboxFilter")');
  expect(workspace).toContain("inboxControlsQuery.facets.includes(facet)");
  expect(workspace).toContain('categoryTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel }');
  expect(workspace).toContain('categoryTab: { minHeight: 28, flex: 1 }');
  expect(workspace).not.toContain("useState(new Set");
  expect(workspace).not.toContain('useState<EmailFilter>("important")');
});

test("inbox messages use one-line Archive document-style pills and outline-only bulk selection", () => {
  const inbox = workspace.slice(workspace.indexOf("overview?.threads.map((thread)"), workspace.indexOf("!loading && !inboxQueryPending", workspace.indexOf("overview?.threads.map((thread)")));
  expect(inbox).toContain('shape="pill"');
  expect(inbox).toContain('size="sm"');
  expect(inbox).toContain('<MailIcon size="sm" />');
  expect(inbox).toContain('variant={selectedThreads.some(({ key }) => key === thread.key) ? "ghost" : "secondary"}');
  expect(inbox).toContain('{thread.subject}');
  expect(inbox).not.toMatch(/<Text[^>]*>\{shortAddress\(thread\.latestFrom\)\}<\/Text>/);
  expect(inbox).not.toContain("styles.selectionBadge");
  expect(workspace).toContain('threadCardSelected: { borderColor: palette.silver50, borderWidth: 1, backgroundColor: "transparent" }');
  expect(workspace).toContain('threadCard: {\n    width: "100%",\n    minHeight: 38,\n    justifyContent: "flex-start",\n    paddingHorizontal: 14');
  expect(workspace).not.toContain("styles.threadCardUnread");
});

test("new email uses four stacked full-screen sheets and canonical draft clients", () => {
  for (const state of ["newEmailRecipientsOpen", "newEmailContentOpen", "newEmailAlternativesOpen", "newEmailReviewOpen"]) expect(workspace).toContain(`open={${state}}`);
  expect(workspace.match(/title="(?:Recipients|Write email|Choose a tone|Review email)"/g)).toHaveLength(4);
  expect(workspace.match(/height="full"/g)?.length).toBeGreaterThanOrEqual(8);
  expect(workspace).toContain('generationMode: "generate"');
  expect(workspace).toContain('generationMode: "preserve"');
  expect(workspace).toContain('updateEmailDraftForContext(context, selectedDraft!.key, newEmailReviewBody');
  expect(workspace).toContain('sendEmailDraftForContext(context, prepared.key, randomUUID())');
  expect(workspace).toContain('navigation.addListener("beforeRemove"');
  expect(workspace).not.toContain('<EmailAttachmentPicker');
  expect(workspace).not.toContain('sheet === "composer"');
  expect(workspace).not.toContain("Save draft");
});

test("new email validates recipient chips and preserves exact blank-safe review content", () => {
  expect(workspace).toContain("emailAddressSchema.safeParse(candidate)");
  expect(workspace).toContain("emailAddressListSchema.safeParse(next)");
  expect(workspace).toContain(".split(/[;,\\s]+/)");
  expect(workspace).toContain("address.toLocaleLowerCase()");
  expect(workspace).toContain("if (!emailAddressListSchema.safeParse(next).success)");
  expect(workspace).toContain('accessibilityRole="alert" style={styles.inlineError}');
  expect(workspace).toContain('accessibilityLabel={`Remove recipient ${address}`}');
  expect(workspace).toMatch(/accessibilityLabel=\{`Remove recipient[\s\S]*?shape="pill" size="md"[\s\S]*?<CloseIcon size="sm"/);
  expect(workspace).toContain('maxLength={998}');
  expect(workspace).toContain('maxLength={50_000}');
  expect(workspace).toContain('subject: newEmailReviewSubject');
  expect(workspace).toContain('authoredBody: newEmailReviewBody');
  expect(workspace).not.toContain("newEmailReviewBody.trim()");
  expect(workspace).not.toContain("newEmailReviewSubject.trim()");
});

test("new email generates all tones concurrently with partial-failure ownership guards", () => {
  expect(workspace).toContain("const operations = targets.map(async (option) =>");
  expect(workspace).toContain("void Promise.allSettled(operations)");
  expect(workspace).toContain('newEmailPendingAlternativeCount === newEmailAlternatives.length ? 3 : Math.min(3, newEmailPendingAlternativeCount)');
  expect(workspace).toContain('Array.from({ length: newEmailAlternativeSkeletonCount }, (_, index) => <Skeleton accessibilityLabel="Generating email alternatives"');
  expect(workspace).toMatch(/function openNewEmailAlternatives\(\)[\s\S]*?setNewEmailAlternativesOpen\(true\);[\s\S]*?if \(newEmailGenerationOwner\.current\) return;/);
  expect(workspace).toContain('status: "succeeded", draft: created');
  expect(workspace).toContain('status: "failed", error: messageFor(failure)');
  expect(workspace).toContain('>Retry failed</Button>');
  expect(workspace).toContain('existing.get(option.value)?.status !== "succeeded"');
  expect(workspace).toContain("newEmailGenerationIsCurrent(generation, owner, context)");
  expect(workspace).toContain("newEmailGenerationOwner.current = owner");
  expect(workspace).toContain("newEmailToneRequestKeys.current.get(option.value) ?? randomUUID()");
});

test("Skip defers preserve composition until Send and new email has no attachment surface", () => {
  const skip = workspace.slice(workspace.indexOf("function openNewEmailReview"), workspace.indexOf("function closeNewEmailReview"));
  const send = workspace.slice(workspace.indexOf("async function sendNewEmail"), workspace.indexOf("function setGeneratedSelection"));
  expect(skip).not.toContain("composeEmailDraftForContext");
  expect(send).toContain('if (newEmailSkipped)');
  expect(send).toContain('generationMode: "preserve"');
  expect(send).toContain("newEmailReviewBody !== (selectedDraft!.finalContent ?? selectedDraft!.generatedContent)");
  expect(send).toContain("newEmailSendInFlight.current || newEmailSending");
  expect(workspace).not.toContain("EmailAttachmentPicker");
  expect(workspace).not.toContain("Composer attachments");
});

test("Signal root puts shared search before tabs and uses a measured exact three-column grid", () => {
  expect(workspace).toContain("const toneRecords = metadataOverview?.tones ?? []");
  expect(workspace.indexOf('accessibilityLabel="Search Signal inboxes and tones"')).toBeLessThan(workspace.indexOf('accessibilityLabel="Signal root categories"'));
  expect(workspace).toContain("setRootGridWidth(nativeEvent.layout.width)");
  expect(workspace).toContain("- 20) / 3");
  expect(workspace).toContain("visibleTones.map((record) => (");
  expect(workspace).toMatch(/visibleTones\.map\(\(record\) => \(\s*<View[\s\S]*?<Button[\s\S]*?shape="rounded"/);
  const tones = workspace.slice(workspace.indexOf("visibleTones.map"), workspace.indexOf("No tones matched this search."));
  expect(workspace).toContain('account.coverUrl ? <Image contentFit="cover"');
  expect(tones).not.toContain("record.coverUrl");
  expect(workspace).toContain("account.isFavorite");
  expect(workspace).toContain("record.isFavorite");
  expect(workspace).toContain('rootTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel }');
  expect(workspace).toMatch(/accessibilityLabel="Signal root categories"[\s\S]*?size="xs" style=\{styles\.rootTab\}/);
  expect(workspace).not.toContain("styles.favoriteBadge");
  expect(workspace).toContain("No inboxes yet.");
  expect(workspace).toContain("No tones yet.");
  expect(workspace).toContain('accessibilityLabel="Connect inbox"');
  expect(workspace).toContain('accessibilityLabel="Create email tone"');
  expect(workspace).toContain('emptyPlusButton: { width: 44, height: 44 }');
  expect(workspace).not.toContain('setSheet("tones")');
  expect(workspace).not.toContain("<Pressable");
});

test("Signal follows the authenticated scope and locks resolved empty lists", () => {
  expect(workspace).toContain('const organizationKey = useAuthStore((state) => typeof state.organization?.key === "string" ? state.organization.key : "")');
  expect(workspace).toContain('const scopeKey = useAuthStore((state) => typeof state.scope?.key === "string" ? state.scope.key : "")');
  expect(workspace).toContain("const emailContext = { organizationKey, scopeKey }");
  expect(workspace).toContain("scrollEnabled={!rootEmpty}");
  expect(workspace).toContain("scrollEnabled={!inboxEmpty}");
});

test("Signal exposes Core with the Archive root-search focus gate", () => {
  expect(workspace).toContain('<CoreComposer');
  expect(workspace).toContain('accessibilityLabel="Ask Core about your Signal"');
  expect(workspace).toContain('askEmailAssistantForContext(context, message, randomUUID())');
  expect(workspace).toContain('invalidateAssistantChanges(queryClient, context, result.changes)');
  expect(workspace).toContain('const rootSearchInputRef = useRef<ComponentRef<typeof TextInput>>(null)');
  expect(workspace).toContain('editable={rootSearchFocusable}');
  expect(workspace).toContain('focusable={rootSearchFocusable}');
  expect(workspace).toContain('rootSearchInputRef.current?.blur()');
  expect(workspace).toContain('setRootSearchFocusable(false)');
  expect(workspace).toContain('setRootSearchFocusable(true)');
  expect(client).toContain('surface: "signal-workspace"');
  expect(client).toContain('export async function askEmailAssistantForContext');
});

test("Signal routes exact connector keys and opens tones in their editor", () => {
  expect(route).toContain("connectorKey?: string");
  expect(route).toContain('<EmailWorkspace initialConnectorKey={params.connectorKey} navigatedFromRoot={params.signalReturn === "root"} key={params.connectorKey ?? "root"} />');
  expect(workspace).toContain('onPress={() => router.push({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: account.connectorKey, signalReturn: "root" } })}');
  expect(workspace).toContain("onPress={() => openToneEdit(record)}");
  expect(workspace).not.toContain('params: { slug: "archive", documentKey: record.key }');
  expect(workspace).toContain("if (navigatedFromRoot && router.canGoBack()) router.back()");
});

test("new email snapshots every built-in and custom tone selector", () => {
  expect(workspace).toContain("record.slug ?? record.key");
  expect(workspace).toContain("BUILT_IN_EMAIL_TONES.map");
  expect(workspace).toContain("const snapshot = availableNewEmailTones.map");
  expect(workspace).toContain("generateNewEmailAlternatives(snapshot)");
  expect(client).toContain('emailToneSchema = z.string().trim().min(1).max(255)');
});

test("native back closes the topmost new-email descendant and remains history-aware", () => {
  expect(workspace).toMatch(/navigation\.addListener\("beforeRemove"[\s\S]*?if \(newEmailReviewOpen\)[\s\S]*?closeNewEmailReview\(\)[\s\S]*?if \(newEmailAlternativesOpen\)[\s\S]*?setNewEmailAlternativesOpen\(false\)[\s\S]*?if \(newEmailContentOpen\)[\s\S]*?setNewEmailContentOpen\(false\)[\s\S]*?if \(newEmailRecipientsOpen\)[\s\S]*?resetNewEmail\(\)/);
  expect(workspace).toMatch(/if \(selected\) \{\s*event\.preventDefault\(\);\s*clearSelectedThreadFromEffect\(\);[\s\S]*?if \(initialConnectorKey\)[\s\S]*?!navigatedFromRoot \|\| !router\.canGoBack\(\)/);
  expect(workspace).toMatch(/function returnToSignalRoot[\s\S]*?router\.canGoBack\(\)[\s\S]*?router\.back\(\)[\s\S]*?router\.replace/);
  expect(workspace).not.toContain("nativeNavigationAction");
});

test("native back is consumed without opening discard while an email send is in flight", () => {
  const beforeRemove = workspace.slice(workspace.indexOf('navigation.addListener("beforeRemove"'), workspace.indexOf("function resetNewEmail"));
  expect(beforeRemove).toMatch(/if \(sendGeneration\.current !== undefined \|\| busy === "send"\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/);
  expect(beforeRemove.indexOf("sendGeneration.current !== undefined")).toBeLessThan(beforeRemove.indexOf("newEmailReviewOpen"));
  expect(workspace).toContain("sendGeneration.current = generation");
  expect(workspace).toContain("if (sendGeneration.current === generation) sendGeneration.current = undefined");
});

test("new-email close and navigation cannot invalidate an in-flight send", () => {
  expect(workspace).toMatch(/function requestExit[\s\S]*?if \(sendGeneration\.current !== undefined \|\| busy === "send"\) return false;[\s\S]*?if \(newEmailOpen\) resetNewEmail\(\);/);
  expect(workspace).toMatch(/function closeNewEmailReview\(\) \{\s*if \(newEmailSending\) return;/);
  expect(workspace).not.toContain("discardComposer");
  expect(workspace).not.toContain("Discard changes");
  expect(workspace).not.toContain('accessibilityLabel="Cc recipients"');
  expect(workspace).not.toContain('accessibilityLabel="Bcc recipients"');
});

test("root legacy drafts require explicit inbox assignment without sending", () => {
  const assignBlock = workspace.slice(workspace.indexOf("async function assignDraft"), workspace.indexOf("async function changeInboxQuery"));
  expect(client).toContain("unassignedDrafts: z.array(emailDraftSchema).default([])");
  expect(workspace).toContain("visibleUnassignedDrafts.map((saved) => (");
  expect(workspace).toContain("<Text style={styles.rootCardMeta}>DRAFT</Text>");
  expect(workspace).toContain('setSheet("assignDraft")');
  expect(workspace).toMatch(/sheet === "assignDraft"[\s\S]*?metadataAccounts\.length[\s\S]*?<BottomSheetItem[\s\S]*?assignDraft\(account\.connectorKey\)/);
  expect(workspace).toContain("Connect an email provider before assigning this draft to an inbox.");
  expect(workspace).toMatch(/async function assignDraft[\s\S]*?assignEmailDraftForContext\(context, draftKey, connectorKey, requestKey\)[\s\S]*?operationIsCurrent[\s\S]*?invalidateQueries[\s\S]*?operationIsCurrent[\s\S]*?fetchQuery[\s\S]*?operationIsCurrent[\s\S]*?router\.push/);
  expect(assignBlock).not.toContain("sendEmailDraft");
  expect(workspace).toContain("No inboxes matched this search.");
});

test("authoritative inbox events replace stale continuation data", () => {
  expect(workspace).toContain("staleTime: 0");
  expect(workspace).toMatch(/const active = generation === overviewGeneration\.current[\s\S]*?if \(active\) \{[\s\S]*?setInboxView\(\(current\)[\s\S]*?options\.cursor && current\.overview[\s\S]*?options\.commitQuery \? nextQuery : current\.query/);
  expect(workspace).toContain('return active ? "applied" as const : "superseded" as const');
  expect(workspace).toContain("pageGeneration === overviewPageGeneration.current");
  expect(workspace).toMatch(/const refreshFromInboxEvent = useEffectEvent\(async \(\) => \{[\s\S]*?cancelQueries[\s\S]*?const refreshQuery = requestedInboxQuery\.current;[\s\S]*?void load\(refreshQuery, \{ commitQuery: refreshQuery !== committedInboxQuery\.current \}\);/);
  expect(workspace).toMatch(/if \(initialConnectorKey\) void queryClient\.fetchQuery\(\{[\s\S]*?signalQueryKeys\.overview\(emailContext\)[\s\S]*?fetchEmailOverviewForContext\(emailContext\)/);
  expect(workspace).toContain('event.type === "inbox.changed" || event.type === "event-stream.connected"');
});

test("inbox controls compose requested state while results remain latest-wins", () => {
  expect(workspace).toContain('useState<{ overview?: EmailOverview; query: EmailOverviewQuery }>(() => ({ query: committedInboxQuery.current }))');
  expect(workspace).toContain("return { overview: nextOverview, query: options.commitQuery ? nextQuery : current.query }");
  expect(workspace).toMatch(/async function changeInboxQuery[\s\S]*?await load\(next, \{ commitQuery: true \}\)[\s\S]*?result === "applied"/);
  expect(workspace).toMatch(/async function changeInboxQuery[\s\S]*?requestedInboxQuery\.current = next;[\s\S]*?setInboxControlsQuery\(next\)[\s\S]*?await load\(next, \{ commitQuery: true \}\)/);
  expect(workspace).toContain("setEmailOverviewReadState(requestedInboxQuery.current, readState)");
  expect(workspace).toContain("toggleEmailOverviewFacet(requestedInboxQuery.current, facet)");
  expect(workspace).toContain("normalizeEmailOverviewQuery({ ...requestedInboxQuery.current, search: next })");
  expect(workspace).toContain("loading || inboxQueryPending ? Array.from");
  expect(workspace).toMatch(/if \(options\.commitQuery\) \{[\s\S]*?requestedInboxQuery\.current = committedInboxQuery\.current;[\s\S]*?setInboxControlsQuery\(committedInboxQuery\.current\)/);
  expect(workspace).toContain("if (initialConnectorKey) setRetryInboxQuery(nextQuery)");
  expect(workspace).toContain("changeInboxQuery(retryInboxQuery)");
});

test("cursor loads stay bounded at 50, dedupe, and stop repeated cursors", () => {
  expect(workspace).toMatch(/const input = initialConnectorKey \? \{[\s\S]*?cursor: options\.cursor,\s*limit: 50,/);
  expect(workspace).toContain("fetchEmailOverviewForContext(emailContext, input)");
  expect(workspace).toContain("appendCursorItems(current.overview.threads, visibleValue.threads");
  expect(workspace).toContain("isNearScrollEnd({ offset: nativeEvent.contentOffset.y");
  expect(workspace).toContain("if (!cursor || loadingMore.current || loadingOverview.current || loading || loadError) return");
  expect(workspace).toContain("nextCursor: visibleValue.nextCursor === options.cursor ? null : visibleValue.nextCursor");
  expect(workspace).not.toContain("EventSource");
});

test("Signal inbox and tone metadata share one context-scoped root query", () => {
  expect(workspace).toMatch(/const metadataQuery = useQuery\(\{[\s\S]*?queryKey: signalQueryKeys\.overview\(emailContext\),[\s\S]*?queryFn: \(\) => fetchEmailOverviewForContext\(emailContext\)/);
  expect(workspace).toContain("const toneRecords = metadataOverview?.tones ?? []");
  expect(workspace).not.toContain("fetchEmailTonesForContext");
  expect(workspace).not.toContain("signalQueryKeys.tones");
  expect(workspace).not.toContain("SIGNAL_TONE_DIAGNOSTIC");
  expect(workspace).toContain("const countryCode = useAuthStore((state) => state.user?.countryCode);");
  expect(workspace).toMatch(/navigation\.addListener\("focus", \(\) => \{[\s\S]*?cancelQueries\(\{ queryKey: signalQueryKeys\.overview\(context\)[\s\S]*?invalidateQueries\(\{ queryKey: signalQueryKeys\.overview\(context\)/);
});

test("AI reader actions target canonical message endpoints without local fake generation", () => {
  expect(workspace).toContain('translateEmailMessageForContext(context, messageKey');
  expect(workspace).toContain('summarizeEmailMessageForContext(context, messageKey');
  expect(workspace).toContain('composeEmailDraftForContext(context, {');
  expect(workspace).not.toContain('setTimeout(() => setBody');
});

test("selected Signal operations propagate connector selectors and reset account-scoped state", () => {
  expect(workspace).toContain("connectorKey: initialConnectorKey");
  expect(workspace).toContain("syncEmailForContext(context, connectorKey)");
  expect(workspace).toContain("subscribeEmailForContext(context, connector.connectorKey)");
  expect(workspace).toContain("disconnectEmailForContext(context, connectorKey)");
  expect(workspace).toContain("detailGeneration.current += 1");
  expect(workspace.match(/clearSelectedThread\(\)/g)?.length).toBeGreaterThanOrEqual(6);
  expect(workspace).toMatch(/function clearSelectedThread\(preserveTrashOperation = false\) \{\s*detailGeneration\.current \+= 1;\s*readerGeneration\.current \+= 1;[\s\S]*?setSelected\(undefined\);/);
  expect(workspace).toMatch(/committedInboxQuery\.current = defaultInboxQuery\(\);[\s\S]*?setInboxView\(\{ query: committedInboxQuery\.current \}\);[\s\S]*?clearSelectedThreadFromEffect\(\);[\s\S]*?setQuery\(""\);/);
  expect(workspace).toMatch(/const generation = \+\+detailGeneration\.current;[\s\S]*?fetchEmailThread[\s\S]*?generation === detailGeneration\.current/);
  expect(workspace).toContain('router.replace({ pathname: "/capability/[slug]", params: { slug: "signal" } })');
  expect(workspace).not.toContain('router.push({ pathname: "/capability/[slug]", params: { slug: "signal" } })');
  expect(client).not.toContain("createdByMembershipKey:");
});

test("successful provider connection is not reversed by initial sync, subscription, or root refresh failures", () => {
  expect(workspace).toMatch(/function completeConnection[\s\S]*?Promise\.allSettled\(\[[\s\S]*?syncEmailForContext\(context, connector\.connectorKey\)[\s\S]*?subscribeEmailForContext\(context, connector\.connectorKey\)[\s\S]*?rootRefresh[\s\S]*?operationIsCurrent/);
  expect(workspace).toContain("Inbox connected. Initial sync or updates need another try.");
  expect(workspace).toContain("Inbox connected. The inbox list will refresh automatically.");
  expect(workspace).toMatch(/router\.push[\s\S]*?connectorKey: connector\.connectorKey[\s\S]*?signalReturn: "root"/);
  expect(workspace).toMatch(/exchangeEmailConnection\(code\)[\s\S]*?\.then\(\s*\(connector\) => completeConnectionFromEffect\(connector\),\s*\(failure: unknown\) => notifyLatest/);
  expect(workspace).toMatch(/connectProvider === "icloud"[\s\S]*?connectIcloudEmail\(\{ \.\.\.metadata, email, appPassword \}\)[\s\S]*?launchEmailConnection\(\{ \.\.\.metadata, provider: connectProvider \}\)[\s\S]*?finally \{\s*setBusy\(undefined\);\s*\}\s*if \(connector\) completeConnection/);
});

test("Signal Connect chooses a provider before opening provider-specific full forms", () => {
  expect(workspace).toContain('"connectProvider" | "connectForm"');
  expect(workspace).toContain('title={');
  expect(workspace).toContain('? "Choose email provider"');
  expect(workspace).toContain('<BottomSheetItem icon={<GoogleIcon size={20} />} onPress={() => openConnectForm("gmail")}');
  expect(workspace).toContain('<BottomSheetItem icon={<MicrosoftIcon size={20} />} onPress={() => openConnectForm("outlook")}');
  expect(workspace).toContain('<BottomSheetItem icon={<AppleIcon size={20} />} onPress={() => openConnectForm("icloud")}');
  expect(workspace).toContain('height={sheet === "trashRoot" || formSheet ? "full" : undefined}');
  expect(workspace).toContain('accessibilityLabel="Apple ID email"');
  expect(workspace).toContain('accessibilityLabel="App-specific password"');
  expect(workspace).toContain('secureTextEntry value={connectAppPassword}');
  expect(workspace).toContain('<Text style={styles.inputLabel}>Inbox name</Text>');
  expect(workspace).toContain('<Text style={styles.inputLabel}>Description (Optional)</Text>');
});

test("root Filter and Plus expose filtering, history, utility, and creation actions", () => {
  expect(workspace).toContain('accessibilityLabel="Filter Signal"');
  expect(workspace).toContain('onPress={() => void openSearchHistory()} size="md" variant="secondary">Search history</Button>');
  expect(workspace).toContain('<SearchHistorySheet');
  expect(workspace).toMatch(/async function openSearchHistory\(\) \{[\s\S]*?setSheetOpen\(false\);\s*await wait\(180\);[\s\S]*?setSheet\("searchHistory"\);\s*setSheetOpen\(true\);/);
  expect(workspace).toContain("const cached = queryClient.getQueryData<ContentSearchHistoryItem[]>(key)");
  expect(workspace).toContain("if (cached && !invalidated) return");
  expect(workspace).toContain("getUserSearchHistory(queryClient, historyContext)");
  expect(workspace).not.toContain("listContentSearchHistory");
  expect(workspace).toContain('accessibilityLabel="Create in Signal"');
  expect(workspace).toContain('hideHeading={hideSheetHeading}');
  expect(workspace).toContain('hideCloseButton={menuSheet}');
  expect(workspace).toContain('height={sheet === "trashRoot" || formSheet ? "full" : undefined}');
  const start = workspace.indexOf('sheet === "rootCreate" ? (');
  const end = workspace.indexOf(') : sheet === "trashRoot"', start);
  const menu = workspace.slice(start, end);
  expect(menu.match(/<BottomSheetItem/g)).toHaveLength(3);
  expect(menu).toContain('>Connect inbox</BottomSheetItem>');
  expect(menu).toContain('>Create email tone</BottomSheetItem>');
  expect(menu).toContain('>Reply context</BottomSheetItem>');
  expect(menu.indexOf('>Create email tone</BottomSheetItem>')).toBeLessThan(menu.indexOf('>Reply context</BottomSheetItem>'));
  expect(menu.indexOf('>Reply context</BottomSheetItem>')).toBeLessThan(menu.indexOf('>Connect inbox</BottomSheetItem>'));
  expect(menu).not.toContain('>Trash</BottomSheetItem>');
  expect(menu).not.toContain('icon={');
  expect(menu.match(/style=\{styles\.sheetAction\}/g)).toHaveLength(3);
  const plus = workspace.slice(workspace.indexOf('sheet === "plus" ? ('), workspace.indexOf(') : sheet === "bulkActions"'));
  expect(plus.match(/<BottomSheetItem/g)).toHaveLength(4);
  expect(plus).toContain("New email");
  expect(plus).toContain(">Connect inbox</BottomSheetItem>");
  expect(plus).toContain(">Create email tone</BottomSheetItem>");
  expect(plus).toContain(">Reply context</BottomSheetItem>");
  expect(plus.indexOf("New email")).toBeLessThan(plus.indexOf(">Create email tone</BottomSheetItem>"));
  expect(plus.indexOf(">Create email tone</BottomSheetItem>")).toBeLessThan(plus.indexOf(">Reply context</BottomSheetItem>"));
  expect(plus.indexOf(">Reply context</BottomSheetItem>")).toBeLessThan(plus.indexOf(">Connect inbox</BottomSheetItem>"));
  expect(plus).not.toContain("icon={");
  expect(plus.match(/style=\{styles\.sheetAction\}/g)).toHaveLength(4);
  expect(plus.match(/variant="secondary"/g)).toHaveLength(4);
  expect(plus).not.toContain("{inboxActionItems}");
  expect(plus).not.toContain("Drafts");
  expect(plus).not.toContain("Account");
  expect(plus).not.toContain("Sync inbox");
  expect(plus).not.toContain(">Trash</BottomSheetItem>");
  expect(plus).not.toContain("Disconnect inbox");
  const account = workspace.slice(workspace.indexOf('sheet === "account" ? ('), workspace.indexOf(') : sheet === "disconnect"'));
  expect(account).not.toContain("Drafts");
  expect(account).toContain("inboxActionItems");
  expect(account).not.toContain("Reply context");
  expect(workspace).toContain('onPress={() => void openTrashRoot()} style={styles.sheetAction} variant="secondary">Trash</BottomSheetItem>');
  expect(workspace).toContain('accessibilityLabel="Inbox name" editable={!busy}');
  expect(workspace).not.toContain("autoFocus");
  expect(workspace).toContain("const SHEET_INPUT_FOCUS_DELAY_MS = 300");
  expect(workspace).toContain("setTimeout(() => inputRef.current?.focus(), SHEET_INPUT_FOCUS_DELAY_MS)");
  expect(workspace).toContain('useDelayedInputFocus(sheetOpen && inputSheet ? `${sheet}:${connectProvider}` : undefined, sheetInputRef');
  expect(workspace).toContain('useDelayedInputFocus(readerSheetOpen && inputReaderSheet ? readerSheet : undefined, readerInputRef');
  expect(workspace).toContain('maxLength={255}');
  expect(workspace).toContain('maxLength={10000} multiline');
  expect(workspace).toContain('maxLength={20000} multiline');
  expect(workspace).toContain('accessibilityLabel="Tone writing instruction"');
  expect(workspace).toContain('? "Connect" : sheet === "toneCreate" ? "Create tone" : "Save"');
  expect(workspace).toMatch(/sheet === "connectForm"[\s\S]*?<ScrollView[\s\S]*?keyboardShouldPersistTaps="handled"/);
  expect(workspace).toMatch(/sheet === "toneCreate"[\s\S]*?<ScrollView[\s\S]*?keyboardShouldPersistTaps="handled"/);
  expect(workspace).toContain("const SHEET_TRANSITION_DELAY_MS = 230");
  expect(workspace).toMatch(/async function transitionToForm[\s\S]*?setSheetOpen\(false\);\s*await wait\(SHEET_TRANSITION_DELAY_MS\);[\s\S]*?setSheet\(nextSheet\);\s*setSheetOpen\(true\);/);
  expect(workspace).toContain("const sheetTransitionGeneration = formTransitionGeneration.current");
  expect(workspace).toContain("key={sheetTransitionGeneration}");
  expect(workspace).toContain("if (sheetTransitionGeneration !== formTransitionGeneration.current) return");
  expect(workspace).toContain('void transitionToForm("toneCreate"');
  expect(workspace).toContain('<Text style={styles.inputLabel}>Tone name</Text>');
  expect(workspace).toContain('<Text style={styles.inputLabel}>Writing instruction</Text>');
  const toneCreate = workspace.slice(workspace.indexOf('sheet === "toneCreate" ? ('), workspace.indexOf(') : sheet === "inboxEdit"'));
  expect(toneCreate).not.toContain("Description");
  expect(toneCreate).not.toContain("toneDescription");
  const toneEdit = workspace.slice(workspace.indexOf('sheet === "inboxEdit" || sheet === "toneEdit" ? ('), workspace.indexOf(') : sheet === "assignDraft"'));
  expect(toneEdit).toContain('sheet === "inboxEdit" ? <>');
  expect(toneEdit).not.toContain('accessibilityLabel="Tone description"');
  expect(workspace).toContain('metadataForm: { flexGrow: 1, gap: 12, paddingBottom: spacing.xl }');
  expect(workspace).toContain('contentContainerStyle={[styles.metadataForm, sheet === "inboxEdit" && styles.inboxEditForm]}');
  expect(workspace).toContain('inboxEditForm: { gap: spacing.lg }');
});

test("reply context manager uses full-height pills, guarded bulk delete, and one keyboard-safe editor", () => {
  expect(workspace).toContain("function ReplyContextSheets");
  expect(workspace).toContain('title="Reply context"');
  expect(workspace).toContain('shape="pill" size="md"');
  expect(workspace).toContain('accessibilityActions={canMutate ? [{ name: "longpress"');
  expect(workspace).toContain('accessibilityState={{ selected }}');
  expect(workspace).toContain('Context note selection toolbar');
  expect(workspace).toContain('activeSelectedKeys.length} selected');
  expect(workspace).toContain('deleteEmailReplyContextsForContext(operationContext, keys, requestKey)');
  expect(workspace).toContain('title={`Delete ${activeSelectedKeys.length === 1 ? "context note"');
  expect(workspace).toContain('No context notes yet.');
  expect(workspace).toContain('>Create context note</Button>');
  expect(workspace).toContain('accessibilityLabel="Create context note"');
  expect(workspace).toContain('title={editor?.mode === "create" ? "New context note" : "Edit context note"}');
  expect(workspace).toContain('accessibilityLabel="Context note text"');
  expect(workspace).toContain('useDelayedInputFocus(open && editor ? editor.mode : undefined, editorInputRef, canMutate)');
  expect(workspace).toContain('maxLength={4000} multiline');
  expect(workspace).toContain('<Text style={styles.inputLabel}>Name</Text>');
  expect(workspace).toContain('<Text style={styles.inputLabel}>Context</Text>');
  expect(workspace).toContain('inputLabel: { marginLeft: 2, color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 0.4 }');
  expect(workspace).toContain('keyboardShouldPersistTaps="handled"');
  expect(workspace).toContain('fetchEmailReplyContextsForContext(capturedContext)');
  expect(workspace).toContain('createEmailReplyContextForContext(operationContext');
  expect(workspace).toContain('updateEmailReplyContextForContext(operationContext');
  expect(workspace).toContain('operationIsCurrent(generation, operationContext)');
  expect(workspace).toContain('queryClient.getQueryData(signalQueryKeys.replyContexts(operationContext)) === expected');
  expect(workspace).toMatch(/const actionLabel = editor\.mode === "create"[\s\S]*?if \(editor\.mode === "create"\) onClose\(\);[\s\S]*?else closeEditor\(\);/);
  expect(workspace).not.toMatch(/longPressedNote\.current = key;\s*setTimeout/);
  expect(workspace).toContain('<BottomSheetItem onPress={openReplyContexts} style={styles.sheetAction} variant="secondary">Reply context</BottomSheetItem>');
  expect(workspace).not.toContain("<Pressable");
});

test("Signal menu options use the darker sheet treatment", () => {
  expect(workspace).toContain('sheetAction: { justifyContent: "center", backgroundColor: palette.voidBlack }');
});

test("attachment picker focuses search after its sheet opens", () => {
  expect(picker).toContain("const SHEET_INPUT_FOCUS_DELAY_MS = 300");
  expect(picker).toContain("setTimeout(() => searchInputRef.current?.focus(), SHEET_INPUT_FOCUS_DELAY_MS)");
  expect(picker).toContain("ref={searchInputRef}");
  expect(picker).not.toContain("autoFocus");
});

test("Signal forms close directly and viewer tones remain read-only", () => {
  expect(workspace).not.toContain("formBaseline");
  expect(workspace).not.toContain("formDirty");
  expect(workspace).toContain("function requestFormClose()");
  expect(workspace).toContain('onPress={requestFormClose}');
  expect(workspace).toContain('if (!open && formSheet) requestFormClose()');
  expect(workspace).not.toContain("setDiscardForm");
  expect(workspace).toContain('permissions.canMutate ? "Edit" : "View"');
  expect(workspace).toContain('editable={permissions.canMutate && !busy}');
  expect(workspace).toContain('disabled={!permissions.canMutate || Boolean(busy)}');
  expect(workspace).toContain('permissions.canMutate ? "Edit email tone" : "View email tone"');
});

test("inbox editing keeps cover upload while tones expose no cover capability", () => {
  expect(workspace).toContain('launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false, quality: 1 })');
  expect(workspace).toContain('normalizeCapturedJpeg(coverChange, { maxSide: 2400, compress: 0.88 })');
  expect(workspace).toContain('processingMode: "cover"');
  expect(workspace).toContain('fetchGalleryUploadStatus([job.key])');
  expect(workspace).toContain('metadataRequests.current.get(targetKey) !== request');
  expect(workspace).toContain("operationGeneration.current += 1");
  expect(workspace).toContain("operationIsCurrent(generation, context)");
  expect(workspace).toContain("toneCreateInFlight.current");
  expect(workspace).toContain("metadataInFlight.current");
  expect(workspace).toContain("candidate === expected ? inbox : candidate");
  expect(workspace).toContain("candidate === expected ? record : candidate");
  expect(workspace).toContain('function invalidateSignalMetadata(context: typeof emailContext)');
  expect(workspace).toMatch(/invalidateSignalMetadata[\s\S]*?signalQueryKeys\.overviews\(context\), refetchType: "none"/);
  expect(workspace).toContain("createEmailToneForContext(context");
  expect(workspace).toContain("updateEmailToneForContext(context");
  expect(workspace).toContain("updateEmailInboxForContext(context");
  expect(workspace).toContain('metadataCoverControl: { width: 88, height: 88');
  expect(workspace).toContain('{sheet === "inboxEdit" ? <View style={styles.metadataCoverControl}>');
  expect(workspace).not.toContain("editingTone?.coverUrl");
  expect(client).not.toContain("coverImageKey: keySchema.optional()");
  expect(workspace).toContain('metadataCoverRemove: { width: 42, height: 42, minHeight: 42');
  expect(workspace).toContain('patchSignalInbox(queryClient, context, inbox)');
  expect(workspace).toContain('upsertSignalTone(queryClient, context, record)');
  expect(workspace).not.toContain("<Pressable");
});

test("scope changes obsolete operations and clear Signal operation UI", () => {
  expect(workspace).toMatch(/const generation = \+\+operationGeneration\.current;[\s\S]*?setBusy\(undefined\);[\s\S]*?setSheet\("plus"\);[\s\S]*?setSheetOpen\(false\);/);
  expect(workspace).toMatch(/return \(\) => \{\s*operationGeneration\.current \+= 1;/);
});

test("inbox metadata authorization is independent from connector management", () => {
  expect(workspace).toContain('connected && permissions.canMutate ? <BottomSheetItem onPress={openInboxEdit} style={styles.sheetAction} variant="secondary">Edit</BottomSheetItem>');
  expect(workspace).toContain("connected && permissions.canManageConnector ? <BottomSheetItem");
});

test("tones expose guarded loading, error, and retry states", () => {
  expect(workspace).toContain("const tonesLoading = metadataQuery.isPending");
  expect(workspace).toContain("const toneError = metadataQuery.error ? messageFor(metadataQuery.error) : undefined");
  expect(workspace).toContain('accessibilityLabel="Loading Signal tones"');
  expect(workspace).toContain("Retry tones");
  expect(workspace).toMatch(/tonesLoading \|\| normalizedRootQuery[\s\S]*?: rootSearchError \?[\s\S]*?: toneError && !toneRecords\.length \?[\s\S]*?visibleTones\.length/);
});

test("root and inbox keep controls while rendering only compact local loading and error states", () => {
  expect(workspace).toContain('Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Loading Signal cards"');
  expect(workspace).toContain('Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Loading inbox messages"');
  expect(workspace).toContain('style={styles.paginationSkeleton}');
  expect(workspace).toContain('threadRowSkeleton: { width: "100%", height: 38');
  expect(workspace).toContain('minHeight: 44');
  expect(workspace).toContain('paginationSkeleton: { width: "100%", height: 38');
  expect(workspace).toContain('{inboxTab !== "drafts" && loadError ? <View accessibilityRole="alert" style={styles.inlineNotice}>');
  expect(workspace.indexOf('accessibilityLabel="Email read state"')).toBeLessThan(workspace.indexOf('accessibilityLabel="Loading inbox messages"'));
  expect(workspace).not.toContain("styles.skeletonList");
  expect(workspace).not.toContain("styles.tabsSkeleton");
  expect(workspace).not.toContain("styles.searchSkeleton");
});

test("Signal scopes root and tone states without pairing errors with empty states", () => {
  expect(workspace).toMatch(/rootTab === "inboxes" \? loading \|\| normalizedRootQuery[\s\S]*?loadError \? <View accessibilityRole="alert"/);
  expect(workspace).toContain('!loadError && !visibleAccounts.length && !visibleUnassignedDrafts.length');
  expect(workspace).toContain('!loading && !inboxQueryPending && !loadError && !overview?.threads.length');
  expect(workspace).toContain('!tonesLoading && !toneError && !visibleTones.length');
  expect(workspace).toContain('<View accessibilityRole="alert" style={styles.rootToneError}>');
  expect(workspace).toMatch(/rootTab === "inboxes"[\s\S]*?: tonesLoading \|\| normalizedRootQuery[\s\S]*?Array\.from/);
});

test("Signal filtered lists use the centered text-only empty-state pattern", () => {
  expect(workspace).toContain('"No messages match these filters."');
  expect(workspace).toContain('"No messages matched this search."');
  expect(workspace).toContain('"No drafts matched this search."');
  expect(workspace).toContain('<View style={styles.empty}><Text style={styles.centerText}>Trash is empty.</Text></View>');
  expect(workspace).not.toContain('<Text style={styles.emptyTitle}>No messages in this view</Text>');
  expect(workspace).not.toContain('<Text style={styles.emptyTitle}>No drafts</Text>');
});

test("Signal root search is debounced, semantic, cancellable, and tab-specific", () => {
  expect(workspace).toContain("const rootSearchRequest = useRef<AbortController | undefined>(undefined)");
  expect(workspace).toContain('searchEmailInboxesForContext(emailContext, query, false, controller.signal)');
  expect(workspace).toContain('searchEmailTonesForContext(emailContext, query, false, controller.signal)');
  expect(workspace).toContain('searchEmailInboxesForContext(emailContext, query, true, controller.signal)');
  expect(workspace).toContain('searchEmailTonesForContext(emailContext, query, true, controller.signal)');
  expect(workspace).toContain('setRootSearchResults(rootTab === "inboxes" ? { tab: rootTab, inboxes: [] } : { tab: rootTab, tones: [] })');
  expect(workspace).toContain('}, 300)');
  expect(workspace).toContain('}, 800)');
  expect(workspace).toContain('controller.abort()');
  expect(workspace).not.toContain('.toLowerCase().includes(normalizedRootQuery)');
  expect(client).toContain('collectionSlugs: ["inboxes"]');
  expect(client).toContain('collectionSlugs: ["email-tones"]');
  expect(client).toContain('collectionSlugs: ["email-messages"]');
  expect(client).toContain('collectionSlugs: ["email-drafts"]');
});

test("every Signal search runs after 300ms and records history after 800ms", () => {
  expect(workspace).toContain('const timeout = setTimeout(() => { void search(next, false, controller.signal); }, 300)');
  expect(workspace).toContain('searchEmailMessagesForContext(emailContext, initialConnectorKey, nextQuery, true, controller.signal)');
  expect(workspace).toContain('searchEmailDraftsForContext(emailContext, initialConnectorKey, next, true, controller.signal)');
  expect(workspace).toContain('}, 800)');
  expect(workspace).toContain('onSubmitEditing={() => void search(query, false)}');
  expect(picker).toContain('query.trim() ? 300 : 0');
  expect(picker).toContain('searchContentMatches(value, controller.signal, undefined, true)');
  expect(picker).toContain('searchGalleryImages({ query: value, recordHistory: true, limit: 100 }, controller.signal)');
  expect(picker).toContain('}, 800)');
});

test("Signal mobile controls expose non-overlapping effective touch targets", () => {
  expect(workspace).toContain('headerButton: { width: 32, height: 32, minHeight: 32');
  expect(workspace).toContain('rootTab: { flex: 1 }');
  expect(workspace).toContain('categoryTab: { minHeight: 28, flex: 1 }');
  expect(workspace).toContain('inboxFilterButton: { width: 44, height: 44, minHeight: 44 }');
  expect(workspace).toMatch(/accessibilityLabel="Filter Signal"[\s\S]{0,260}?size="sm" style=\{styles\.rootMenuButton\}/);
  expect(workspace).toContain('<FilterIcon size="sm" variant={rootFavoritesOnly ? "accent" : "default"} />');
  expect(workspace).toContain('accessibilityLabel="Show only favorite Signal items"');
  expect(workspace).toMatch(/accessibilityLabel="Email read state"[\s\S]*?size="xs" style=\{styles\.categoryTab\}/);
  expect(workspace).toMatch(/accessibilityLabel="Filter inbox"[\s\S]*?size="sm" style=\{styles\.inboxFilterButton\}/);
});

test("root cards announce favorites and the root grid honors the bottom safe area", () => {
  expect(workspace).toContain('account.isFavorite ? ", Favorite" : ""');
  expect(workspace).toContain('record.isFavorite ? ", Favorite" : ""');
  expect(workspace).toContain('{ paddingBottom: insets.bottom + spacing.xl }');
});

test("attachment picker loads and searches both real stores with persistent multi-selection", () => {
  expect(picker).toContain('listContentDocumentsAtLocation(undefined, operation.signal)');
  expect(picker).toContain('fetchGalleryOverview(undefined, undefined, 100, undefined, operation.signal)');
  expect(picker).toContain('useState<EmailAttachmentRef[]>(() => selection)');
  expect(picker).toContain('searchContentMatches(value, operation.signal, undefined, false)');
  expect(picker).toContain('searchGalleryImages({ query: value, recordHistory: false, limit: 100 }, operation.signal)');
  expect(picker).toContain('toggleEmailAttachment(current, ref)');
  expect(picker).toContain('working.length} of {MAX_ATTACHMENTS} selected');
  expect(picker).toContain('height="full"');
  expect(picker).toContain('contentFit="cover"');
  expect(picker).not.toContain('<Pressable');
});

test("attachment queries and working selection are invalidated across every ownership boundary", () => {
  expect(picker).toContain('const operation = searchOwner.begin()');
  expect(picker).toContain('searchOwner.isCurrent(operation.generation)');
  expect(picker).toMatch(/return \(\) => \{\s*clearTimeout\(timer\);\s*searchOwner\.invalidate\(\);/);
  expect(picker).toContain('}, [contextKey, open, query, searchOwner, tab]);');
  expect(picker).toContain('onOpenChange={(next) => { if (!next) closePicker(); }}');
  expect(picker).toMatch(/function changeQuery\(next: string\) \{\s*searchOwner\.invalidate\(\);\s*setQuery\(next\);/);
  expect(picker).toMatch(/function changeTab[\s\S]*?searchOwner\.invalidate\(\);[\s\S]*?setTab\(next\);/);
  expect(workspace).not.toContain("EmailAttachmentPicker");
});

test("all selected attachment controls remain reachable at the maximum", () => {
  expect(picker).toMatch(/<ScrollView accessibilityLabel=\{`Selected attachments, \$\{working\.length\} items`\} accessibilityRole="list"[\s\S]*?showsVerticalScrollIndicator style=\{styles\.selectedList\}>\{working\.map/);
  expect(picker).toContain('selectedList: { maxHeight: 176, marginTop: spacing.sm }');
  expect(picker).not.toContain('accessible style={styles.selectedPill}');
  expect(picker).toContain('accessibilityLabel={`Remove ${labelFor(ref)}`}');
});

test("opened threads use a latest-message document reader and guarded immutable AI versions", () => {
  expect(workspace).toContain("const cached = queryClient.getQueryData<Awaited<ReturnType<typeof fetchEmailThreadForContext>>>(detailKey)");
  expect(workspace).toContain("setSelected(cached ?? { thread, messages: [] })");
  expect(workspace).toContain('accessibilityRole="progressbar" style={[styles.readerDocument, styles.readerSkeleton]}');
  expect(workspace).not.toContain("loading={openingThreadKey === thread.key}");
  expect(workspace).toContain('setSelectedMessageKey([...detail.messages].sort((left, right) => right.sentAt.localeCompare(left.sentAt)');
  expect(workspace).not.toContain('accessibilityLabel="Conversation messages"');
  expect(workspace).not.toContain('styles.conversationTabs');
  expect(workspace).toContain('style={styles.readerDocument}');
  expect(workspace).toContain('contentContainerStyle={[styles.readerDocumentContent, { paddingBottom: insets.bottom + spacing.lg }]}');
  expect(workspace).not.toContain('<View style={styles.brief}>');
  expect(workspace).not.toContain('styles.detailEyebrow');
  expect(workspace).not.toContain('styles.recipientBlock');
  expect(workspace).toContain('<Text selectable style={styles.messageAddress}>{selectedMessage.from}</Text>');
  expect(workspace).not.toContain('styles.messageSender');
  expect(workspace).toContain('messageAddress: { minWidth: 0, flex: 1, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11');
  expect(workspace).not.toContain('selectedMessage.direction === "outbound" ? "You"');
  expect(workspace).toContain('formatEmailTimestamp(selectedMessage.sentAt)');
  expect(workspace).toContain('<Text selectable style={styles.messageSubject}>{selectedMessage.subject}</Text>');
  expect(workspace).toContain('<Text selectable style={styles.readerBody}>{selectedMessage.body}</Text>');
  expect(workspace).toContain('readerBody: { width: "100%", color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26');
  expect(workspace).toContain('readerTargetKey.current !== result.messageKey');
  expect(workspace).toContain('No translations yet.');
  expect(workspace).not.toContain('Restore original');
  expect(workspace).not.toContain('Replace original');
});

test("opening an email keeps background detail and read failures silent", () => {
  const opening = workspace.slice(workspace.indexOf("async function openThread"), workspace.indexOf("function toggleThreadSelection"));
  expect(opening).not.toContain("notify(");
  expect(opening).toContain("applyOptimisticThreads(context, connectorKey, [detail.thread])");
});

test("reader menus separate AI and provider-neutral message actions", () => {
  const ai = workspace.slice(workspace.indexOf('sheet === "ai" ? ('), workspace.indexOf('sheet === "plus" ? ('));
  for (const action of ["Translate", "Summarize"]) expect(ai).toContain(action);
  expect(ai).toContain('openReaderFlow("translate")');
  expect(ai).toContain('openReaderFlow("summaryVersions")');
  expect(ai).not.toContain("icon=");
  expect(ai).not.toContain("Reply all");
  const actions = workspace.slice(workspace.indexOf('sheet === "account" ? ('), workspace.indexOf('sheet === "disconnect" ? ('));
  expect(actions).toContain('onPress={openReplySuggestions}');
  expect(actions).toContain(">Reply</BottomSheetItem>");
  expect(actions).not.toContain(">Reply all</BottomSheetItem>");
  expect(actions).not.toContain("icon=");
  expect(workspace).toContain('sheet === "account" ? ""');
  expect(workspace).toContain('const menuSheet = sheet === "rootCreate" || sheet === "plus"');
  expect(workspace).toContain('sheet === "account";');
  expect(workspace).toContain('hideCloseButton={menuSheet}');
  expect(workspace).toContain('{selected.thread.isFavorite ? "Unfavorite" : "Favorite"}');
  for (const action of ["Find similar", "Mark unread", "Move to trash"]) expect(workspace).toContain(action);
  expect(actions).not.toContain("Summary versions");
  expect(workspace).toMatch(/function openReplySuggestions\(\)[\s\S]*?setSheetOpen\(false\);[\s\S]*?setReaderSheet\("replies"\);/);
  expect(workspace).toContain('throw firstFailure?.reason ?? new Error("Replies could not be generated.")');
  expect(workspace).toMatch(/function openReaderFlow\(next: ReaderSheet\)[\s\S]*?setSheetOpen\(false\);[\s\S]*?setReaderSheet\(next\);/);
  expect(workspace).not.toMatch(/<BottomSheetItem[^>]*>Delete<\/BottomSheetItem>/);
  expect(workspace).toContain('Move this email thread to Trash?');
  expect(workspace).toContain('trashEmailThreadsForContext(context, [threadKey], requestKey)');
  expect(workspace).toContain('notify("Trash update is pending repair.")');
});

test("reply generation ignores sync state and final send failures use a toast", () => {
  const send = workspace.slice(workspace.indexOf("async function sendSuggestedReply"), workspace.indexOf("function requestSuggestedReplySend"));
  expect(send).toContain('notify("Reply sent")');
  expect(send).toContain("notify(messageFor(failure))");
  expect(send).not.toContain("setReaderError(messageFor(failure))");
});

test("generated email pills use generic single-row numbered labels", () => {
  const start = workspace.indexOf('{readerSheet === "translate" || readerSheet === "translationReader" ? <View');
  const translations = workspace.slice(start, workspace.indexOf('{readerSheet === "translationForm"', start));
  expect(translations).toContain('<ClockIcon size="sm" variant="accent" />');
  expect(translations).toContain('style={styles.rowTitle}>Translation {version.version}</Text>');
  expect(translations).not.toContain("version.createdAt");
  expect(translations).not.toContain("rowSubtitle");
  const summaries = workspace.slice(workspace.indexOf('{readerSheet === "summaryVersions" || readerSheet === "summaryReader" ? <View'), workspace.indexOf('{readerSheet === "replies"'));
  expect(workspace).toContain('readerSheet === "summaryVersions" || readerSheet === "summaryReader" ? "Summaries"');
  expect(summaries).toContain('style={styles.rowTitle}>Summary {summary.version}</Text>');
  expect(summaries).not.toContain("summary.topic");
  expect(summaries).not.toContain("summary.createdAt");
  expect(summaries).not.toContain("rowSubtitle");
});

test("translation and summary pills open separate detail sheets over their version lists", () => {
  expect(workspace).toContain('readerSheet === "translate" || readerSheet === "translationReader" ? <View');
  expect(workspace).toContain('readerSheet === "summaryVersions" || readerSheet === "summaryReader" ? <View');
  expect(workspace).toContain('open={readerSheetOpen && readerSheet === "translationReader" && Boolean(selectedTranslation)}');
  expect(workspace).toContain('open={readerSheetOpen && readerSheet === "summaryReader" && Boolean(selectedSummary)}');
  expect(workspace).toContain('title={`Translation ${selectedTranslation?.version ?? ""}`}');
  expect(workspace).toContain('title={`Summary ${selectedSummary?.version ?? ""}`}');
});

test("translation versions open immediately without focusing the language form or losing a new result", () => {
  expect(workspace).toContain('const inputReaderSheet = readerSheet === "replyReader"');
  expect(workspace).toMatch(/function openReaderFlow\(next: ReaderSheet\)[\s\S]*?setSheetOpen\(false\);[\s\S]*?if \(next === "translate" \|\| next === "summaryVersions"\) setReaderLoading\(true\);[\s\S]*?setReaderSheet\(next\);[\s\S]*?setReaderSheetOpen\(true\);/);
  expect(workspace).toContain("pendingTranslationReaderKey.current = result.version.key");
  expect(workspace).toContain("pendingTranslationReaderKey.current !== selectedTranslationKey");
});

test("similar email pills truncate within symmetric padding", () => {
  expect(workspace).toContain('<Text ellipsizeMode="tail" numberOfLines={1} style={styles.similarResultText}>{result.subject}</Text>');
  expect(workspace).toContain('similarResult: { width: "100%", minHeight: 42, justifyContent: "flex-start", paddingHorizontal: 14');
  expect(workspace).toContain('similarResultText: { minWidth: 0, flex: 1');
});

test("Signal search and attachment search use the exact Archive and Gallery pill contract", () => {
  const contract = 'minHeight: 44, paddingLeft: 12, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page';
  expect(picker).toContain(`search: { ${contract} }`);
  expect(workspace).toMatch(/rootSearch: \{[\s\S]*?minHeight: 44,[\s\S]*?paddingLeft: 12,[\s\S]*?paddingRight: 8,[\s\S]*?gap: 7,[\s\S]*?borderRadius: 999,[\s\S]*?backgroundColor: palette\.page/);
  expect(workspace).toMatch(/searchBox: \{[\s\S]*?minHeight: 44,[\s\S]*?paddingLeft: 12,[\s\S]*?paddingRight: 8,[\s\S]*?gap: 7,[\s\S]*?borderRadius: 999,[\s\S]*?backgroundColor: palette\.page/);
  expect(picker).toContain('searchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: palette.page, fontSize: 13 }');
  expect(picker).not.toContain('accessibilityLabel="Search attachments"');
});

test("all Signal text inputs use the darker page background", () => {
  expect(workspace).toContain('const signalInputStyle = StyleSheet.create({ input: { backgroundColor: palette.page } }).input;');
  expect(workspace).toContain('<SharedTextInput {...props} ref={ref} style={[style, signalInputStyle]} />');
  expect(workspace).toContain('style={styles.signalComposer}');
  expect(workspace).toContain('signalComposer: { backgroundColor: palette.page }');
  expect(picker).toContain('searchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: palette.page');
});

test("reply generation and post-send selection remain explicit", () => {
  expect(workspace).toContain('replyMode: "reply"');
  expect(workspace).toContain('created.variant !== "reply"');
  expect(workspace).toContain('sent.messageKey ?? latestSentEmailMessageKey(detail.messages)');
  expect(workspace).toContain('Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Generating reply options"');
  expect(workspace).toContain('const generated = await Promise.allSettled(selectors.map');
  expect(workspace).toContain('style={styles.replyReviewInput}');
  expect(workspace).toContain('if (hasAdditionalReplyParticipants()) setReplyModeOpen(true)');
  expect(workspace).toContain('sendEmailDraftForContext(context, prepared.key, requestKey, mode)');
  expect(workspace).toContain('<BottomSheet dismissible={!replySending} hideHeading');
});

test("message headers follow detail icon placement and new email owns separate sheets", () => {
  expect(workspace).toContain('globalHeader: {\n    minHeight: 64');
  expect(workspace).toContain('localHeader: {\n    minHeight: 44');
  expect(workspace).toMatch(/localTitle: \{[\s\S]*?fontSize: 21/);
  expect(workspace).toMatch(/accessibilityLabel="Create in Signal"[\s\S]{0,220}?size="xs"/);
  expect(workspace).toContain('<WorkspaceAppSwitcher active="signal" onBeforeSelect={(slug) => requestExit(slug)} trigger="back" />');
  expect(workspace).toMatch(/<View style=\{styles\.readerActions\}><Button accessibilityLabel="Open Signal AI Brain menu"[\s\S]{0,260}?size="sm"[\s\S]{0,260}?<Button accessibilityLabel="More email actions"[\s\S]{0,260}?size="sm"/);
  expect(workspace).not.toMatch(/<View style=\{styles\.localActions\}>[\s\S]{0,120}?More email actions/);
  expect(workspace).not.toContain("headerTrailing=");
  expect(workspace).toContain('title="Recipients"');
  expect(workspace).not.toMatch(/selectedMessage[\s\S]{0,120}?PlusIcon/);
});

test("favorite and trash calls are owned by captured context and selected thread", () => {
  expect(workspace).toContain('favoriteInFlight.current');
  expect(workspace).toContain('setEmailThreadsFavoriteForContext(context, [threadKey], nextFavorite, requestKey)');
  expect(workspace).toMatch(/generation !== favoriteGeneration\.current \|\| !contextIsCurrent\(context\) \|\| initialConnectorKey !== connectorKey/);
  expect(workspace).not.toMatch(/favoriteGeneration\.current[^\n]+selectedThreadKeyRef/);
  expect(workspace).toContain('Move this email thread to Trash?');
});

test("Trash uses an invisible lock while closing and patching optimistically", () => {
  expect(workspace).toContain('const [trashBusy, setTrashBusy] = useState(false)');
  expect(workspace).toMatch(/async function trashThread[\s\S]*?const generation = \+\+trashGeneration\.current;[\s\S]*?setTrashBusy\(true\);/);
  expect(workspace).toContain('applyOptimisticThreads(context, connectorKey, [optimistic])');
  expect(workspace).toContain('clearSelectedThread(true)');
  expect(workspace).toContain('dismissible={!trashBusy && !generatedDeleteBusy && !replySending && !replyEnhancing}');
  expect(workspace).toContain('<Button disabled={trashBusy} onPress={() => void trashThread()}');
  expect(workspace).toContain('<Button disabled={trashBusy} onPress={closeReaderFlow}');
  expect(workspace).toContain('<BottomSheetItem disabled={trashBusy} onPress={openReplySuggestions}');
});

test("Gallery message attachments are truthful non-interactive rows", () => {
  expect(workspace).toContain('Gallery image · Preview unavailable');
  expect(workspace).toContain('style={[styles.incomingAttachment, styles.incomingAttachmentStatic]}');
  expect(workspace).not.toMatch(/attachment\.type === "image"[\s\S]{0,400}?router\.push/);
  expect(workspace).toContain('params: { slug: "archive", documentKey: attachment.key }');
});

test("inbox controls preserve results without a separate refresh line", () => {
  expect(workspace).not.toContain("overviewRefreshing");
  expect(workspace).not.toContain('accessibilityLabel="Updating inbox"');
  expect(workspace).not.toContain("styles.refreshProgress");
  expect(workspace).toContain('accessibilityRole="alert" style={styles.inlineNotice}');
  expect(workspace).not.toContain('accessibilityLabel="Clear email search" contentMode="raw" disabled={workspaceBusy}');
});

test("read, unread, drafts, and opened records use invalidation-driven QueryClient caches", () => {
  const load = workspace.slice(workspace.indexOf("async function load(nextQuery"), workspace.indexOf("function invalidateNewEmailAlternatives"));
  const similarOpen = workspace.slice(workspace.indexOf("async function openSimilarResult"), workspace.indexOf("async function trashThread"));
  expect(load).not.toContain("staleTime: 0");
  expect(similarOpen).not.toContain("staleTime: 0");
  expect(workspace).toContain('type InboxTab = EmailReadState | "drafts"');
  expect(workspace).toContain('>Drafts</Button>');
  expect(workspace).toContain("signalQueryKeys.drafts(emailContext");
  expect(workspace).toContain("signalQueryKeys.draftDetail(emailContext");
  expect(workspace).toContain('description={selectedInboxDraft ? `To: ${selectedInboxDraft.to.join(", ")}` : undefined}');
  expect(workspace).toContain('onPress={() => void sendInboxDraft()} size="md" variant="primary">Send</Button>');
  expect(workspace).toContain('<View style={styles.inboxActions}>');
  expect(workspace).not.toContain('{inboxTab !== "drafts" ? <View style={styles.inboxActions}>');
  expect(workspace).toContain('accessibilityLabel={inboxTab === "drafts" ? "Search drafts" : "Search email"}');
  expect(workspace).toContain('accessibilityLabel="Draft email text"');
  expect(workspace).toContain('updateEmailDraftForContext(context, saved.key, finalContent, randomUUID())');
  expect(workspace.indexOf('updateEmailDraftForContext(context, saved.key, finalContent, randomUUID())')).toBeLessThan(workspace.indexOf('sendEmailDraftForContext(context, saved.key'));
  expect(workspace).not.toContain('>Drafts · {overview.drafts.length}</BottomSheetItem>');
});

test("compact Signal controls retain accessible touch targets", () => {
  expect(workspace).toContain('accessibilityLabel="Clear Signal search" contentMode="raw" hitSlop={8}');
  expect(workspace).toContain('accessibilityLabel="Clear email search" contentMode="raw" hitSlop={8}');
  expect(workspace).toContain('accessibilityLabel="Clear email selection" contentMode="raw" disabled={bulkBusy} hitSlop={8}');
});

test("similar email uses ten threshold-free thin pills and opens the normal reader", () => {
  expect(workspace.match(/style={styles.categoryTabs}/g)).toHaveLength(1);
  expect(workspace.match(/size="xs" style={styles.categoryTab}/g)).toHaveLength(2);
  expect(workspace).not.toContain('accessibilityLabel="Similar email categories"');
  expect(workspace).toContain('findSimilarEmailMessagesForContext(context, messageKey, { limit: 10 })');
  expect(workspace).toContain('similarResult: { width: "100%", minHeight: 42');
  expect(workspace).toMatch(/async function openSimilarResult[\s\S]*?const detail = await queryClient\.fetchQuery[\s\S]*?generation !== detailGeneration\.current[\s\S]*?!contextIsCurrent\(context\)[\s\S]*?selectedThreadKeyRef\.current !== sourceThreadKey[\s\S]*?setSelected\(detail\);[\s\S]*?setReaderSheetOpen\(false\);[\s\S]*?setSheetOpen\(false\);/);
});

test("reply options are fresh per tone and support empty AI-enhanced replies", () => {
  expect(workspace).toContain('const generation = ++readerGeneration.current');
  expect(workspace).toContain('Promise.allSettled(selectors.map');
  expect(workspace).toContain('BUILT_IN_EMAIL_TONES.map((tone) => ({ label: tone, tone }))');
  expect(workspace).toContain('onPress={openEmptyReply} size="md" variant="primary">Empty reply</Button>');
  expect(workspace).toContain('accessibilityLabel="Enhance reply"');
  expect(workspace).toContain('title="Enhance reply"');
  expect(workspace).toContain('setReplyEnhanceOpen(false);');
  expect(workspace).toContain('enhanceAppTextForContext(context, text)');
  expect(workspace).toContain('accessibilityLabel="Enhancing reply" accessibilityRole="progressbar"');
});

test("surfaces provider and disconnected-account failures through shared toasts", () => {
  expect(workspace).not.toContain('/no connected gmail account|no email account connected/i.test(title)');
  expect(workspace).toMatch(/const notify = \(title: string\) => \{\s*showToast\(\{ title, duration: 2_000 \}\);/);
});

test("manual inbox sorting is not exposed", () => {
  expect(workspace).not.toContain("sortEmailInboxForContext");
  expect(workspace).not.toContain("Sort inbox");
});

test("disconnect uses a title-only compact confirmation", () => {
  const confirmation = workspace.slice(workspace.indexOf('sheet === "disconnect" ? ('), workspace.indexOf(') : null}', workspace.indexOf('sheet === "disconnect" ? (')));
  expect(confirmation).not.toContain("confirmText");
  expect(confirmation).toContain('variant="primary"');
  expect(confirmation).toContain('>\n              Disconnect inbox\n            </Button>');
  expect(confirmation).toContain('variant="secondary"');
  expect(confirmation).toContain('>\n              Close\n            </Button>');
  expect(confirmation).not.toContain("Cancel");
});

test("reader flows open immediately and retain context, thread, and message ownership", () => {
  const operation = workspace.slice(workspace.indexOf("function openReaderFlow"), workspace.indexOf("function hasAdditionalReplyParticipants"));
  expect(operation).not.toContain("await wait(180)");
  expect(operation).toContain("setSheetOpen(false)");
  expect(operation.indexOf("setReaderSheetOpen(true)")).toBeLessThan(operation.indexOf("await queryClient.fetchQuery"));
  expect(operation.indexOf("setReaderSheetOpen(true)")).toBeLessThan(operation.indexOf("requestAnimationFrame"));
  expect(workspace).toContain("selectedThreadKeyRef.current === threadKey && selectedMessageKeyRef.current === messageKey");
  expect(workspace).toMatch(/function clearSelectedThread\(preserveTrashOperation = false\)[\s\S]*?readerGeneration\.current \+= 1;[\s\S]*?selectedThreadKeyRef\.current = undefined;/);
});

test("trash reconciliation is optimistic and cannot write across context", () => {
  const operation = workspace.slice(workspace.indexOf("async function trashThread()"), workspace.indexOf("async function disconnect"));
  for (const capture of ["previousThread", "context", "connectorKey", "threadKey", "generation", "optimistic"]) expect(operation).toContain(`const ${capture}`);
  expect(operation).toContain("generation !== trashGeneration.current || !contextIsCurrent(context)");
  expect(operation).toContain("generation === trashGeneration.current && contextIsCurrent(context)");
  expect(operation).toContain("signalQueryKeys.accountOverviews(context, connectorKey)");
  expect(operation).not.toContain("removeSignalThread");
  expect(operation).not.toContain("await load()");
  expect(operation).toContain("applyAuthoritativeThreads(context, connectorKey, [item.thread])");
  expect(operation).not.toContain("queryClient.getQueryData<EmailOverview>");
});

test("thread selection persists across views and exposes exact bulk actions", () => {
  expect(workspace).toContain("const [selectedThreads, setSelectedThreads] = useState<EmailThread[]>([])");
  expect(workspace).toContain("if (current.length >= 50)");
  expect(workspace).toContain('onLongPress={() => handleThreadLongPress(thread)}');
  expect(workspace).toContain('accessibilityState={{ selected: selectedThreads.some(({ key }) => key === thread.key) }}');
  expect(workspace).toContain('{selectedThreads.length} selected');
  for (const action of ["Favorite", "Unfavorite", "Mark read", "Mark unread", "Move to trash"]) expect(workspace).toContain(action);
  expect(workspace).toContain('setEmailThreadsFavoriteForContext(context, threadKeys, isFavorite, requestKey)');
  expect(workspace).toContain('setEmailThreadsReadStateForContext(context, threadKeys, isRead, requestKey)');
  expect(workspace).toContain('trashEmailThreadsForContext(context, threadKeys, requestKey)');
  expect(workspace).toContain('current.map((selectedThread) => visibleValue.threads.find(({ key }) => key === selectedThread.key) ?? selectedThread)');
});

test("email bulk selection matches the Archive toolbar and action-menu contract without dimming pills", () => {
  const inbox = workspace.slice(workspace.indexOf('<View style={styles.inbox}>'), workspace.indexOf('{selected ? ('));
  expect(inbox.indexOf("{bulkToolbar}")).toBeLessThan(inbox.indexOf('accessibilityLabel="Email read state"'));
  expect(workspace).toContain('bulkToolbar: { minHeight: 40, marginHorizontal: spacing.md, padding: 5');
  expect(workspace).toContain('sheet === "account";');
  expect(workspace).toContain('sheet === "bulkActions" ? ""');
  const bulkActions = workspace.slice(workspace.indexOf('sheet === "bulkActions" ? ('), workspace.indexOf(') : sheet === "bulkTrash"'));
  expect(bulkActions).not.toContain("icon={");
  expect(bulkActions.match(/style=\{styles\.sheetAction\}/g)).toHaveLength(3);
  const openBulkActions = workspace.slice(workspace.indexOf("async function openBulkActions()"), workspace.indexOf("async function toggleReadState()"));
  expect(openBulkActions).toContain("setBulkActionsLoading(true)");
  expect(openBulkActions).not.toContain("setBulkBusy(true)");
  expect(workspace).toContain("selectionGeneration.current += 1;\n    setBulkActionsLoading(false);\n    setSelectedThreads([]);");
});

test("inbox spacing and email-pill type follow the Archive hierarchy", () => {
  expect(workspace).toContain('localHeader: {\n    minHeight: 44,\n    marginTop: spacing.md');
  expect(workspace).toContain('style={[styles.localHeader, !selected && styles.inboxHeader]}');
  expect(workspace).toContain('style={[styles.localTitle, !selected && styles.inboxTitle, selected && styles.threadHeaderTitle]}');
  expect(workspace).toContain('inboxHeader: { minHeight: 48 }');
  expect(workspace).toContain('inboxTitle: { fontSize: 24, letterSpacing: 0 }');
  expect(workspace).toContain('inbox: { flex: 1, gap: spacing.md, paddingTop: spacing.md - spacing.xs }');
  expect(workspace).toContain('inboxActions: { minHeight: 52');
  expect(workspace).toContain('rootContent: { minHeight: 0, flex: 1, gap: spacing.md }');
  expect(workspace).toContain('rootGrid: { flexGrow: 1, alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10, paddingBottom: spacing.xl }');
  expect(workspace).toContain('threadList: { paddingHorizontal: spacing.md, gap: spacing.sm }');
  expect(workspace).toMatch(/subject: \{[\s\S]*?fontFamily: fonts\.medium,[\s\S]*?fontSize: 12,/);
  expect(workspace).toContain('subjectUnread: { color: palette.silver50, fontFamily: fonts.medium }');
});

test("inbox Trash is scoped to the selected connector and clears with partial failure retention", () => {
  expect(workspace).toContain('if (!initialConnectorKey) return;');
  expect(workspace).toContain('metadataAccounts.filter(({ connectorKey }) => connectorKey === initialConnectorKey)');
  expect(workspace).toContain('filter: "trash", cursor, limit: 50');
  expect(workspace).toContain('loadEmailTrashGroups(accounts');
  expect(workspace).toContain('for (const group of groups)');
  expect(workspace).toContain('clearEmailTrashForContext(context, group.connector.connectorKey, requestKeys.get(group.connector.connectorKey)!)');
  expect(workspace).toContain('const failures = new Map<string, string>()');
  expect(workspace).toContain('failures.set(group.connector.connectorKey, messageFor(failure))');
  expect(workspace).toContain('return error ? [{ ...group, error }] : []');
  expect(trashAggregation).toContain('seenCursors.has(nextCursor)');
  expect(trashAggregation).toContain('pageIndex === maxPages - 1');
  expect(workspace).toContain('clearSignalTrashCaches(queryClient, context, group.connector.connectorKey)');
  expect(workspace).toContain('restoreSignalTrashCaches(queryClient, removal)');
  const trashRoot = workspace.slice(workspace.indexOf('sheet === "trashRoot" ? ('), workspace.indexOf(') : sheet === "clearTrash"'));
  const confirmation = workspace.slice(workspace.indexOf('sheet === "clearTrash" ? ('), workspace.indexOf(') : sheet === "connectProvider"'));
  expect(trashRoot).toContain('shape="pill" size="sm" style={styles.threadCard} variant="secondary"');
  expect(trashRoot).toContain('Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Loading Trash"');
  expect(trashRoot).toContain('trashGroups.flatMap(({ threads }) => threads).map');
  expect(trashRoot).not.toContain("connector.name");
  expect(trashRoot).not.toContain("connector.email");
  expect(trashRoot).not.toContain("No trashed messages");
  expect(workspace).toContain('trashRootContent: { gap: spacing.sm, paddingTop: spacing.sm, paddingBottom: spacing.xl }');
  expect(workspace).toContain('onPress={() => setSheet("clearTrash")} size="md" variant="primary">Clear trash</Button>');
  expect(confirmation).toContain('variant="primary">Clear trash</Button>');
  expect(confirmation).toContain('variant="secondary">Close</Button>');
  expect(confirmation).not.toContain("confirmText");
  expect(workspace).not.toContain("trashed Gmail");
  expect(workspace).not.toContain("trashThreadCard");
});

test("context changes synchronously remount and cancel a clean new-email session", () => {
  expect(workspace).toContain('const sessionKey = `${emailContext.organizationKey}:${emailContext.scopeKey}:${initialConnectorKey ?? "root"}`');
  expect(workspace).toContain('<EmailWorkspaceSession emailContext={emailContext} initialConnectorKey={initialConnectorKey} key={sessionKey} navigatedFromRoot={navigatedFromRoot} />');
  for (const initialState of ['useState("")', 'useState<string[]>([])', 'useState<NewEmailAlternative[]>([])', 'useState(false)']) expect(workspace).toContain(initialState);
  expect(workspace).toContain("newEmailGeneration.current += 1");
  expect(workspace).toContain("request.controller.abort()");
  expect(picker).toMatch(/return \(\) => \{[\s\S]*?searchOwner\.invalidate\(\);/);
});

test("all authoritative read, favorite, Trash, and bulk completions use one idempotent reconciler", () => {
  const reconciler = workspace.slice(workspace.indexOf("function applyAuthoritativeThreads"), workspace.indexOf("async function openBulkActions"));
  expect(reconciler).toContain("const reconciled = reconcileSignalThreads");
  expect(reconciler).toContain("reconcileSignalOverviewThreads(current.overview, reconciled.updates, current.query");
  expect(reconciler).toContain("setSelectedThreads");
  expect(workspace.match(/applyAuthoritativeThreads\(context, connectorKey,/g)?.length).toBeGreaterThanOrEqual(6);
  expect(workspace).not.toContain("current.counts.favorite + delta");
  expect(workspace).not.toContain("current.counts.unread - (becameRead");
});

test("only authoritative thread records settle repair-pending fields", () => {
  const authoritative = workspace.slice(workspace.indexOf("function applyAuthoritativeThreads"), workspace.indexOf("function applyOptimisticThreads"));
  const optimistic = workspace.slice(workspace.indexOf("function applyOptimisticThreads"), workspace.indexOf("function applySignalThreads"));
  expect(authoritative).toContain("settleRepairPendingThreads(updates)");
  expect(optimistic).not.toContain("settleRepairPendingThreads");
  expect(workspace).toContain("applyOptimisticThreads(context, connectorKey, [optimistic])");
});

test("bulk action labels hydrate hidden selections without marking mail read", () => {
  const hydration = workspace.slice(workspace.indexOf("async function openBulkActions"), workspace.indexOf("async function toggleReadState"));
  expect(hydration).toContain("fetchEmailThreadForContext(context, key)");
  expect(hydration).not.toContain("markRead");
  expect(hydration).toContain("generation !== selectionGeneration.current");
  expect(hydration).toContain("!contextIsCurrent(context)");
  expect(hydration).toContain("applyAuthoritativeThreads(context, connectorKey");
  expect(workspace).toContain("reconcileSignalSelectedThreads(current, reconciled.updates)");
  expect(workspace).toContain('onPress={() => void openBulkActions()}');
});

test("touch and accessibility longpress paths do not share synthetic press suppression", () => {
  expect(workspace).toMatch(/function handleThreadLongPress[\s\S]*?longPressedThread\.current = thread\.key;[\s\S]*?toggleThreadSelection/);
  expect(workspace).toContain('onAccessibilityAction={({ nativeEvent }) => { if (nativeEvent.actionName === "longpress") { toggleThreadSelection(thread); void Haptics.selectionAsync(); } }}');
});

test("provider-duration operations capture context and guard every continuation", () => {
  for (const name of ["synchronize", "assignDraft", "openSimilarResult", "disconnect"]) {
    const start = workspace.indexOf(`async function ${name}`);
    const end = workspace.indexOf("\n  async function ", start + 20);
    const operation = workspace.slice(start, end < 0 ? undefined : end);
    expect(operation).toContain("const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey }");
    expect(operation).toMatch(/operationIsCurrent|contextIsCurrent/);
  }
  expect(workspace).toContain("assignEmailDraftForContext(context, draftKey, connectorKey, requestKey)");
  expect(workspace).toContain("disconnectEmailForContext(context, connectorKey)");
});

test("same-frame new-email sends are rejected by the synchronous owner", () => {
  expect(workspace).toMatch(/async function sendNewEmail[\s\S]*?if \(newEmailSendInFlight\.current \|\| newEmailSending\) return;[\s\S]*?newEmailSendInFlight\.current = true;/);
  expect(workspace).toContain("newEmailGenerationOwner.current");
  expect(workspace).toContain("newEmailToneRequestKeys.current");
});

test("custom tones retain optimistic canonical hard-delete while dead composer draft deletion is removed", () => {
  expect(workspace).not.toContain("deleteEmailDraftForContext(context, saved.key, requestKey)");
  expect(workspace).toContain("deleteEmailToneForContext(context, record.key, requestKey)");
  expect(workspace).not.toContain('variant="danger">Delete draft</Button>');
  expect(workspace).toContain('variant="danger">Delete tone</Button>');
  expect(client).toContain('requestForContext(context, "delete", `/email/drafts/${keySchema.parse(draftKey)}`');
  expect(client).toContain('requestForContext(context, "delete", `/email/tones/${keySchema.parse(toneKey)}`');
  expect(workspace).toContain('sheet === "toneEdit" && permissions.canMutate && !editingTone?.slug');
  expect(workspace).toContain('if (!record || record.slug || deleteToneInFlight.current) return;');
  expect(workspace).not.toContain('if (current === optimisticCache)');
  expect(workspace).not.toContain('const cachesStillOptimistic = caches.every');
});

test("same-frame Signal mutations use synchronous owners without adding spinners", () => {
  expect(workspace).toContain("const readInFlight = useRef(new Set<string>())");
  expect(workspace).toContain("const bulkInFlight = useRef(false)");
  expect(workspace).toContain("const trashInFlight = useRef(false)");
  expect(workspace).toContain("const trashClearInFlight = useRef(false)");
  expect(workspace).toContain("readInFlight.current.has(thread.key)");
  expect(workspace).toContain("readInFlight.current.add(thread.key)");
  expect(workspace).toContain("bulkInFlight.current = true");
  expect(workspace).toContain("trashInFlight.current = true");
  expect(workspace).toContain("trashClearInFlight.current = true");
});

test("Signal reserves shared loading indicators for fetch work", () => {
  const mutationLoading = [...workspace.matchAll(/loading=\{([^}]+)\}/g)].map((match) => match[1]);
  expect(mutationLoading).toEqual(["bulkActionsLoading", "assistantBusy", "searchHistoryLoading"]);
});

test("reply choices retain their independent full-screen review flow", () => {
  expect(workspace).not.toContain('accessibilityLabel="Reply mode"');
  expect(workspace).toContain('open={readerSheetOpen}');
  expect(workspace).toContain('readerSheet === "replyReader"');
  expect(workspace).toContain('onPress={requestSuggestedReplySend} size="md" variant="primary">Reply</Button>');
});

test("Signal SSE refresh invalidates generated translation and summary families", () => {
  expect(workspace).toContain("queryClient.cancelQueries({ queryKey: signalQueryKeys.generated(emailContext) })");
  expect(workspace).toContain('queryClient.invalidateQueries({ queryKey: signalQueryKeys.overviews(emailContext), refetchType: "none" })');
  expect(workspace).toContain('queryClient.invalidateQueries({ queryKey: signalQueryKeys.details(emailContext), refetchType: "none" })');
  expect(workspace).toContain('queryClient.invalidateQueries({ queryKey: signalQueryKeys.generated(emailContext), refetchType: "none" })');
  expect(workspace).toContain('queryClient.invalidateQueries({ queryKey: signalQueryKeys.draftDetails(emailContext), refetchType: "none" })');
  expect(workspace).toContain('queryClient.refetchQueries({ queryKey: signalQueryKeys.generated(emailContext), type: "active" })');
  expect(workspace).toContain('queryClient.refetchQueries({ queryKey: signalQueryKeys.draftDetails(emailContext), type: "active" })');
});

test("bulk repair-pending state remains overlaid and selected until convergence", () => {
  expect(workspace).toContain('item.status === "failed" ? [item.threadKey] : []');
  expect(workspace).toContain('clearPendingThreadFields(completedKeys, [action])');
  expect(workspace).toContain('item.status === "repairPending" ? [item.threadKey] : []');
  expect(workspace).toContain('settleMatchingSignalRepairPendingFields(pendingThreadFields.current, repairPendingThreadFields.current, updates)');
  expect(workspace).toContain('...repairPendingThreadFields.current.keys()');
  expect(workspace).toContain('fetchEmailThreadForContext(context, key)');
  expect(workspace).not.toContain('for (const [threadKey, fields] of [...repairPendingThreadFields.current]) clearPendingThreadFields([threadKey], [...fields]);');
  expect(workspace).toContain('Email update is pending repair for ${report.repairPending}');
  expect(workspace).not.toContain('report.failed + report.repairPending');
});

test("singular Signal actions use report endpoints and retain repair-pending state", () => {
  expect(workspace).not.toContain("setEmailThreadFavoriteForContext");
  expect(workspace).not.toContain("trashEmailThreadForContext");
  expect(workspace).toContain('setEmailThreadsFavoriteForContext(context, [threadKey], nextFavorite, requestKey)');
  expect(workspace).toContain('setEmailThreadsReadStateForContext(context, [thread.key], nextRead, requestKey)');
  expect(workspace).toContain('trashEmailThreadsForContext(context, [threadKey], requestKey)');
  expect(workspace).toContain('retainRepairPendingField(threadKey, "favorite")');
  expect(workspace).toContain('retainRepairPendingField(thread.key, "read")');
  expect(workspace).toContain('retainRepairPendingField(threadKey, "trash")');
  expect(client).not.toContain("askEmailAssistant(");
});

test("attachment picker accepts returned named documents and excludes managed Gallery images", () => {
  expect(picker).toContain("filter(isSelectableEmailDocument)");
  expect(picker).not.toContain("systemManagedAttachmentFolderKeys");
  expect(picker).toContain("isManagedGalleryImage");
  expect(picker).toContain(".filter((image) => !isManagedGalleryImage(image))");
  expect(emailAttachmentPicker).not.toContain("managedFolderDefinitions");
});

test("AI results use Archive-style full-height sheets and close remains available during fetches", () => {
  expect(workspace).toContain("accessibilityElementsHidden={readerSheetOpen}");
  expect(workspace).toContain('importantForAccessibility={readerSheetOpen ? "no-hide-descendants" : "auto"}');
  expect(workspace).toMatch(/<BottomSheet[\s\S]*?height="full"[\s\S]*?open=\{readerSheetOpen\}/);
  expect(workspace).toContain('readerSheet === "translationForm" ? "Translate email"');
  expect(workspace).not.toContain('readerSheet === "summary"');
  expect(workspace).toContain('useState(() => languageForCountryCode(countryCode))');
  expect(workspace).toContain('setTargetLanguage(languageForCountryCode(countryCode)); setReaderSheet("translationForm")');
  expect(workspace).not.toMatch(/headerLeading=\{[^\n]*readerSheet/);
  expect(workspace).toContain('<Button disabled={readerLoading} onPress={() => { setTargetLanguage(languageForCountryCode(countryCode)); setReaderSheet("translationForm"); }} size="md" variant="primary">Translate</Button>');
  expect(workspace).toContain('<Button disabled={!permissions.canMutate || readerLoading || targetLanguage.trim().length < 2} onPress={() => void generateTranslation()} size="md" variant="primary">Translate</Button>');
  expect(workspace).toContain('<Button disabled={!permissions.canMutate || readerLoading} onPress={() => void generateSummary()} size="md" variant="primary">Summarize</Button>');
  const summaryGeneration = workspace.slice(workspace.indexOf("async function generateSummary"), workspace.indexOf("async function loadSimilar"));
  expect(summaryGeneration).toContain("summarizeEmailMessageForContext(context, messageKey, {}, requestKey)");
  expect(summaryGeneration).toContain("upsertSignalSummary(queryClient, context, messageKey, result.summary)");
  expect(summaryGeneration).toContain('setReaderGenerating("summary")');
  expect(summaryGeneration).not.toContain('setReaderSheet("summaryReader")');
  const translationGeneration = workspace.slice(workspace.indexOf("async function generateTranslation"), workspace.indexOf("async function generateSummary"));
  expect(translationGeneration).toContain('setReaderSheet("translate")');
  expect(translationGeneration).toContain('setReaderGenerating("translation")');
  expect(translationGeneration.indexOf('setReaderSheet("translate")')).toBeLessThan(translationGeneration.indexOf("translateEmailMessageForContext"));
  expect(workspace).toContain('readerGenerating === "translation" ? <Skeleton accessibilityLabel="Generating translation"');
  expect(workspace).toContain('readerGenerating === "summary" ? <Skeleton accessibilityLabel="Generating summary"');
  expect(workspace).not.toContain('accessibilityLabel="Summary topic"');
  expect(workspace).not.toContain("summaryStyles");
  expect(workspace).not.toContain('pageKey={readerSheet}');
  expect(workspace).toContain('style={[styles.versionPanel, !readerLoading && translations.length === 0 && styles.sheetEmptyContent]}');
  expect(workspace).toContain('style={styles.summaryVersionPanel}');
  expect(workspace).toContain('style={[styles.versionMain, selectedVersion && styles.generatedVersionSelected]}');
  expect(workspace).toContain('versionSkeleton: { width: "100%", height: 42, borderRadius: 999 }');
  expect(workspace).toContain('versionMain: { flex: 1, justifyContent: "flex-start", paddingHorizontal: 14 }');
  expect(workspace).toContain('<Button disabled={trashBusy} onPress={closeReaderFlow} size="md" variant="secondary">Close</Button>');
  expect(workspace).not.toContain("accessibilityViewIsModal");
  expect(workspace).not.toContain("styles.readerFlowHeader");
  expect(workspace).toMatch(/function closeReaderFlow\(\) \{\s*if \(trashBusy \|\| replySending\) return;\s*readerGeneration\.current \+= 1;[\s\S]*?setReaderSheetOpen\(false\);[\s\S]*?setReaderLoading\(false\);/);
});

test("generated message versions converge through functional cache upserts", () => {
  expect(workspace).toContain("upsertSignalTranslationVersion(queryClient, context, messageKey, result.version)");
  expect(workspace).toContain("upsertSignalSummary(queryClient, context, messageKey, result.summary)");
  expect(workspace).not.toContain("versions: [result.version, ...translations");
  expect(workspace).not.toContain("summaries: [result.summary, ...summaries");
});
