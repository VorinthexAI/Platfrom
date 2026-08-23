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

test("Signal exposes the five primary filters and keeps secondary filters in a menu", () => {
  for (const label of ["Inbox", "Important", "Action", "Unread", "Favorites"]) expect(workspace).toContain(`label: "${label}"`);
  expect(workspace).toContain('chooseFilter("urgent")');
  expect(workspace).toContain('chooseFilter("filtered")');
  expect(workspace).toMatch(/<Tabs[\s\S]*?accessibilityLabel="Signal inbox filters"/);
});

test("new and reply composers use canonical draft clients, attachments, and dirty interception", () => {
  expect(workspace).toContain('composeEmailDraft({ ...composeInput(), connectorKey: initialConnectorKey })');
  expect(workspace).toMatch(/createEmailDraft\(\{\s*threadKey: selected!\.thread\.key/);
  expect(workspace).toContain('updateEmailDraft(created.key, body.trim())');
  expect(workspace).toContain('sendEmailDraft(prepared.key)');
  expect(workspace).toContain('navigation.addListener("beforeRemove"');
  expect(workspace).toContain('const composerDirty = Boolean');
  expect(workspace).toContain('<EmailAttachmentPicker');
  expect(workspace).toContain('height={sheet === "composer" ? "full"');
});

test("Signal root puts shared search before tabs and uses a measured exact three-column grid", () => {
  expect(workspace).toContain("useState<EmailToneRecord[]>([])");
  expect(workspace.indexOf('accessibilityLabel="Search Signal inboxes and tones"')).toBeLessThan(workspace.indexOf('accessibilityLabel="Signal root categories"'));
  expect(workspace).toContain("setRootGridWidth(nativeEvent.layout.width)");
  expect(workspace).toContain("- 16) / 3");
  expect(workspace).toContain('params: { slug: "archive", documentKey: record.key }');
  expect(workspace).toContain("toneRecords.map(({ slug }) => slug)");
  expect(workspace).toMatch(/visibleTones\.map\(\(record\) => \(\s*<Button[\s\S]*?shape="rounded"/);
  expect(workspace).toContain('accessibilityLabel="Connect Gmail"');
  expect(workspace).toContain('rootTabs: { marginTop: 10, flexDirection: "row" }');
  expect(workspace).toContain("No Signal inboxes are connected. Ask an organization administrator to connect Gmail.");
  expect(workspace).not.toContain('setSheet("tones")');
  expect(workspace).not.toContain("<Pressable");
});

test("Signal routes exact account keys and tones to exact Archive documents", () => {
  expect(route).toContain("connectorKey?: string");
  expect(route).toContain('<EmailWorkspace initialConnectorKey={params.connectorKey} key={params.connectorKey ?? "root"} />');
  expect(workspace).toContain('onPress={() => router.replace({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: account.key } })}');
  expect(workspace).toContain('params: { slug: "archive", documentKey: record.key }');
  expect(workspace).not.toContain('router.push({ pathname: "/capability/[slug]", params: { slug: "signal"');
});

test("native back consumes thread and account hierarchy before leaving Signal", () => {
  expect(workspace).toMatch(/navigation\.addListener\("beforeRemove"[\s\S]*?if \(composerDirty\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?if \(selected\) \{\s*event\.preventDefault\(\);\s*clearSelectedThread\(\);[\s\S]*?if \(initialConnectorKey\) \{\s*event\.preventDefault\(\);\s*allowNavigation\.current = true;\s*router\.replace/);
  expect(workspace).toMatch(/function completeNativeBack[\s\S]*?if \(selected\)[\s\S]*?clearSelectedThread\(\)[\s\S]*?if \(initialConnectorKey\)[\s\S]*?router\.replace[\s\S]*?else navigation\.dispatch\(action\)/);
  expect(workspace).toContain('destination === "native" && nativeNavigationAction.current');
});

test("root legacy drafts require explicit inbox assignment without sending", () => {
  const assignBlock = workspace.slice(workspace.indexOf("async function assignDraft"), workspace.indexOf("async function chooseFilter"));
  expect(client).toContain("unassignedDrafts: z.array(emailDraftSchema).default([])");
  expect(workspace).toContain("visibleUnassignedDrafts.map((saved) => (");
  expect(workspace).toContain("<Text style={styles.rootCardMeta}>DRAFT</Text>");
  expect(workspace).toContain('setSheet("assignDraft")');
  expect(workspace).toMatch(/sheet === "assignDraft"[\s\S]*?overview\?\.accounts\.length[\s\S]*?<BottomSheetItem[\s\S]*?assignDraft\(account\.key\)/);
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
  expect(workspace).toMatch(/if \(initialConnectorKey\) void queryClient\.fetchQuery\(\{[\s\S]*?signalQueryKeys\.overview\(emailContext\)[\s\S]*?fetchEmailOverview\(\)/);
  expect(workspace).toContain('event.type === "inbox.changed" || event.type === "event-stream.connected"');
});

test("superseded filter and search loads cannot commit controls or restore an older query", () => {
  expect(workspace.match(/const candidate = \{ filter[^\n]+\};/g)).toHaveLength(2);
  expect(workspace.match(/const result = await load\([^\n]+\);\s*if \(result !== "failed" && overviewQuery\.current === candidate\) \{\s*set(?:Filter|SubmittedQuery)\(/g)).toHaveLength(2);
  expect(workspace.match(/else if \(result === "failed" && overviewQuery\.current === candidate\) overviewQuery\.current = previous;/g)).toHaveLength(2);
  expect(workspace.match(/if \(overviewQuery\.current === candidate\) overviewQuery\.current = previous;/g)).toHaveLength(2);
});

test("cursor loads stay bounded at 50, dedupe, and stop repeated cursors", () => {
  expect(workspace).toMatch(/fetchEmailOverview\(\{[\s\S]*?cursor: options\.cursor,\s*limit: 50,/);
  expect(workspace).toContain("appendCursorItems(current.threads, value.threads");
  expect(workspace).toContain("isNearScrollEnd({ offset: nativeEvent.contentOffset.y");
  expect(workspace).toContain("if (!cursor || loadingMore.current || loadingOverview.current || loading || loadError) return");
  expect(workspace).toContain("nextCursor: value.nextCursor === options.cursor ? null : value.nextCursor");
  expect(workspace).not.toContain("EventSource");
});

test("returning focus bypasses cached tones and reloads Archive edits", () => {
  expect(workspace).toMatch(/const loadToneRecords = \(\) => \{[\s\S]*?queryClient\.fetchQuery\(\{[\s\S]*?queryKey: signalQueryKeys\.tones\(emailContext\),[\s\S]*?staleTime: 0,/);
  expect(workspace).toMatch(/navigation\.addListener\("focus", \(\) => \{[\s\S]*?cancelQueries\(\{ queryKey: signalQueryKeys\.tones\(context\)[\s\S]*?invalidateQueries\(\{ queryKey: signalQueryKeys\.tones\(context\)[\s\S]*?loadToneRecordsLatest\(\)/);
});

test("AI actions use the assistant or canonical draft endpoints without local fake generation", () => {
  expect(workspace).toMatch(/askEmailAssistant\(\s*`Summarize email thread/);
  expect(workspace).toContain('await prepareDraft()');
  expect(workspace).not.toContain('setTimeout(() => setBody');
});

test("selected Signal operations propagate connector selectors and reset account-scoped state", () => {
  expect(workspace).toContain("connectorKey: initialConnectorKey");
  expect(workspace).toContain("syncEmail(initialConnectorKey)");
  expect(workspace).toContain("subscribeEmail(connector.key)");
  expect(workspace).toContain("disconnectEmail(initialConnectorKey)");
  expect(workspace).toContain("detailGeneration.current += 1");
  expect(workspace.match(/clearSelectedThread\(\)/g)?.length).toBeGreaterThanOrEqual(7);
  expect(workspace).toMatch(/function clearSelectedThread\(\) \{\s*detailGeneration\.current \+= 1;\s*setSelected\(undefined\);/);
  expect(workspace).toMatch(/clearSelectedThread\(\);[\s\S]*?setFilter\("all"\);[\s\S]*?setQuery\(""\);[\s\S]*?setSubmittedQuery\(""\);/);
  expect(workspace).toMatch(/const generation = \+\+detailGeneration\.current;[\s\S]*?fetchEmailThread[\s\S]*?generation === detailGeneration\.current/);
  expect(workspace).toContain('router.replace({ pathname: "/capability/[slug]", params: { slug: "signal" } })');
  expect(workspace).not.toContain('router.push({ pathname: "/capability/[slug]", params: { slug: "signal" } })');
  expect(client).not.toContain("createdByMembershipKey:");
});

test("successful OAuth is not reversed by initial sync, watch, or root refresh failures", () => {
  expect(workspace).toMatch(/function completeConnection[\s\S]*?Promise\.allSettled\(\[[\s\S]*?syncEmail\(connector\.key\)[\s\S]*?subscribeEmail\(connector\.key\)[\s\S]*?rootRefresh/);
  expect(workspace).toContain("Gmail connected. Initial sync or live updates need another try.");
  expect(workspace).toContain("Gmail connected. The inbox list will refresh automatically.");
  expect(workspace).toMatch(/router\.replace[\s\S]*?connectorKey: connector\.key/);
  expect(workspace).toMatch(/exchangeEmailConnection\(code\)[\s\S]*?\.then\(\s*\(connector\) => completeConnectionFromEffect\(connector\),\s*\(failure: unknown\) => notifyLatest/);
  expect(workspace).toMatch(/connector = await launchEmailConnection\(\);[\s\S]*?finally \{\s*setBusy\(undefined\);\s*\}\s*if \(connector\) completeConnection/);
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
