import { expect, test } from "bun:test";

const workspace = await Bun.file(new URL("../components/capability/EmailWorkspace.tsx", import.meta.url)).text();
const picker = await Bun.file(new URL("../components/capability/EmailAttachmentPicker.tsx", import.meta.url)).text();
const route = await Bun.file(new URL("../app/capability/[slug].tsx", import.meta.url)).text();
const client = await Bun.file(new URL("./email-client.ts", import.meta.url)).text();

test("Signal provides global identity and inbox/thread local headers", () => {
  expect(workspace).toMatch(/<WorkspaceAppSwitcher[\s\S]*?active="signal"[\s\S]*?onBeforeSelect/);
  expect(workspace).toContain('trigger="back"');
  expect(workspace).toContain('selected?.thread.subject ?? "Signal"');
  expect(workspace).toContain('accessibilityLabel="Open Signal AI Brain menu"');
  expect(workspace).toContain('accessibilityLabel="New Signal action"');
});

test("Signal exposes exactly three mutually exclusive inbox category tabs with Archive sizing", () => {
  expect(workspace).toContain('const INBOX_CATEGORIES: { category: EmailInboxCategory; filter: EmailFilter }[] = [');
  for (const value of ['{ category: "Urgent", filter: "urgent" }', '{ category: "Important", filter: "important" }', '{ category: "Filtered", filter: "filtered" }']) expect(workspace).toContain(value);
  expect(workspace).toContain('useState<EmailFilter>("important")');
  expect(workspace).toContain('accessibilityLabel="Signal inbox categories"');
  expect(workspace).toContain('size="xs" style={styles.categoryTab} variant={filter === item.filter ? "secondary" : "ghost"}');
  expect(workspace).toContain('categoryTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel }');
  expect(workspace).toContain('categoryTab: { flex: 1 }');
  expect(workspace).toContain('{item.category} · {inboxCategoryCount(overview, item.category)}');
  const accountMenu = workspace.slice(workspace.indexOf('sheet === "account"'), workspace.indexOf('sheet === "disconnect"'));
  expect(accountMenu).not.toContain('chooseFilter("urgent")');
  expect(accountMenu).not.toContain('chooseFilter("filtered")');
});

test("new and reply composers use canonical draft clients, attachments, and dirty interception", () => {
  expect(workspace).toContain('composeEmailDraftForContext(operation.context, { ...composeInput(), connectorKey: initialConnectorKey })');
  expect(workspace).toMatch(/createEmailDraftForContext\(operation\.context, \{\s*threadKey: selected!\.thread\.key/);
  expect(workspace).toContain('updateEmailDraftForContext(operation.context, created.key, body.trim())');
  expect(workspace).toContain('sendEmailDraftForContext(operation.context, prepared.key)');
  expect(workspace).toContain('composerOperationIsCurrent(operation.generation, operation.context)');
  expect(workspace).toContain('composerBusyGeneration.current !== operation.generation');
  expect(workspace).toContain('navigation.addListener("beforeRemove"');
  expect(workspace).toContain('const composerDirty = Boolean');
  expect(workspace).toContain('<EmailAttachmentPicker');
  expect(workspace).toContain('height={sheet === "composer" || formSheet ? "full"');
});

test("Signal root puts shared search before tabs and uses a measured exact three-column grid", () => {
  expect(workspace).toContain("useState<EmailToneRecord[]>([])");
  expect(workspace.indexOf('accessibilityLabel="Search Signal inboxes and tones"')).toBeLessThan(workspace.indexOf('accessibilityLabel="Signal root categories"'));
  expect(workspace).toContain("setRootGridWidth(nativeEvent.layout.width)");
  expect(workspace).toContain("- 16) / 3");
  expect(workspace).toContain("visibleTones.map((record) => (");
  expect(workspace).toMatch(/visibleTones\.map\(\(record\) => \(\s*<View[\s\S]*?<Button[\s\S]*?shape="rounded"/);
  expect(workspace).toContain('style={StyleSheet.absoluteFill}');
  expect(workspace).toContain("styles.coveredCardLabel");
  expect(workspace).toContain("account.isFavorite");
  expect(workspace).toContain("record.isFavorite");
  expect(workspace).toContain('rootTabs: { marginTop: 10, flexDirection: "row" }');
  expect(workspace).toContain("No inboxes yet.");
  expect(workspace).toContain("No tones yet.");
  expect(workspace).toContain('accessibilityLabel="Connect inbox"');
  expect(workspace).toContain('accessibilityLabel="Create email tone"');
  expect(workspace).toContain('emptyPlusButton: { width: 44, height: 44 }');
  expect(workspace).not.toContain('setSheet("tones")');
  expect(workspace).not.toContain("<Pressable");
});

test("Signal routes exact connector keys and opens tones in their editor", () => {
  expect(route).toContain("connectorKey?: string");
  expect(route).toContain('<EmailWorkspace initialConnectorKey={params.connectorKey} key={params.connectorKey ?? "root"} />');
  expect(workspace).toContain('onPress={() => router.replace({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: account.connectorKey } })}');
  expect(workspace).toContain("onPress={() => openToneEdit(record)}");
  expect(workspace).not.toContain('params: { slug: "archive", documentKey: record.key }');
  expect(workspace).not.toContain('router.push({ pathname: "/capability/[slug]", params: { slug: "signal"');
});

test("composer exposes server custom tone keys while preserving default slugs", () => {
  expect(workspace).toContain("record.slug ?? record.key");
  expect(workspace).toContain("BUILT_IN_EMAIL_TONES.map");
  expect(workspace).toContain("setTone(item.value)");
  expect(client).toContain('emailToneSchema = z.string().trim().min(1).max(255)');
  expect(workspace).toContain('tone !== "concise"');
});

test("native back consumes thread and account hierarchy before leaving Signal", () => {
  expect(workspace).toMatch(/navigation\.addListener\("beforeRemove"[\s\S]*?if \(composerDirty\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?if \(selected\) \{\s*event\.preventDefault\(\);\s*clearSelectedThread\(\);[\s\S]*?if \(initialConnectorKey\) \{\s*event\.preventDefault\(\);\s*allowNavigation\.current = true;\s*router\.replace/);
  expect(workspace).toMatch(/function completeNativeBack[\s\S]*?if \(selected\)[\s\S]*?clearSelectedThread\(\)[\s\S]*?if \(initialConnectorKey\)[\s\S]*?router\.replace[\s\S]*?else navigation\.dispatch\(action\)/);
  expect(workspace).toContain('destination === "native" && nativeNavigationAction.current');
});

test("native back is consumed without opening discard while an email send is in flight", () => {
  const beforeRemove = workspace.slice(workspace.indexOf('navigation.addListener("beforeRemove"'), workspace.indexOf("function resetComposer"));
  expect(beforeRemove).toMatch(/if \(sendGeneration\.current !== undefined \|\| busy === "send"\) \{\s*event\.preventDefault\(\);\s*return;\s*\}/);
  expect(beforeRemove.indexOf("sendGeneration.current !== undefined")).toBeLessThan(beforeRemove.indexOf("if (composerDirty)"));
  expect(workspace).toContain('if (action === "send") sendGeneration.current = generation');
  expect(workspace).toContain("if (sendGeneration.current === operation.generation) sendGeneration.current = undefined");
});

test("discard and composer navigation cannot invalidate an in-flight send", () => {
  expect(workspace).toMatch(/function requestExit[\s\S]*?if \(sendGeneration\.current !== undefined \|\| busy === "send"\) return false;[\s\S]*?if \(!composerDirty\) return true;/);
  expect(workspace).toMatch(/function requestComposerClose\(\) \{\s*if \(sendGeneration\.current !== undefined \|\| busy === "send"\) return;/);
  expect(workspace).toMatch(/function discardComposer\(\) \{\s*if \(sendGeneration\.current !== undefined \|\| busy === "send"\) return;/);
  expect(workspace).toContain('<Button disabled={busy === "send"} onPress={discardFormSheet ? discardFormChanges : discardComposer}');
  for (const label of ["Email recipients", "Cc recipients", "Bcc recipients", "Email subject"]) {
    expect(workspace).toMatch(new RegExp(`accessibilityLabel="${label}"[\\s\\S]{0,100}?editable=\\{!busy\\}`));
  }
  expect(workspace).toMatch(/disabled=\{Boolean\(busy\)\}\s*icon=\{<PlusIcon size="sm" \/>\}[\s\S]*?Attachments/);
});

test("root legacy drafts require explicit inbox assignment without sending", () => {
  const assignBlock = workspace.slice(workspace.indexOf("async function assignDraft"), workspace.indexOf("async function chooseFilter"));
  expect(client).toContain("unassignedDrafts: z.array(emailDraftSchema).default([])");
  expect(workspace).toContain("visibleUnassignedDrafts.map((saved) => (");
  expect(workspace).toContain("<Text style={styles.rootCardMeta}>DRAFT</Text>");
  expect(workspace).toContain('setSheet("assignDraft")');
  expect(workspace).toMatch(/sheet === "assignDraft"[\s\S]*?overview\?\.accounts\.length[\s\S]*?<BottomSheetItem[\s\S]*?assignDraft\(account\.connectorKey\)/);
  expect(workspace).toContain("Connect Gmail before assigning this draft to an inbox.");
  expect(workspace).toMatch(/async function assignDraft[\s\S]*?assignEmailDraft\(unassignedDraft\.key, connectorKey\)[\s\S]*?invalidateQueries[\s\S]*?fetchQuery[\s\S]*?router\.replace/);
  expect(assignBlock).not.toContain("sendEmailDraft");
  expect(workspace).toContain("No inboxes or drafts matched this search.");
});

test("authoritative inbox events replace stale continuation data", () => {
  expect(workspace).toContain("staleTime: 0");
  expect(workspace).toMatch(/const active = generation === overviewGeneration\.current[\s\S]*?if \(active\) setOverview\(\(current\) => \{[\s\S]*?if \(options\.cursor && current\)[\s\S]*?return value;/);
  expect(workspace).toContain('return active ? "applied" as const : "superseded" as const');
  expect(workspace).toContain("pageGeneration === overviewPageGeneration.current");
  expect(workspace).toMatch(/const refreshFromInboxEvent = useEffectEvent\(async \(\) => \{[\s\S]*?cancelQueries[\s\S]*?void load\(\);/);
  expect(workspace).toMatch(/if \(initialConnectorKey\) void queryClient\.fetchQuery\(\{[\s\S]*?signalQueryKeys\.overview\(emailContext\)[\s\S]*?fetchEmailOverviewForContext\(emailContext\)/);
  expect(workspace).toContain('event.type === "inbox.changed" || event.type === "event-stream.connected"');
});

test("superseded filter and search loads cannot commit controls or restore an older query", () => {
  expect(workspace.match(/const candidate = \{ filter[^\n]+\};/g)).toHaveLength(2);
  expect(workspace.match(/const result = await load\([^\n]+\);\s*if \(result !== "failed" && overviewQuery\.current === candidate\) \{\s*set(?:Filter|SubmittedQuery)\(/g)).toHaveLength(2);
  expect(workspace.match(/else if \(result === "failed" && overviewQuery\.current === candidate\) overviewQuery\.current = previous;/g)).toHaveLength(2);
  expect(workspace.match(/if \(overviewQuery\.current === candidate\) overviewQuery\.current = previous;/g)).toHaveLength(2);
});

test("cursor loads stay bounded at 50, dedupe, and stop repeated cursors", () => {
  expect(workspace).toMatch(/fetchEmailOverviewForContext\(emailContext, \{[\s\S]*?cursor: options\.cursor,\s*limit: 50,/);
  expect(workspace).toContain("appendCursorItems(current.threads, value.threads");
  expect(workspace).toContain("isNearScrollEnd({ offset: nativeEvent.contentOffset.y");
  expect(workspace).toContain("if (!cursor || loadingMore.current || loadingOverview.current || loading || loadError) return");
  expect(workspace).toContain("nextCursor: value.nextCursor === options.cursor ? null : value.nextCursor");
  expect(workspace).not.toContain("EventSource");
});

test("returning focus bypasses cached tones and reloads edits", () => {
  expect(workspace).toMatch(/const loadToneRecords = \(\) => \{[\s\S]*?const context = toneContext\.current;[\s\S]*?queryKey: signalQueryKeys\.tones\(context\),[\s\S]*?queryFn: \(\) => fetchEmailTonesForContext\(context\),[\s\S]*?staleTime: 0,/);
  expect(workspace).toMatch(/navigation\.addListener\("focus", \(\) => \{[\s\S]*?cancelQueries\(\{ queryKey: signalQueryKeys\.tones\(context\)[\s\S]*?invalidateQueries\(\{ queryKey: signalQueryKeys\.tones\(context\)[\s\S]*?loadToneRecordsLatest\(\)/);
});

test("AI reader actions target canonical message endpoints without local fake generation", () => {
  expect(workspace).toContain('translateEmailMessageForContext(context, messageKey');
  expect(workspace).toContain('summarizeEmailMessageForContext(context, messageKey');
  expect(workspace).toContain('await prepareDraft(operation)');
  expect(workspace).not.toContain('setTimeout(() => setBody');
});

test("selected Signal operations propagate connector selectors and reset account-scoped state", () => {
  expect(workspace).toContain("connectorKey: initialConnectorKey");
  expect(workspace).toContain("syncEmail(initialConnectorKey)");
  expect(workspace).toContain("subscribeEmail(connector.connectorKey)");
  expect(workspace).toContain("disconnectEmail(initialConnectorKey)");
  expect(workspace).toContain("detailGeneration.current += 1");
  expect(workspace.match(/clearSelectedThread\(\)/g)?.length).toBeGreaterThanOrEqual(7);
  expect(workspace).toMatch(/function clearSelectedThread\(\) \{\s*detailGeneration\.current \+= 1;\s*readerGeneration\.current \+= 1;[\s\S]*?setSelected\(undefined\);/);
  expect(workspace).toMatch(/clearSelectedThread\(\);[\s\S]*?setFilter\("important"\);[\s\S]*?setQuery\(""\);[\s\S]*?setSubmittedQuery\(""\);/);
  expect(workspace).toMatch(/const generation = \+\+detailGeneration\.current;[\s\S]*?fetchEmailThread[\s\S]*?generation === detailGeneration\.current/);
  expect(workspace).toContain('router.replace({ pathname: "/capability/[slug]", params: { slug: "signal" } })');
  expect(workspace).not.toContain('router.push({ pathname: "/capability/[slug]", params: { slug: "signal" } })');
  expect(client).not.toContain("createdByMembershipKey:");
});

test("successful OAuth is not reversed by initial sync, watch, or root refresh failures", () => {
  expect(workspace).toMatch(/function completeConnection[\s\S]*?Promise\.allSettled\(\[[\s\S]*?syncEmail\(connector\.connectorKey\)[\s\S]*?subscribeEmail\(connector\.connectorKey\)[\s\S]*?rootRefresh/);
  expect(workspace).toContain("Gmail connected. Initial sync or live updates need another try.");
  expect(workspace).toContain("Gmail connected. The inbox list will refresh automatically.");
  expect(workspace).toMatch(/router\.replace[\s\S]*?connectorKey: connector\.connectorKey/);
  expect(workspace).toMatch(/exchangeEmailConnection\(code\)[\s\S]*?\.then\(\s*\(connector\) => completeConnectionFromEffect\(connector\),\s*\(failure: unknown\) => notifyLatest/);
  expect(workspace).toMatch(/connector = await launchEmailConnection\(\{ name,[\s\S]*?description: connectDescription\.trim\(\)[\s\S]*?finally \{\s*setBusy\(undefined\);\s*\}\s*if \(connector\) completeConnection/);
});

test("root plus opens an intrinsic titleless three-item menu and full-height forms", () => {
  expect(workspace).toContain('accessibilityLabel="New Signal folder-like item"');
  expect(workspace).toContain('hideHeading={menuSheet}');
  expect(workspace).toContain('hideCloseButton={menuSheet}');
  expect(workspace).toContain('height={sheet === "composer" || formSheet ? "full" : undefined}');
  const start = workspace.indexOf('{sheet === "rootMenu" ? (');
  const end = workspace.indexOf(') : sheet === "connectForm"', start);
  const menu = workspace.slice(start, end);
  expect(menu.match(/<BottomSheetItem/g)).toHaveLength(3);
  expect(menu.indexOf('>Connect inbox</BottomSheetItem>')).toBeLessThan(menu.indexOf('>Create email tone</BottomSheetItem>'));
  expect(menu.indexOf('>Create email tone</BottomSheetItem>')).toBeLessThan(menu.indexOf('>Add context note</BottomSheetItem>'));
  expect(menu).not.toContain("Close");
  expect(workspace).toContain('accessibilityLabel="Inbox name" autoFocus');
  expect(workspace).toContain('maxLength={255}');
  expect(workspace).toContain('maxLength={10000} multiline');
  expect(workspace).toContain('maxLength={20000} multiline');
  expect(workspace).toContain('accessibilityLabel="Tone writing instruction"');
  expect(workspace).toContain('? "Connect" : sheet === "toneCreate" ? "Create tone" : "Save"');
  expect(workspace).toMatch(/sheet === "connectForm"[\s\S]*?<ScrollView[\s\S]*?keyboardShouldPersistTaps="handled"/);
  expect(workspace).toMatch(/sheet === "toneCreate"[\s\S]*?<ScrollView[\s\S]*?keyboardShouldPersistTaps="handled"/);
});

test("reply context manager uses full-height pills, guarded bulk delete, and one keyboard-safe editor", () => {
  expect(workspace).toContain("function ReplyContextSheets");
  expect(workspace).toContain('title="Reply context"');
  expect(workspace).toContain('shape="pill" size="md"');
  expect(workspace).toContain('accessibilityActions={canMutate ? [{ name: "longpress"');
  expect(workspace).toContain('accessibilityState={{ selected }}');
  expect(workspace).toContain('Context note selection toolbar');
  expect(workspace).toContain('activeSelectedKeys.length} selected');
  expect(workspace).toContain('deleteEmailReplyContextsForContext(operationContext, keys)');
  expect(workspace).toContain('title={`Delete ${activeSelectedKeys.length === 1 ? "context note"');
  expect(workspace).toContain('No context notes yet.');
  expect(workspace).toContain('accessibilityLabel="New context note"');
  expect(workspace).toContain('title={editor?.mode === "create" ? "New context note" : "Edit context note"}');
  expect(workspace).toContain('accessibilityLabel="Context note text"');
  expect(workspace).toContain('maxLength={4000} multiline');
  expect(workspace).toContain('keyboardShouldPersistTaps="handled"');
  expect(workspace).toContain('fetchEmailReplyContextsForContext(capturedContext)');
  expect(workspace).toContain('createEmailReplyContextForContext(operationContext');
  expect(workspace).toContain('updateEmailReplyContextForContext(operationContext');
  expect(workspace).toContain('operationIsCurrent(generation, operationContext)');
  expect(workspace).toContain('queryClient.getQueryData(signalQueryKeys.replyContexts(operationContext)) === expected');
  expect(workspace).not.toMatch(/longPressedNote\.current = key;\s*setTimeout/);
  expect(workspace).toContain('{connected ? <BottomSheetItem onPress={openReplyContexts}>Reply context</BottomSheetItem> : null}');
  expect(workspace).not.toContain("<Pressable");
});

test("Signal forms preserve dirty edits and viewer tones remain read-only", () => {
  expect(workspace).toContain("const formBaseline = useRef");
  expect(workspace).toContain("const formDirty = Boolean");
  expect(workspace).toContain("function requestFormClose()");
  expect(workspace).toContain('setDiscardFormSheet(sheet as FormSheet)');
  expect(workspace).toContain('onPress={requestFormClose}');
  expect(workspace).toContain('else if (!open && formSheet) requestFormClose()');
  expect(workspace).toContain('setDiscardFormNative(true)');
  expect(workspace).toContain('navigation.dispatch(action)');
  expect(workspace).toContain('permissions.canMutate ? "Edit" : "View"');
  expect(workspace).toContain('editable={permissions.canMutate && !busy}');
  expect(workspace).toContain('disabled={!permissions.canMutate || Boolean(busy)}');
  expect(workspace).toContain('permissions.canMutate ? "Edit email tone" : "View email tone"');
});

test("folder-like editors share Archive cover upload and optimistic convergence contracts", () => {
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
  expect(workspace).toMatch(/invalidateSignalMetadata[\s\S]*?signalQueryKeys\.overviews\(context\), refetchType: "none"[\s\S]*?signalQueryKeys\.tones\(context\), refetchType: "none"/);
  expect(workspace).toContain("createEmailToneForContext(context");
  expect(workspace).toContain("updateEmailToneForContext(context");
  expect(workspace).toContain("updateEmailInboxForContext(context");
  expect(workspace).toContain('metadataCoverControl: { width: 88, height: 88');
  expect(workspace).toContain('metadataCoverRemove: { width: 42, height: 42, minHeight: 42');
  expect(workspace).toContain('patchSignalInbox(queryClient, context, inbox)');
  expect(workspace).toContain('upsertSignalTone(queryClient, context, record)');
  expect(workspace).toContain('void loadToneRecords()');
  expect(workspace).not.toContain("<Pressable");
});

test("scope changes obsolete operations and clear Signal operation UI", () => {
  expect(workspace).toMatch(/const generation = \+\+operationGeneration\.current;[\s\S]*?setBusy\(undefined\);[\s\S]*?setSheet\("plus"\);[\s\S]*?setSheetOpen\(false\);/);
  expect(workspace).toMatch(/return \(\) => \{\s*operationGeneration\.current \+= 1;/);
});

test("inbox metadata authorization is independent from connector management", () => {
  expect(workspace).toContain("connected && permissions.canMutate ? <BottomSheetItem onPress={openInboxEdit}>Edit</BottomSheetItem>");
  expect(workspace).toContain("connected && permissions.canManageConnector ? (");
});

test("tones expose guarded loading, error, and retry states", () => {
  expect(workspace).toContain("const [tonesLoading, setTonesLoading] = useState(true)");
  expect(workspace).toContain("const [toneError, setToneError] = useState<string>()");
  expect(workspace).toMatch(/request === toneRequest\.current[\s\S]*?context\.organizationKey === toneContext\.current\.organizationKey[\s\S]*?setToneError\(messageFor\(failure\)\)/);
  expect(workspace).toContain('accessibilityLabel="Loading Signal tones"');
  expect(workspace).toContain("Retry tones");
  expect(workspace).toMatch(/tonesLoading \?[\s\S]*?: toneError \?[\s\S]*?: visibleTones\.length/);
});

test("attachment picker loads and searches both real stores with persistent multi-selection", () => {
  expect(picker).toContain('? listContentDocumentsAtLocation()');
  expect(picker).toContain(': fetchGalleryOverview()');
  expect(picker).toContain('useState<EmailAttachmentRef[]>(() => selection)');
  expect(picker).toContain('searchContentMatches(value, undefined, undefined, false)');
  expect(picker).toContain('searchGalleryImages({ query: value, recordHistory: false');
  expect(picker).toContain('toggleEmailAttachment(current, ref)');
  expect(picker).toContain('working.length} selected');
  expect(picker).toContain('height="full"');
  expect(picker).toContain('<Image contentFit="cover"');
  expect(picker).not.toContain('<Pressable');
});

test("opened threads use a latest-message document reader and guarded immutable AI versions", () => {
  expect(workspace).toContain('setSelectedMessageKey([...detail.messages].sort((left, right) => right.sentAt.localeCompare(left.sentAt)');
  expect(workspace).toContain('accessibilityLabel="Conversation messages"');
  expect(workspace).toContain('<Text selectable style={styles.readerTitle}>{selectedMessage.subject}</Text>');
  expect(workspace).toContain('<Text selectable style={styles.readerBody}>{selectedMessage.body}</Text>');
  expect(workspace).toContain('readerBody: { width: "100%", color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26');
  expect(workspace).toContain('readerTargetKey.current !== result.messageKey');
  expect(workspace).toContain('No translations yet.');
  expect(workspace).not.toContain('Restore original');
  expect(workspace).not.toContain('Replace original');
});

test("reader menus separate AI and normal message actions with truthful Gmail trash copy", () => {
  const ai = workspace.slice(workspace.indexOf('sheet === "ai" ? ('), workspace.indexOf('sheet === "plus" ? ('));
  for (const action of ["Translate", "Summary", "Draft reply"]) expect(ai).toContain(action);
  expect(workspace).toContain('{selected.thread.isFavorite ? "Unfavorite" : "Favorite"}');
  for (const action of ["Find similar", "Delete"]) expect(workspace).toContain(action);
  expect(workspace).toContain('This moves the entire Gmail thread to Trash. It remains synchronized and visible under Filtered.');
  expect(workspace).toContain('trashEmailThreadForContext(context, threadKey)');
  expect(workspace).toContain('reconcileSignalTrashedThread(queryClient, context, connectorKey, result)');
});

test("similar email reuses exact category tabs and preserves source until detail navigation succeeds", () => {
  expect(workspace.match(/style={styles.categoryTabs}/g)).toHaveLength(2);
  expect(workspace.match(/size="xs" style={styles.categoryTab}/g)).toHaveLength(2);
  expect(workspace).toContain('findSimilarEmailMessagesForContext(context, messageKey, { categories: [category], limit: 20 })');
  expect(workspace).toMatch(/const detail = await queryClient\.fetchQuery[\s\S]*?if \(generation !== detailGeneration\.current\) return;[\s\S]*?setSelected\(detail\);[\s\S]*?setReaderSheetOpen\(false\);/);
});

test("account options provide manual sort without duplicate category navigation", () => {
  expect(workspace).toContain('sortEmailInboxForContext(context, connectorKey)');
  expect(workspace).toContain('loading={busy === "sort"}');
  expect(workspace).toContain('Sort inbox');
});

test("deferred sort completion cannot write across a scope generation", () => {
  const operation = workspace.slice(workspace.indexOf("async function sortInbox()"), workspace.indexOf("async function chooseFilter"));
  expect(operation).toContain("const context = { organizationKey: emailContext.organizationKey, scopeKey: emailContext.scopeKey }");
  expect(operation).toContain("const generation = ++operationGeneration.current");
  expect(operation).toContain("sortEmailInboxForContext(context, connectorKey)");
  expect(operation).toContain("signalQueryKeys.accountOverviews(context, connectorKey)");
  expect(operation).toContain("loadOverviewForContext(context, connectorKey, nextFilter, nextSearch)");
  expect(operation.match(/if \(!operationIsCurrent\(generation, context\)\) return;/g)).toHaveLength(3);
  expect(operation).not.toContain("await load()");
});

test("delayed reader opening is owned before the wait and revalidates context, thread, and message", () => {
  const operation = workspace.slice(workspace.indexOf("async function openReaderFlow"), workspace.indexOf("async function generateTranslation"));
  expect(operation.indexOf("const generation = ++readerGeneration.current")).toBeLessThan(operation.indexOf("await wait(180)"));
  expect(operation).toContain("if (!readerOperationIsCurrent(generation, context, threadKey, messageKey)) return;");
  expect(workspace).toContain("selectedThreadKeyRef.current === threadKey && selectedMessageKeyRef.current === messageKey");
  expect(workspace).toMatch(/function clearSelectedThread\(\)[\s\S]*?readerGeneration\.current \+= 1;[\s\S]*?selectedThreadKeyRef\.current = undefined;/);
});

test("trash reconciliation is captured and cannot close a newer reader", () => {
  const operation = workspace.slice(workspace.indexOf("async function trashThread()"), workspace.indexOf("async function disconnect"));
  for (const capture of ["previousThread", "messageKey", "context", "connectorKey", "threadKey", "generation"]) expect(operation).toContain(`const ${capture}`);
  expect(operation.match(/readerOperationIsCurrent\(generation, context, threadKey, messageKey\)/g)?.length).toBeGreaterThanOrEqual(4);
  expect(operation).toContain("signalQueryKeys.accountOverviews(context, connectorKey)");
  expect(operation).not.toContain("removeSignalThread");
  expect(operation).not.toContain("await load()");
  expect(operation).toContain("setOverview((current) => current ? moveSignalThreadToFiltered(current, result, activeFilter, activeSearch || null) : current)");
  expect(operation).not.toContain("queryClient.getQueryData<EmailOverview>");
});

test("same-frame composer actions are rejected by the synchronous busy owner", () => {
  expect(workspace).toMatch(/function beginComposerOperation[\s\S]*?if \(composerBusyGeneration\.current !== undefined\) return undefined;[\s\S]*?composerBusyGeneration\.current = generation;/);
  expect(workspace.match(/const operation = beginComposerOperation\("(?:draft|save|send)"\);\s*if \(!operation\) return;/g)).toHaveLength(3);
  expect(workspace).toContain("if (composerBusyGeneration.current !== operation.generation) return;");
});

test("custom reader is an accessible modal that hides background and always permits close", () => {
  expect(workspace).toContain("accessibilityElementsHidden={readerSheetOpen}");
  expect(workspace).toContain('importantForAccessibility={readerSheetOpen ? "no-hide-descendants" : "auto"}');
  expect(workspace).toContain("accessibilityViewIsModal");
  expect(workspace).toContain('accessibilityLabel="Close email reader flow" contentMode="raw" onPress={closeReaderFlow}');
  expect(workspace).toMatch(/function closeReaderFlow\(\) \{\s*readerGeneration\.current \+= 1;[\s\S]*?setReaderSheetOpen\(false\);[\s\S]*?setReaderLoading\(false\);/);
  expect(workspace).not.toContain('accessibilityLabel="Close email reader flow" contentMode="raw" disabled={readerLoading}');
});

test("generated message versions converge through functional cache upserts", () => {
  expect(workspace).toContain("upsertSignalTranslationVersion(queryClient, context, messageKey, result.version)");
  expect(workspace).toContain("upsertSignalSummary(queryClient, context, messageKey, result.summary)");
  expect(workspace).not.toContain("versions: [result.version, ...translations");
  expect(workspace).not.toContain("summaries: [result.summary, ...summaries");
});
