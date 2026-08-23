import { beforeEach, expect, mock, test } from "bun:test";

const calls: { method: string; path: string; body: unknown; config?: unknown }[] = [];
const authState = { organization: { key: "org-key", role: "member" }, scope: { key: "scope-key", role: "moderator" } };
const now = "2026-08-11T10:00:00.000Z";
const connector = { key: "inbox-a", connectorKey: "connector-a", provider: "gmail" as const, email: "a@example.com", name: "Client inbox", description: "Priority client mail", isFavorite: true, status: "active" as const, syncEnabled: true, syncStatus: "idle" as const, createdAt: now, updatedAt: now };
const connectorB = { ...connector, key: "inbox-b", connectorKey: "connector-b", email: "b@example.com", name: "Team inbox", isFavorite: false };
const thread = { key: "thread-key", scopeKey: "scope-key", accountKey: "account-key", providerThreadId: "provider-thread", subject: "Subject", summary: "Summary", intent: "Review message", priority: "normal", state: "needs_action", inboxCategory: "Important", lastMessageAt: now, latestFrom: "sender@example.com", isFavorite: false, createdAt: now, updatedAt: now };
const draft = { key: "draft-key", scopeKey: "scope-key", variant: "reply", threadKey: "thread-key", messageKey: "message-key", generatedContent: "Reply", status: "generated", createdAt: now, updatedAt: now };
const unassignedDraft = { key: "legacy-draft", scopeKey: "scope-key", variant: "new", to: ["one@example.com"], subject: "Legacy proposal", generatedContent: "Proposal", status: "generated", createdAt: now, updatedAt: now };
let includeUnassignedDrafts = true;
let replyContextDeleteResult: unknown;
const tones = [
  { key: "tone-warm", slug: "casual" as const, name: "Casual", description: "Friendly and considerate.", instruction: "Sound approachable and human.", coverUrl: "https://images.example.com/tone-warm.jpg", isFavorite: true, createdAt: now, updatedAt: now },
  { key: "tone-direct", name: "Direct", instruction: "Lead with the answer.", isFavorite: false, createdAt: now, updatedAt: now },
];
const replyContexts = [
  { key: "context-client", name: "Client background", text: "The client prefers concise weekly updates.", createdAt: now, updatedAt: now },
  { key: "context-policy", name: "Reply policy", text: "Never promise delivery dates without confirmation.", createdAt: now, updatedAt: now },
];

mock.module("@/state/auth", () => ({ useAuthStore: { getState: () => authState } }));
mock.module("expo-linking", () => ({ parse: () => ({ queryParams: {} }) }));
mock.module("expo-web-browser", () => ({ openAuthSessionAsync: async () => ({ type: "cancel" }) }));
mock.module("./api-client", () => ({ apiClient: {
  post: async (path: string, body: unknown, config?: unknown) => {
    calls.push({ method: "POST", path, body, config });
    const data = path === "/email/overview" ? { accounts: [connector, connectorB], selectedAccount: (body as { connectorKey?: string }).connectorKey ? connector : null, threads: (body as { connectorKey?: string }).connectorKey ? [thread] : [], drafts: [], ...(includeUnassignedDrafts ? { unassignedDrafts: [unassignedDraft] } : {}), counts: { all: 1, important: 0, urgent: 0, needsAction: 1, filtered: 0, unread: 0, favorite: 0 }, nextCursor: null }
      : path === "/email/drafts" || path === "/email/drafts/compose" ? draft
        : path.endsWith("/assign") ? { ...unassignedDraft, accountKey: connector.connectorKey }
          : path === "/email/tones/list" ? tones
          : path === "/email/tones" ? tones[0]
          : path === "/email/reply-context/list" ? replyContexts
          : path === "/email/reply-context" ? replyContexts[0]
          : path === "/email/reply-context/delete" ? replyContextDeleteResult ?? { deletedKeys: (body as { noteKeys: string[] }).noteKeys }
        : path.endsWith("/favorite") || path.endsWith("/trash") ? { ...thread, isFavorite: true }
        : path === "/email/sort" ? { connectorKey: connector.connectorKey, threadsProcessed: 2, messagesProcessed: 3 }
        : path.endsWith("/similar") ? { messageKey: "message-key", items: [{ key: "similar-key", scopeKey: "scope-key", accountKey: "account-key", threadKey: "other-thread", providerMessageId: "provider-message", from: "sender@example.com", to: ["a@example.com"], subject: "Related", body: "Related body", summary: "Related", direction: "inbound", sentAt: now, hasAttachments: false, inboxCategory: "Urgent", createdAt: now, updatedAt: now, similarity: 0.91 }] }
        : path.endsWith("/translations/list") ? { messageKey: "message-key", versions: [] }
        : path.endsWith("/translations") ? { messageKey: "message-key", language: "French", version: { key: "translation-key", scopeKey: "scope-key", documentKey: "message-key", version: 1, type: "translation", language: "French", label: "French translation", content: "Bonjour", embedding: [], createdAt: now } }
        : path.endsWith("/summaries/list") ? { messageKey: "message-key", summaries: [] }
        : path.endsWith("/summaries") ? { messageKey: "message-key", text: "Brief summary", summary: { key: "summary-key", scopeKey: "scope-key", documentKey: "message-key", version: 1, summary: "Brief summary", style: "brief", sourceContentHash: "a".repeat(64), sourceTitle: "Subject", sourceDocumentUpdatedAt: now, createdByKey: "member-key", createdAt: now } }
        : path.endsWith("/send") ? { sent: true, providerMessageId: "sent-1", threadKey: "thread-key" }
          : path === "/email/sync" ? { synced: 1, lastSyncedAt: now }
            : path === "/email/subscribe" ? { watchExpiresAt: now }
               : path === "/email/connect" ? { authorizationUrl: "https://accounts.example.com/oauth" }
               : path === "/email/connect/exchange" ? connectorB
                : path === "/email/disconnect" ? { disconnected: true }
            : path === "/assistant/respond" ? { type: "answer", message: "Synced Signal.", sources: [], changes: [{ workspace: "signal" }] }
              : {};
    return { data: { success: true, data } };
  },
  patch: async (path: string, body: unknown) => {
    calls.push({ method: "PATCH", path, body });
    const data = path.startsWith("/email/tones/") ? tones[1] : path.startsWith("/email/reply-context/") ? replyContexts[1] : path === "/email/inboxes" ? connector : { ...draft, finalContent: "Edited", status: "edited" };
    return { data: { success: true, data } };
  },
} }));

const client = await import("./email-client");
beforeEach(() => {
  calls.splice(0);
  includeUnassignedDrafts = true;
  replyContextDeleteResult = undefined;
  authState.organization.key = "org-key";
  authState.scope.key = "scope-key";
});

test("sends scoped overview, sync, draft, edit, and send requests", async () => {
  expect((await client.fetchEmailOverview({ connectorKey: connector.connectorKey, filter: "needs_action" })).threads).toHaveLength(1);
  await client.syncEmail(connector.connectorKey);
  await client.setEmailThreadFavorite("thread-key", true);
  await client.createEmailDraft({ threadKey: "thread-key", tone: "warm" });
  await client.updateEmailDraft("draft-key", "Edited");
  await client.sendEmailDraft("draft-key");
  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
    "POST /email/overview", "POST /email/sync", "POST /email/threads/thread-key/favorite", "POST /email/drafts", "PATCH /email/drafts/draft-key", "POST /email/drafts/draft-key/send",
  ]);
  expect(calls[0]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", connectorKey: connector.connectorKey, filter: "needs_action" });
  expect(calls[1]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", connectorKey: connector.connectorKey });
  expect(calls[1]?.config).toEqual({ timeout: 120_000 });
  expect(calls[2]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", isFavorite: true });
  expect(calls[3]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", threadKey: "thread-key", tone: "warm" });
});

test("accepts and sends arbitrary custom tone selectors while rejecting empty selectors", async () => {
  expect(client.emailToneSchema.parse("custom-tone-key")).toBe("custom-tone-key");
  expect(() => client.emailToneSchema.parse(" ")).toThrow();
  await client.composeEmailDraft({ to: ["one@example.com"], subject: "Custom voice", tone: "custom-tone-key" });
  expect(calls[0]).toMatchObject({ path: "/email/drafts/compose", body: { tone: "custom-tone-key" } });
  expect(client.getEmailPermissions()).toEqual({ canManageConnector: false, canMutate: true });
});

test("sends strict new compose and reply attachment requests", async () => {
  const attachments = [{ type: "document" as const, key: "document-key" }, { type: "image" as const, key: "image-key" }];
  await client.composeEmailDraft({ connectorKey: connector.connectorKey, to: ["one@example.com"], cc: ["two@example.com"], subject: "Project update", tone: "direct", instruction: "Use the reviewed body", attachments });
  await client.createEmailDraft({ threadKey: "thread-key", tone: "warm", instruction: "Confirm receipt", attachments });
  expect(calls[0]).toMatchObject({ method: "POST", path: "/email/drafts/compose", body: { organizationKey: "org-key", scopeKey: "scope-key", connectorKey: connector.connectorKey, to: ["one@example.com"], cc: ["two@example.com"], subject: "Project update", tone: "direct", instruction: "Use the reviewed body", attachments } });
  expect(calls[1]).toMatchObject({ method: "POST", path: "/email/drafts", body: { organizationKey: "org-key", scopeKey: "scope-key", threadKey: "thread-key", tone: "warm", instruction: "Confirm receipt", attachments } });
});

test("rejects unknown compose fields and malformed attachment references before transport", async () => {
  expect(() => client.emailComposeDraftInputSchema.parse({ to: ["one@example.com"], subject: "Hello", tone: "warm", hidden: true })).toThrow();
  expect(() => client.emailReplyDraftInputSchema.parse({ threadKey: "thread-key", tone: "warm", attachments: [{ type: "file", key: "file-key" }] })).toThrow();
  expect(calls).toHaveLength(0);
});

test("parses the safe tone DTO from list responses while retaining built-in drafting values", async () => {
  expect(await client.fetchEmailTones()).toEqual(tones);
  expect(client.BUILT_IN_EMAIL_TONES).toEqual(["casual", "formal", "concise"]);
  expect(client.emailToneRecordSchema.parse(tones[0])).toEqual(tones[0]);
  expect(client.emailToneRecordSchema.parse({ ...tones[0], slug: "warm", name: "Warm" })).toMatchObject({ slug: "warm", name: "Warm" });
  expect(() => client.emailToneRecordSchema.parse({ ...tones[0], scopeKey: "scope-key" })).toThrow();
  expect(() => client.emailToneRecordSchema.parse({ ...tones[0], identifier: "tone-warm" })).toThrow();
  expect(() => client.emailToneRecordSchema.parse({ ...tones[0], embedding: [0.1] })).toThrow();
  expect(() => client.emailToneRecordSchema.parse({ ...tones[0], coverImageKey: "private-cover-key" })).toThrow();
});

test("sends and strictly parses reader, classification, and generated-version requests", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  await client.sortEmailInboxForContext(context, connector.connectorKey);
  await client.trashEmailThreadForContext(context, thread.key);
  const similar = await client.findSimilarEmailMessagesForContext(context, "message-key", { categories: ["Urgent"], limit: 10 });
  expect(similar.items[0]?.inboxCategory).toBe("Urgent");
  const translation = await client.translateEmailMessageForContext(context, "message-key", { targetLanguage: "French" });
  expect(translation.version.content).toBe("Bonjour");
  await client.listEmailMessageTranslationsForContext(context, "message-key");
  expect((await client.summarizeEmailMessageForContext(context, "message-key", { topic: "Decision", style: "brief" })).summary.version).toBe(1);
  await client.listEmailMessageSummariesForContext(context, "message-key");
  expect(calls.map(({ path }) => path).slice(-7)).toEqual(["/email/sort", "/email/threads/thread-key/trash", "/email/messages/message-key/similar", "/email/messages/message-key/translations", "/email/messages/message-key/translations/list", "/email/messages/message-key/summaries", "/email/messages/message-key/summaries/list"]);
  expect(calls[0]?.config).toEqual({ timeout: 30 * 60_000 });
  expect(calls[2]?.body).toEqual({ ...context, categories: ["Urgent"], limit: 10 });
  expect(calls[2]?.config).toEqual({ timeout: 120_000 });
  expect(calls[3]?.config).toEqual({ timeout: 4 * 60_000 });
  expect(() => client.emailMessageSchema.parse({ ...thread, hidden: true })).toThrow();
  expect(() => client.emailSimilarResultSchema.parse({ ...similar.items[0], hidden: true })).toThrow();
  expect(() => client.emailTranslationVersionSchema.parse({ ...translation.version, hidden: true })).toThrow();
  expect(() => client.emailInboxCategorySchema.parse("Primary")).toThrow();
});

test("sends the inbox cursor and page limit without changing the product-neutral overview route", async () => {
  await client.fetchEmailOverview({ connectorKey: connector.connectorKey, filter: "all", cursor: "cursor-1", limit: 50 });
  expect(calls[0]).toMatchObject({ path: "/email/overview", body: { organizationKey: "org-key", scopeKey: "scope-key", connectorKey: connector.connectorKey, filter: "all", cursor: "cursor-1", limit: 50 } });
});

test("parses multiple accounts and the sanitized OAuth connector", async () => {
  const root = await client.fetchEmailOverview();
  expect(root.accounts.map(({ email }) => email)).toEqual(["a@example.com", "b@example.com"]);
  expect(root.selectedAccount).toBeNull();
  expect(await client.exchangeEmailConnection("vrtx_email_grant_code")).toEqual(connectorB);
  expect(() => client.emailConnectorSchema.parse({ ...connector, createdByMembershipKey: "membership" })).toThrow();
  expect(() => client.emailConnectorSchema.parse({ ...connector, providerAccountId: "private-provider-id" })).toThrow();
  expect(() => client.emailConnectorSchema.parse({ ...connector, encryptedCredentials: "ciphertext" })).toThrow();
});

test("sends strict inbox and tone metadata payloads", async () => {
  expect(await client.createEmailTone({ name: "Warm", description: "Friendly", instruction: "Write with empathy." })).toEqual(tones[0]);
  expect(await client.updateEmailTone({ toneKey: "tone-warm", name: "Warm", description: null, instruction: "Write naturally.", coverImageKey: "image-key", isFavorite: true })).toEqual(tones[1]);
  await client.updateEmailInbox({ connectorKey: connector.connectorKey, name: "Client inbox", description: null, coverImageKey: null, isFavorite: false });
  expect(calls.map(({ path, body }) => ({ path, body }))).toEqual([
    { path: "/email/tones", body: { organizationKey: "org-key", scopeKey: "scope-key", name: "Warm", description: "Friendly", instruction: "Write with empathy." } },
    { path: "/email/tones/tone-warm", body: { organizationKey: "org-key", scopeKey: "scope-key", name: "Warm", description: null, instruction: "Write naturally.", coverImageKey: "image-key", isFavorite: true } },
    { path: "/email/inboxes", body: { organizationKey: "org-key", scopeKey: "scope-key", connectorKey: connector.connectorKey, name: "Client inbox", description: null, coverImageKey: null, isFavorite: false } },
  ]);
  expect(calls.map(({ method }) => method)).toEqual(["POST", "PATCH", "PATCH"]);
  expect(() => client.emailToneCreateInputSchema.parse({ name: "Warm", instruction: "Write naturally.", hidden: true })).toThrow();
  expect(() => client.emailToneUpdateInputSchema.parse({ toneKey: "tone-warm" })).toThrow();
  expect(() => client.emailInboxUpdateInputSchema.parse({ connectorKey: connector.connectorKey, name: "Inbox", instruction: "not allowed", isFavorite: false })).toThrow();
});

test("explicit-context draft and metadata operations ignore later auth scope changes", async () => {
  const context = { organizationKey: "org-captured", scopeKey: "scope-captured" };
  authState.organization.key = "org-current";
  authState.scope.key = "scope-current";

  await client.fetchEmailOverviewForContext(context);
  await client.fetchEmailTonesForContext(context);
  await client.createEmailToneForContext(context, { name: "Captured", instruction: "Stay scoped." });
  await client.updateEmailToneForContext(context, { toneKey: "tone-warm", isFavorite: true });
  await client.updateEmailInboxForContext(context, { connectorKey: connector.connectorKey, isFavorite: false });
  await client.createEmailDraftForContext(context, { threadKey: "thread-key", tone: "warm" });
  await client.composeEmailDraftForContext(context, { to: ["one@example.com"], subject: "Captured", tone: "warm" });
  await client.updateEmailDraftForContext(context, "draft-key", "Captured body");
  await client.sendEmailDraftForContext(context, "draft-key");

  expect(calls).toHaveLength(9);
  expect(calls.every(({ body }) => {
    const value = body as { organizationKey?: string; scopeKey?: string };
    return value.organizationKey === context.organizationKey && value.scopeKey === context.scopeKey;
  })).toBe(true);
});

test("reply context uses strict DTOs, payloads, and explicit captured context", async () => {
  const context = { organizationKey: "org-captured", scopeKey: "scope-captured" };
  authState.organization.key = "org-current";
  authState.scope.key = "scope-current";
  expect(await client.fetchEmailReplyContextsForContext(context)).toEqual(replyContexts);
  expect(await client.createEmailReplyContextForContext(context, { name: "Client background", text: "Use the account history." })).toEqual(replyContexts[0]);
  expect(await client.updateEmailReplyContextForContext(context, { noteKey: "context-client", text: "Use current account history." })).toEqual(replyContexts[1]);
  expect(await client.deleteEmailReplyContextsForContext(context, ["context-client", "context-policy"])).toEqual({ deletedNoteKeys: ["context-client", "context-policy"] });
  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
    "POST /email/reply-context/list", "POST /email/reply-context", "PATCH /email/reply-context/context-client", "POST /email/reply-context/delete",
  ]);
  expect(calls.every(({ body }) => (body as { organizationKey: string }).organizationKey === context.organizationKey && (body as { scopeKey: string }).scopeKey === context.scopeKey)).toBe(true);
  expect(calls[3]?.body).toEqual({ ...context, noteKeys: ["context-client", "context-policy"] });
  expect(() => client.emailReplyContextSchema.parse({ ...replyContexts[0], scopeKey: "private" })).toThrow();
  expect(() => client.emailReplyContextCreateInputSchema.parse({ name: "Note", text: "Text", hidden: true })).toThrow();
  expect(() => client.emailReplyContextUpdateInputSchema.parse({ noteKey: "context-client" })).toThrow();
  expect(() => client.emailReplyContextDeleteInputSchema.parse({ noteKeys: [], extra: true })).toThrow();
  expect(() => client.emailReplyContextDeleteInputSchema.parse({ noteKeys: ["context-client", "context-client"] })).toThrow();
});

test("reply context bulk delete accepts only the exact backend result", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  replyContextDeleteResult = { deletedKeys: ["context-client"], deleted: 1 };
  await expect(client.deleteEmailReplyContextsForContext(context, ["context-client"])).rejects.toThrow();
  replyContextDeleteResult = { deletedNoteKeys: ["context-client"] };
  await expect(client.deleteEmailReplyContextsForContext(context, ["context-client"])).rejects.toThrow();
});

test("OAuth start carries validated inbox metadata", async () => {
  expect(await client.launchEmailConnection({ name: "Client inbox", description: "Priority mail" })).toBeNull();
  expect(calls[0]).toMatchObject({ path: "/email/connect", body: { organizationKey: "org-key", scopeKey: "scope-key", returnUri: "vorinthexcore://capability/signal", name: "Client inbox", description: "Priority mail" } });
  expect(() => client.emailConnectionMetadataSchema.parse({ name: "", description: "Invalid" })).toThrow();
});

test("parses unassigned drafts and defaults the legacy field to an empty list", async () => {
  expect((await client.fetchEmailOverview()).unassignedDrafts).toEqual([unassignedDraft]);
  includeUnassignedDrafts = false;
  expect((await client.fetchEmailOverview()).unassignedDrafts).toEqual([]);
});

test("sends a strict draft assignment request without sending the draft", async () => {
  expect(await client.assignEmailDraft(unassignedDraft.key, connector.connectorKey)).toMatchObject({ key: unassignedDraft.key, accountKey: connector.connectorKey });
  expect(calls[0]).toMatchObject({ method: "POST", path: `/email/drafts/${unassignedDraft.key}/assign`, body: { organizationKey: "org-key", scopeKey: "scope-key", connectorKey: connector.connectorKey } });
  expect(() => client.emailAssignDraftInputSchema.parse({ draftKey: unassignedDraft.key, connectorKey: connector.connectorKey, send: true })).toThrow();
});

test("propagates connector selectors to sync, subscribe, compose, and disconnect", async () => {
  await client.syncEmail(connector.connectorKey);
  await client.subscribeEmail(connector.connectorKey);
  await client.composeEmailDraft({ connectorKey: connector.connectorKey, to: ["one@example.com"], subject: "Hello", tone: "warm" });
  await client.disconnectEmail(connector.connectorKey);
  expect(calls.map(({ body }) => (body as { connectorKey?: string }).connectorKey)).toEqual(Array(4).fill(connector.connectorKey));
});

test("sends Signal assistant requests with a replay key and accepts workspace changes", async () => {
  expect(await client.askEmailAssistant("Sync my inbox", "request-1")).toEqual({ type: "answer", message: "Synced Signal.", sources: [], changes: [{ workspace: "signal" }] });
  expect(calls[0]).toMatchObject({
    method: "POST",
    path: "/assistant/respond",
    body: { organizationKey: "org-key", scopeKey: "scope-key", input: { surface: "signal-workspace", requestKey: "request-1", message: "Sync my inbox" } },
  });
});
