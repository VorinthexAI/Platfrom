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
  expect(workspace).toContain('height={sheet === "composer" ? "full"');
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
