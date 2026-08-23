import { expect, test } from "bun:test";

const workspace = await Bun.file(new URL("../components/capability/EmailWorkspace.tsx", import.meta.url)).text();
const picker = await Bun.file(new URL("../components/capability/EmailAttachmentPicker.tsx", import.meta.url)).text();

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
  expect(workspace).toContain('composeEmailDraft(composeInput())');
  expect(workspace).toMatch(/createEmailDraft\(\{\s*threadKey: selected!\.thread\.key/);
  expect(workspace).toContain('updateEmailDraft(created.key, body.trim())');
  expect(workspace).toContain('sendEmailDraft(prepared.key)');
  expect(workspace).toContain('navigation.addListener("beforeRemove"');
  expect(workspace).toContain('const composerDirty = Boolean');
  expect(workspace).toContain('<EmailAttachmentPicker');
  expect(workspace).toContain('height={sheet === "composer" || sheet === "tones" ? "full"');
});

test("tone library uses full records, a measured three-column grid, and an exact Archive deep link", () => {
  expect(workspace).toContain("useState<EmailToneRecord[]>([])");
  expect(workspace).toContain('accessibilityLabel="Signal tone library"');
  expect(workspace).toContain("setToneGridWidth(nativeEvent.layout.width)");
  expect(workspace).toContain("- 16) / 3");
  expect(workspace).toContain('params: { slug: "archive", documentKey: record.key }');
  expect(workspace).toContain("toneRecords.map(({ slug }) => slug)");
  expect(workspace).toMatch(/toneRecords\.map\(\(record\) => \(\s*<Button[\s\S]*?shape="rounded"/);
  expect(workspace).not.toContain("<Pressable");
});

test("authoritative inbox events replace stale continuation data", () => {
  expect(workspace).toContain("staleTime: 0");
  expect(workspace).toMatch(/const active = generation === overviewGeneration\.current[\s\S]*?if \(active\) setOverview\(\(current\) => \{[\s\S]*?if \(options\.cursor && current\)[\s\S]*?return value;/);
  expect(workspace).toContain('return active ? "applied" as const : "superseded" as const');
  expect(workspace).toContain("pageGeneration === overviewPageGeneration.current");
  expect(workspace).toMatch(/const refreshFromInboxEvent = useEffectEvent\(async \(\) => \{[\s\S]*?cancelQueries[\s\S]*?void load\(\);/);
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

test("Archive-backed threads are not gated by connector state", () => {
  expect(workspace).toContain('const showInbox = connected || hasThreads');
  expect(workspace).toContain('Archive conversations');
  expect(workspace).toContain('Connect Gmail');
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
