import { beforeEach, expect, mock, test } from "bun:test";

const calls: { method: string; path: string; body: unknown; config?: unknown }[] = [];
const authState = { organization: { key: "org-key", role: "member" }, scope: { key: "scope-key", role: "moderator" } };
const now = "2026-08-11T10:00:00.000Z";
const connector = { key: "inbox-a", connectorKey: "connector-a", provider: "gmail" as const, email: "a@example.com", name: "Client inbox", description: "Priority client mail", isFavorite: true, status: "active" as const, syncEnabled: true, initialSyncCompleted: true, syncStatus: "idle" as const, createdAt: now, updatedAt: now };

const connectorB = { ...connector, key: "inbox-b", connectorKey: "connector-b", email: "b@example.com", name: "Team inbox", isFavorite: false };
const thread = { key: "thread-key", subject: "Subject", summary: "Summary", intent: "Review message", priority: "normal", state: "needs_action", inboxCategory: "Important", lastMessageAt: now, latestFrom: "sender@example.com", isFavorite: false, isRead: false, unread: true, createdAt: now, updatedAt: now };
const message = { key: "message-key", threadKey: "thread-key", from: "sender@example.com", fromName: "Sender Name", to: ["a@example.com"], subject: "Subject", body: "Body", summary: "Summary", direction: "inbound", sentAt: now, hasAttachments: false, attachmentAvailability: "none", isRead: false, unread: true, inboxCategory: "Important", createdAt: now, updatedAt: now };
const draft = { key: "draft-key", variant: "reply", replyMode: "reply_all", threadKey: "thread-key", messageKey: "message-key", to: ["sender@example.com"], cc: ["team@example.com"], generatedContent: "Reply", status: "generated", createdAt: now, updatedAt: now };
const unassignedDraft = { key: "legacy-draft", variant: "new", to: ["one@example.com"], subject: "Legacy proposal", generatedContent: "Proposal", status: "generated", createdAt: now, updatedAt: now };
const translationVersion = { key: "translation-key", documentKey: "message-key", version: 1, type: "translation" as const, language: "French", label: "French translation", content: "Bonjour", createdAt: now };
const summaryVersion = { key: "summary-key", documentKey: "message-key", version: 1, summary: "Brief summary", topic: "Decision", style: "brief" as const, language: "English", sourceTitle: "Subject", sourceDocumentUpdatedAt: now, createdAt: now };
let includeUnassignedDrafts = true;
let replyContextDeleteResult: unknown;
let bulkReportOverride: unknown;
const tones = [
  { key: "tone-warm", slug: "casual" as const, name: "Casual", instruction: "Sound approachable and human.", isFavorite: true, createdAt: now, updatedAt: now },
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
    const data = path === "/assistant/respond" ? { type: "answer", message: "You have one urgent unread email.", sources: [], changes: [{ workspace: "signal" }] }
      : path === "/app/search" ? { query: (body as { query: string }).query, groups: (body as { collectionSlugs: string[] }).collectionSlugs.map((collectionSlug) => ({ collectionSlug, results: collectionSlug === "inboxes" ? [{ ...connector, score: 0.91 }] : collectionSlug === "email-tones" ? [{ ...tones[0], score: 0.87 }] : collectionSlug === "email-messages" ? [{ ...thread, score: 0.84 }] : collectionSlug === "email-drafts" ? [{ ...draft, score: 0.89 }] : [] })) }
      : path === "/email/overview" ? { accounts: [connector, connectorB], selectedAccount: (body as { connectorKey?: string }).connectorKey ? connector : null, threads: (body as { connectorKey?: string }).connectorKey ? [thread] : [], drafts: [], tones: (body as { connectorKey?: string }).connectorKey ? [] : tones, ...(includeUnassignedDrafts ? { unassignedDrafts: [unassignedDraft] } : {}), counts: { all: 1, important: 0, urgent: 0, needsAction: 1, filtered: 0, unread: 1, favorite: 0, trash: 0 }, nextCursor: null }
      : path === "/email/drafts" || path === "/email/drafts/compose" ? draft
        : path.endsWith("/assign") ? { ...unassignedDraft, connectorKey: connector.connectorKey }
          : (path.startsWith("/email/drafts/") || path.startsWith("/email/tones/")) && path.endsWith("/delete") ? { deletedKey: path.includes("/tones/") ? "tone-direct" : "draft-key" }
          : path === "/email/tones/list" ? tones
          : path === "/email/tones" ? tones[0]
          : path === "/email/reply-context/list" ? replyContexts
          : path === "/email/reply-context" ? replyContexts[0]
          : path === "/email/reply-context/delete" ? replyContextDeleteResult ?? { deletedKeys: (body as { noteKeys: string[] }).noteKeys }
        : path === "/email/threads/favorite" || path === "/email/threads/read-state" || path === "/email/threads/trash" ? bulkReportOverride ?? { requested: 1, succeeded: 1, failed: 0, repairPending: 0, items: [{ threadKey: thread.key, status: "succeeded", thread: path === "/email/threads/read-state" ? { ...thread, isRead: true, unread: false } : path === "/email/threads/trash" ? { ...thread, labels: ["TRASH"], inInbox: false } : { ...thread, isFavorite: true } }] }
        : path === "/email/trash/clear" ? { connectorKey: connector.connectorKey, providerMessagesDeleted: 2, threadsDeleted: 1, documentsDeleted: 3 }
        : path === `/email/threads/${thread.key}` ? { thread, messages: [{ ...message, bodyTruncated: false }], nextCursor: null, truncated: false }
        : path.endsWith("/favorite") || path.endsWith("/trash") ? { ...thread, isFavorite: true }
        : path.endsWith("/similar") ? { messageKey: "message-key", items: [{ key: "similar-key", threadKey: "other-thread", from: "sender@example.com", to: ["a@example.com"], subject: "Related", body: "Related body", summary: "Related", direction: "inbound", sentAt: now, hasAttachments: false, attachmentAvailability: "none", isRead: true, unread: false, inboxCategory: "Urgent", createdAt: now, updatedAt: now, similarity: 0.91 }] }
        : path === "/app/enhance" ? { text: "Enhanced text." }
        : path === "/app/translate" ? "text" in (body as { input: Record<string, unknown> }).input ? { text: "Texte traduit." } : { messageKey: "message-key", language: "French", version: translationVersion }
        : path.endsWith("/translations/list") ? { messageKey: "message-key", versions: [translationVersion] }
        : path.endsWith("/translations") ? { messageKey: "message-key", language: "French", version: translationVersion }
        : path.endsWith("/summaries/list") ? { messageKey: "message-key", summaries: [summaryVersion] }
        : path.endsWith("/summaries") ? { messageKey: "message-key", text: "Brief summary", summary: summaryVersion }
        : path.endsWith("/send") ? { sent: true, providerMessageId: "sent-1", threadKey: "thread-key" }
          : path === "/email/connect" ? { authorizationUrl: "https://accounts.example.com/oauth" }
               : path === "/email/connect/exchange" ? connectorB
                 : path === "/email/disconnect" ? { disconnected: true }
               : {};
    return { data: { success: true, data } };
  },
  patch: async (path: string, body: unknown, config?: unknown) => {
    calls.push({ method: "PATCH", path, body, config });
    const data = path.startsWith("/email/tones/") ? tones[1] : path.startsWith("/email/reply-context/") ? replyContexts[1] : path === "/email/inboxes" ? connector : { ...draft, finalContent: "Edited", status: "edited" };
    return { data: { success: true, data } };
  },
  delete: async (path: string, config: { data: unknown; headers?: unknown }) => {
    const { data: body, ...requestConfig } = config;
    calls.push({ method: "DELETE", path, body, config: requestConfig });
    const data = path.endsWith("/translations") ? { messageKey: "message-key", deletedKeys: (body as { translationKeys: string[] }).translationKeys }
      : path.endsWith("/summaries") ? { messageKey: "message-key", deletedKeys: (body as { summaryKeys: string[] }).summaryKeys }
      : { deletedKey: path.includes("/tones/") ? "tone-direct" : "draft-key" };
    return { data: { success: true, data } };
  },
} }));

const client = await import("./email-client");
const transformations = await import("./app-transformation-client");

test("defaults initial sync state for connector responses from the compatible backend transport", () => {
  const { initialSyncCompleted: _initialSyncCompleted, ...legacyConnector } = connector;
  expect(client.emailConnectorSchema.parse(legacyConnector).initialSyncCompleted).toBe(false);
});
beforeEach(() => {
  calls.splice(0);
  includeUnassignedDrafts = true;
  replyContextDeleteResult = undefined;
  bulkReportOverride = undefined;
  authState.organization.key = "org-key";
  authState.scope.key = "scope-key";
});

test("sends scoped overview, draft, edit, and send requests", async () => {
  expect((await client.fetchEmailOverview({ connectorKey: connector.connectorKey, readState: "unread", facets: ["urgent", "important"] })).threads).toHaveLength(1);
  await client.setEmailThreadFavorite("thread-key", true);
  await client.createEmailDraft({ threadKey: "thread-key", replyMode: "reply", tone: "warm" });
  await client.updateEmailDraft("draft-key", "Edited");
  await client.sendEmailDraft("draft-key");
  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
    "POST /email/overview", "POST /email/threads/thread-key/favorite", "POST /email/drafts", "PATCH /email/drafts/draft-key", "POST /email/drafts/draft-key/send",
  ]);
  expect(calls[0]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", connectorKey: connector.connectorKey, readState: "unread", facets: ["urgent", "important"] });
  expect(calls[0]?.config).toEqual({ headers: { "X-Vorinthex-Email-Transport": "2" } });
  expect(calls[1]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", isFavorite: true });
  expect(calls[2]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", threadKey: "thread-key", replyMode: "reply", tone: "warm" });
});

test("asks Core through the scoped Signal assistant surface", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  expect(await client.askEmailAssistantForContext(context, "Show urgent email", "assistant-request")).toEqual({ type: "answer", message: "You have one urgent unread email.", sources: [], changes: [{ workspace: "signal" }] });
  expect(calls[0]).toEqual({
    method: "POST",
    path: "/assistant/respond",
    body: { ...context, input: { surface: "signal-workspace", requestKey: "assistant-request", message: "Show urgent email", currentNote: { title: "", content: "" } } },
    config: { timeout: 4 * 60_000 },
  });
});

test("semantically searches inboxes, tones, messages, and drafts through app search", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  const controller = new AbortController();
  expect((await client.searchEmailInboxesForContext(context, "leadership", false, controller.signal)).inboxes[0]).toMatchObject({ key: connector.key, score: 0.91 });
  expect((await client.searchEmailTonesForContext(context, "measured", true, controller.signal)).tones[0]).toMatchObject({ key: tones[0]!.key, score: 0.87 });
  expect((await client.searchEmailMessagesForContext(context, connector.connectorKey, client.normalizeEmailOverviewQuery({ search: "roadmap", facets: ["important", "favorite"] }), false, controller.signal))[0]).toEqual(thread);
  expect((await client.searchEmailDraftsForContext(context, connector.connectorKey, "follow up", false, controller.signal))[0]).toEqual(draft);
  expect(calls).toEqual([
    { method: "POST", path: "/app/search", body: { ...context, query: "leadership", collectionSlugs: ["inboxes"], minimumScore: 0.55, limit: 50, recordHistory: false }, config: { timeout: 15_000, signal: controller.signal } },
    { method: "POST", path: "/app/search", body: { ...context, query: "measured", collectionSlugs: ["email-tones"], minimumScore: 0.55, limit: 50, recordHistory: true }, config: { timeout: 15_000, signal: controller.signal } },
    { method: "POST", path: "/app/search", body: { ...context, query: "roadmap", collectionSlugs: ["email-messages"], recordHistory: false, limit: 50, minimumScore: 0.55, filters: { connectorKey: connector.connectorKey, readState: "unread", emailFacets: ["important", "favorite"] } }, config: { timeout: 15_000, signal: controller.signal } },
    { method: "POST", path: "/app/search", body: { ...context, query: "follow up", collectionSlugs: ["email-drafts"], minimumScore: 0.55, limit: 50, recordHistory: false, filters: { connectorKey: connector.connectorKey } }, config: { timeout: 15_000, signal: controller.signal } },
  ]);
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
  await client.createEmailDraft({ threadKey: "thread-key", replyMode: "reply_all", tone: "warm", instruction: "Confirm receipt", attachments });
  expect(calls[0]).toMatchObject({ method: "POST", path: "/email/drafts/compose", body: { organizationKey: "org-key", scopeKey: "scope-key", connectorKey: connector.connectorKey, to: ["one@example.com"], cc: ["two@example.com"], subject: "Project update", tone: "direct", instruction: "Use the reviewed body", attachments } });
  expect(calls[1]).toMatchObject({ method: "POST", path: "/email/drafts", body: { organizationKey: "org-key", scopeKey: "scope-key", threadKey: "thread-key", replyMode: "reply_all", tone: "warm", instruction: "Confirm receipt", attachments } });
});

test("sends strict independent body and attachment draft updates", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  const attachments = [{ type: "document" as const, key: "document-key" }, { type: "image" as const, key: "image-key" }];
  await client.updateEmailDraftForContext(context, "draft-key", { attachments }, "attachments-update");
  await client.updateEmailDraft("draft-key", "Body only");
  expect(calls[0]).toMatchObject({ method: "PATCH", path: "/email/drafts/draft-key", body: { ...context, attachments }, config: { headers: { "Idempotency-Key": "attachments-update" } } });
  expect(calls[1]).toMatchObject({ method: "PATCH", path: "/email/drafts/draft-key", body: { ...context, finalContent: "Body only" } });
  expect(() => client.emailDraftUpdateInputSchema.parse({})).toThrow();
  expect(() => client.emailDraftUpdateInputSchema.parse({ attachments: [attachments[0], attachments[0]] })).toThrow("distinct");
  expect(() => client.emailDraftUpdateInputSchema.parse({ finalContent: "Body", hidden: true })).toThrow();
});

test("rejects unknown compose fields and malformed attachment references before transport", async () => {
  expect(() => client.emailComposeDraftInputSchema.parse({ to: ["one@example.com"], subject: "Hello", tone: "warm", hidden: true })).toThrow();
  expect(() => client.emailReplyDraftInputSchema.parse({ threadKey: "thread-key", replyMode: "reply", tone: "warm", attachments: [{ type: "file", key: "file-key" }] })).toThrow();
  expect(() => client.emailReplyDraftInputSchema.parse({ threadKey: "thread-key", tone: "warm" })).toThrow();
  expect(() => client.emailReplyDraftInputSchema.parse({ threadKey: "thread-key", replyMode: "forward", tone: "warm" })).toThrow();
  expect(calls).toHaveLength(0);
});

test("matches generate and preserve compose modes with exact blank content", async () => {
  expect(client.emailAddressSchema.parse(" person@example.com ")).toBe("person@example.com");
  expect(client.emailAddressListSchema.parse(["one@example.com", "two@example.com"])).toEqual(["one@example.com", "two@example.com"]);
  expect(() => client.emailAddressListSchema.parse([])).toThrow();
  expect(() => client.emailAddressListSchema.parse(Array.from({ length: 51 }, (_, index) => `person-${index}@example.com`))).toThrow();
  expect(client.emailComposeDraftInputSchema.parse({ to: ["one@example.com"], generationMode: "generate", subject: "", authoredBody: "", tone: "direct" })).toMatchObject({ generationMode: "generate", subject: "", authoredBody: "" });
  expect(client.emailComposeDraftInputSchema.parse({ to: ["one@example.com"], generationMode: "preserve", subject: "  ", authoredBody: "" })).toMatchObject({ generationMode: "preserve", subject: "  ", authoredBody: "" });
  expect(() => client.emailComposeDraftInputSchema.parse({ to: ["one@example.com"], generationMode: "generate", subject: "" })).toThrow("tone is required");
  expect(() => client.emailComposeDraftInputSchema.parse({ to: ["one@example.com"], generationMode: "preserve", subject: "" })).toThrow("authoredBody is required");
  expect(() => client.emailComposeDraftInputSchema.parse({ to: ["one@example.com"], generationMode: "preserve", subject: "", authoredBody: "", tone: "direct" })).toThrow("tone is not allowed");
  expect(client.emailDraftSchema.parse({ ...unassignedDraft, connectorKey: undefined, subject: "", generatedContent: "", finalContent: "" })).toMatchObject({ subject: "", generatedContent: "", finalContent: "" });
  expect(() => client.emailComposeDraftInputSchema.parse({ to: ["One@example.com"], cc: ["one@example.com"], subject: "Hello", tone: "direct" })).toThrow("already present in TO");
});

test("forwards an optional abort signal when composing", async () => {
  const controller = new AbortController();
  await client.composeEmailDraftForContext({ organizationKey: "org-key", scopeKey: "scope-key" }, { to: ["one@example.com"], generationMode: "generate", subject: "", authoredBody: "", tone: "direct" }, "compose-signal", controller.signal);
  expect(calls[0]?.config).toEqual({ headers: { "Idempotency-Key": "compose-signal" }, signal: controller.signal });
});

test("strictly parses reply modes, resolved recipients, and sender display names", () => {
  expect(client.emailDraftSchema.parse(draft)).toEqual(draft);
  expect(() => client.emailDraftSchema.parse({ ...draft, replyMode: undefined })).toThrow();
  expect(() => client.emailDraftSchema.parse({ ...draft, hidden: true })).toThrow();
  const message = { key: "message-key", threadKey: "thread-key", from: "sender@example.com", fromName: "Sender Name", to: ["a@example.com"], subject: "Subject", body: "Body", summary: "Summary", direction: "inbound", sentAt: now, hasAttachments: false, attachmentAvailability: "none", isRead: true, unread: false, inboxCategory: "Important", createdAt: now, updatedAt: now };
  expect(client.emailMessageSchema.parse(message).fromName).toBe("Sender Name");
  expect(() => client.emailMessageSchema.parse({ ...message, displayName: "Wrong field" })).toThrow();
});

test("parses the safe tone DTO from list responses while retaining built-in drafting values", async () => {
  expect(await client.fetchEmailTones()).toEqual(tones);
  expect(client.BUILT_IN_EMAIL_TONES).toEqual(["casual", "formal", "direct"]);
  expect(client.emailToneRecordSchema.parse(tones[0])).toEqual(tones[0]);
  expect(client.emailToneRecordSchema.parse({ ...tones[0], slug: "warm", name: "Warm" })).toMatchObject({ slug: "warm", name: "Warm" });
  expect(() => client.emailToneRecordSchema.parse({ ...tones[0], scopeKey: "scope-key" })).toThrow();
  expect(() => client.emailToneRecordSchema.parse({ ...tones[0], identifier: "tone-warm" })).toThrow();
  expect(() => client.emailToneRecordSchema.parse({ ...tones[0], embedding: [0.1] })).toThrow();
  expect(() => client.emailToneRecordSchema.parse({ ...tones[0], coverImageKey: "private-cover-key" })).toThrow();
});

test("sends and strictly parses reader and generated-version requests", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  await client.trashEmailThreadForContext(context, thread.key);
  const similar = await client.findSimilarEmailMessagesForContext(context, "message-key", { limit: 10 });
  expect(similar.items[0]?.inboxCategory).toBe("Urgent");
  const translation = await client.translateEmailMessageForContext(context, "message-key", { targetLanguage: "French" });
  expect(translation.version.content).toBe("Bonjour");
  expect((await client.listEmailMessageTranslationsForContext(context, "message-key")).versions).toEqual([translationVersion]);
  expect((await client.summarizeEmailMessageForContext(context, "message-key", { topic: "Decision", style: "brief" })).summary).toEqual(summaryVersion);
  expect((await client.listEmailMessageSummariesForContext(context, "message-key")).summaries).toEqual([summaryVersion]);
  expect(calls.map(({ path }) => path).slice(-6)).toEqual(["/email/threads/thread-key/trash", "/email/messages/message-key/similar", "/app/translate", "/email/messages/message-key/translations/list", "/email/messages/message-key/summaries", "/email/messages/message-key/summaries/list"]);
  expect(calls[1]?.body).toEqual({ ...context, limit: 10 });
  expect(calls[1]?.config).toEqual({ timeout: 120_000 });
  expect(calls[2]?.config).toEqual({ timeout: 4 * 60_000 });
  expect(calls[2]?.body).toEqual({ ...context, input: { messageKey: "message-key", targetLanguage: "French" } });
  expect(() => client.emailMessageSchema.parse({ ...thread, hidden: true })).toThrow();
  expect(() => client.emailSimilarResultSchema.parse({ ...similar.items[0], hidden: true })).toThrow();
  expect(() => client.emailTranslationVersionSchema.parse({ ...translation.version, hidden: true })).toThrow();
  expect(() => client.emailTranslationVersionSchema.parse({ ...translation.version, scopeKey: "scope-key", embedding: [] })).toThrow();
  expect(() => client.emailSummarySchema.parse({ ...summaryVersion, sourceContentHash: "a".repeat(64), createdByKey: "member-key" })).toThrow();
  expect(() => client.emailInboxCategorySchema.parse("Primary")).toThrow();
});

test("sends the normalized inbox cursor query without changing the product-neutral overview route", async () => {
  await client.fetchEmailOverview({ connectorKey: connector.connectorKey, readState: "read", facets: ["favorite", "urgent", "filtered", "important"], cursor: "cursor-1", limit: 50 });
  expect(calls[0]).toMatchObject({ path: "/email/overview", body: { organizationKey: "org-key", scopeKey: "scope-key", connectorKey: connector.connectorKey, readState: "read", facets: ["urgent", "important", "filtered", "favorite"], cursor: "cursor-1", limit: 50 } });
  expect(client.emailOverviewInputSchema.parse({ connectorKey: connector.connectorKey, search: " client " })).toMatchObject({ search: "client" });
});

test("mirrors backend overview cross-field requirements", () => {
  expect(() => client.emailOverviewInputSchema.parse({ readState: "read", facets: [] })).toThrow("connectorKey");
  expect(() => client.emailOverviewInputSchema.parse({ connectorKey: connector.connectorKey, readState: "read" })).toThrow("together");
  expect(() => client.emailOverviewInputSchema.parse({ connectorKey: connector.connectorKey, facets: ["urgent"] })).toThrow("together");
  expect(() => client.emailOverviewInputSchema.parse({ connectorKey: connector.connectorKey, filter: "trash", readState: "read", facets: [] })).toThrow("combined");
  expect(() => client.emailOverviewInputSchema.parse({ search: "client" })).toThrow("connectorKey");
  expect(client.emailOverviewInputSchema.parse({ connectorKey: connector.connectorKey, filter: "important" })).toMatchObject({ filter: "important" });
});

test("retains request identity for the same payload and replaces it when payload changes", () => {
  let created = 0;
  const create = () => `request-${++created}`;
  const first = client.retainEmailRequestKey(undefined, "payload-a", create);
  expect(client.retainEmailRequestKey(first, "payload-a", create)).toBe(first);
  expect(client.retainEmailRequestKey(first, "payload-b", create)).toEqual({ fingerprint: "payload-b", requestKey: "request-2" });
  expect(created).toBe(2);
});

test("normalizes default, all-facet, and intentional empty inbox queries immutably", () => {
  expect(client.normalizeEmailOverviewQuery()).toEqual({ readState: "unread", facets: ["urgent", "important"], search: "" });
  expect(client.normalizeEmailOverviewQuery({ facets: ["favorite", "filtered", "important", "urgent"] }).facets).toEqual(["urgent", "important", "filtered", "favorite"]);
  const empty = client.normalizeEmailOverviewQuery({ facets: [] });
  expect(empty.facets).toEqual([]);
  expect(Object.isFrozen(empty)).toBe(true);
  expect(Object.isFrozen(empty.facets)).toBe(true);
  expect(() => client.emailOverviewInputSchema.parse({ connectorKey: connector.connectorKey, filter: "trash", facets: ["urgent"] })).toThrow();
  expect(() => client.emailOverviewInputSchema.parse({ connectorKey: connector.connectorKey, readState: "unread" })).toThrow();
});

test("constrains attachment references on message and draft output fields", () => {
  const duplicate = [{ type: "image" as const, key: "same" }, { type: "image" as const, key: "same" }];
  const tooMany = Array.from({ length: 21 }, (_, index) => ({ type: "document" as const, key: `document-${index}` }));
  expect(() => client.emailMessageSchema.parse({ ...message, attachments: duplicate })).toThrow("distinct");
  expect(() => client.emailDraftSchema.parse({ ...draft, attachments: duplicate })).toThrow("distinct");
  expect(() => client.emailMessageSchema.parse({ ...message, attachments: tooMany })).toThrow();
  expect(() => client.emailDraftSchema.parse({ ...draft, attachments: tooMany })).toThrow();
});

test("rapid facet requests compose from the latest requested query", () => {
  const first = client.toggleEmailOverviewFacet(client.normalizeEmailOverviewQuery(), "urgent");
  const second = client.toggleEmailOverviewFacet(first, "important");
  expect(second).toEqual({ readState: "unread", facets: [], search: "" });
});

test("rapid read and facet requests preserve both requested changes", () => {
  const read = client.setEmailOverviewReadState(client.normalizeEmailOverviewQuery({ search: "client" }), "read");
  const combined = client.toggleEmailOverviewFacet(read, "favorite");
  expect(combined).toEqual({ readState: "read", facets: ["urgent", "important", "favorite"], search: "client" });
});

test("hydrates a thread without changing provider read state", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  expect((await client.fetchEmailThreadForContext(context, thread.key)).thread).toEqual(thread);
  expect(calls[0]).toMatchObject({ path: `/email/threads/${thread.key}`, body: context });
});

test("parses multiple accounts and the sanitized OAuth connector", async () => {
  const root = await client.fetchEmailOverview();
  expect(root.accounts.map(({ email }) => email)).toEqual(["a@example.com", "b@example.com"]);
  expect(root.tones).toEqual(tones);
  expect(root.selectedAccount).toBeNull();
  expect(await client.exchangeEmailConnection("vrtx_email_grant_code")).toEqual(connectorB);
  expect(() => client.emailConnectorSchema.parse({ ...connector, createdByMembershipKey: "membership" })).toThrow();
  expect(() => client.emailConnectorSchema.parse({ ...connector, providerAccountId: "private-provider-id" })).toThrow();
  expect(() => client.emailConnectorSchema.parse({ ...connector, encryptedCredentials: "ciphertext" })).toThrow();
});

test("sends strict inbox and tone metadata payloads", async () => {
  expect(await client.createEmailTone({ name: "Warm", instruction: "Write with empathy." })).toEqual(tones[0]);
  expect(await client.updateEmailTone({ toneKey: "tone-warm", name: "Warm", instruction: "Write naturally.", isFavorite: true })).toEqual(tones[1]);
  expect(() => client.emailToneUpdateInputSchema.parse({ toneKey: "tone-warm", coverImageKey: "image-key" })).toThrow();
  await client.updateEmailInbox({ connectorKey: connector.connectorKey, name: "Client inbox", description: null, coverImageKey: null, isFavorite: false });
  expect(calls.map(({ path, body }) => ({ path, body }))).toEqual([
    { path: "/email/tones", body: { organizationKey: "org-key", scopeKey: "scope-key", name: "Warm", instruction: "Write with empathy." } },
    { path: "/email/tones/tone-warm", body: { organizationKey: "org-key", scopeKey: "scope-key", name: "Warm", instruction: "Write naturally.", isFavorite: true } },
    { path: "/email/inboxes", body: { organizationKey: "org-key", scopeKey: "scope-key", connectorKey: connector.connectorKey, name: "Client inbox", description: null, coverImageKey: null, isFavorite: false } },
  ]);
  expect(calls.map(({ method }) => method)).toEqual(["POST", "PATCH", "PATCH"]);
  expect(() => client.emailToneCreateInputSchema.parse({ name: "Warm", instruction: "Write naturally.", hidden: true })).toThrow();
  expect(() => client.emailToneCreateInputSchema.parse({ name: "Warm", description: "Removed", instruction: "Write naturally." })).toThrow();
  expect(() => client.emailToneRecordSchema.parse({ ...tones[0], description: "Removed" })).toThrow();
  expect(() => client.emailToneUpdateInputSchema.parse({ toneKey: "tone-warm" })).toThrow();
  expect(() => client.emailInboxUpdateInputSchema.parse({ connectorKey: connector.connectorKey, name: "Inbox", instruction: "not allowed", isFavorite: false })).toThrow();
});

test("arbitrary email text enhancement and translation use unified app actions with AI timeouts", async () => {
  const context = { organizationKey: "org-captured", scopeKey: "scope-captured" };
  await expect(transformations.enhanceAppTextForContext(context, "bad words here")).resolves.toEqual({ text: "Enhanced text." });
  await expect(transformations.translateAppTextForContext(context, "Clear sentence.", "French")).resolves.toEqual({ text: "Texte traduit." });
  expect(calls).toEqual([
    { method: "POST", path: "/app/enhance", body: { ...context, input: { text: "bad words here" } }, config: { timeout: 4 * 60_000 } },
    { method: "POST", path: "/app/translate", body: { ...context, input: { text: "Clear sentence.", targetLanguage: "French" } }, config: { timeout: 4 * 60_000 } },
  ]);
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
  await client.createEmailDraftForContext(context, { threadKey: "thread-key", replyMode: "reply", tone: "warm" });
  await client.composeEmailDraftForContext(context, { to: ["one@example.com"], subject: "Captured", tone: "warm" });
  await client.updateEmailDraftForContext(context, "draft-key", "Captured body");
  await client.sendEmailDraftForContext(context, "draft-key", undefined, "reply_all");

  expect(calls).toHaveLength(9);
  expect(calls.every(({ body }) => {
    const value = body as { organizationKey?: string; scopeKey?: string };
    return value.organizationKey === context.organizationKey && value.scopeKey === context.scopeKey;
  })).toBe(true);
  expect(calls[5]?.config).toEqual({ timeout: 4 * 60_000 });
  expect(calls[8]?.body).toMatchObject({ replyMode: "reply_all" });
});

test("favorite keeps the existing route while using captured context", async () => {
  const context = { organizationKey: "org-captured", scopeKey: "scope-captured" };
  authState.organization.key = "org-current";
  authState.scope.key = "scope-current";
  await client.setEmailThreadFavoriteForContext(context, "thread-key", true);
  expect(calls[0]).toMatchObject({ method: "POST", path: "/email/threads/thread-key/favorite", body: { ...context, isFavorite: true } });
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

test("Gmail OAuth start carries strict inbox metadata and a fixed provider", async () => {
  expect(await client.launchEmailConnection({ name: "Client inbox", description: "Priority mail" })).toBeNull();
  expect(calls[0]).toEqual({ method: "POST", path: "/email/connect", body: { organizationKey: "org-key", scopeKey: "scope-key", provider: "gmail", returnUri: "https://vorinthex.com/capability/signal", name: "Client inbox", description: "Priority mail" }, config: {} });
  expect(() => client.emailConnectionMetadataSchema.parse({ name: "", description: "Invalid" })).toThrow();
  expect(() => client.emailConnectionMetadataSchema.parse({ provider: "other", name: "Inbox" })).toThrow();
  expect(() => client.emailConnectionMetadataSchema.parse({ name: "Inbox", email: "other@example.com", appPassword: "password" })).toThrow();
  expect(client.emailProviderSchema.parse("gmail")).toBe("gmail");
  expect(() => client.emailProviderSchema.parse("other")).toThrow();
});

test("parses unassigned drafts and defaults the legacy field to an empty list", async () => {
  expect((await client.fetchEmailOverview()).unassignedDrafts).toEqual([unassignedDraft]);
  includeUnassignedDrafts = false;
  expect((await client.fetchEmailOverview()).unassignedDrafts).toEqual([]);
});

test("sends a strict draft assignment request without sending the draft", async () => {
  expect(await client.assignEmailDraft(unassignedDraft.key, connector.connectorKey)).toMatchObject({ key: unassignedDraft.key, connectorKey: connector.connectorKey });
  expect(calls[0]).toMatchObject({ method: "POST", path: `/email/drafts/${unassignedDraft.key}/assign`, body: { organizationKey: "org-key", scopeKey: "scope-key", connectorKey: connector.connectorKey } });
  expect(() => client.emailAssignDraftInputSchema.parse({ draftKey: unassignedDraft.key, connectorKey: connector.connectorKey, send: true })).toThrow();
});

test("propagates connector selectors to compose and disconnect", async () => {
  await client.composeEmailDraft({ connectorKey: connector.connectorKey, to: ["one@example.com"], subject: "Hello", tone: "warm" });
  await client.disconnectEmail(connector.connectorKey);
  expect(calls.map(({ body }) => (body as { connectorKey?: string }).connectorKey)).toEqual(Array(2).fill(connector.connectorKey));
});

test("explicit-context provider clients never reread ambient scope", async () => {
  const context = { organizationKey: "captured-org", scopeKey: "captured-scope" };
  await client.assignEmailDraftForContext(context, unassignedDraft.key, connector.connectorKey);
  await client.disconnectEmailForContext(context, connector.connectorKey);
  expect(calls.map(({ body }) => body)).toEqual([
    { ...context, connectorKey: connector.connectorKey },
    { ...context, connectorKey: connector.connectorKey },
  ]);
});

test("sends strict bulk thread mutations and parses ordered itemized reports", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  expect((await client.setEmailThreadsFavoriteForContext(context, [thread.key], true)).items[0]).toMatchObject({ threadKey: thread.key, status: "succeeded", thread: { isFavorite: true } });
  expect((await client.setEmailThreadsReadStateForContext(context, [thread.key], true)).items[0]).toMatchObject({ status: "succeeded", thread: { isRead: true, unread: false } });
  expect((await client.trashEmailThreadsForContext(context, [thread.key])).items[0]).toMatchObject({ status: "succeeded", thread: { labels: ["TRASH"], inInbox: false } });
  expect(calls.map(({ path, body }) => ({ path, body }))).toEqual([
    { path: "/email/threads/favorite", body: { ...context, threadKeys: [thread.key], isFavorite: true } },
    { path: "/email/threads/read-state", body: { ...context, threadKeys: [thread.key], isRead: true } },
    { path: "/email/threads/trash", body: { ...context, threadKeys: [thread.key] } },
  ]);
  expect(() => client.emailBulkThreadReportSchema.parse({ requested: 1, succeeded: 1, failed: 0, repairPending: 0, items: [{ threadKey: thread.key, status: "succeeded", thread }], extra: true })).toThrow();
  expect(() => client.trashEmailThreadsForContext(context, [thread.key, thread.key])).toThrow("distinct");
});

test("accepts the exact repairPending bulk item and preserves partial success order", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  bulkReportOverride = { requested: 2, succeeded: 1, failed: 0, repairPending: 1, items: [{ threadKey: thread.key, status: "succeeded", thread: { ...thread, isFavorite: true } }, { threadKey: "thread-two", status: "repairPending", error: "database unavailable" }] };
  const report = await client.setEmailThreadsFavoriteForContext(context, [thread.key, "thread-two"], true);
  expect(report.items).toEqual([expect.objectContaining({ threadKey: thread.key, status: "succeeded" }), { threadKey: "thread-two", status: "repairPending", error: "database unavailable" }]);
  expect(() => client.emailBulkThreadReportSchema.parse({ ...(bulkReportOverride as object), items: [{ threadKey: "thread-two", status: "repair_pending", error: "legacy" }] })).toThrow();
});

test("accepts strict mixed succeeded, provider-deleted, failed, and repair-pending reports", () => {
  const report = client.emailBulkThreadReportSchema.parse({
    requested: 4,
    succeeded: 2,
    failed: 1,
    repairPending: 1,
    items: [
      { threadKey: thread.key, status: "succeeded", thread },
      { threadKey: "provider-deleted", status: "deleted", error: "Email thread was not found at the provider and was deleted locally" },
      { threadKey: "failed", status: "failed", error: "permission denied" },
      { threadKey: "repair", status: "repairPending", error: "database unavailable" },
    ],
  });
  expect(report.items.map(({ status }) => status)).toEqual(["succeeded", "deleted", "failed", "repairPending"]);
  expect(() => client.emailBulkThreadReportSchema.parse({ ...report, items: report.items.map((item) => item.status === "deleted" ? { ...item, thread } : item) })).toThrow();
  expect(() => client.emailBulkThreadReportSchema.parse({ ...report, succeeded: 1 })).toThrow("counts");
});

test("clears one connector Trash with strict deletion counts", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  expect(await client.clearEmailTrashForContext(context, connector.connectorKey)).toEqual({ connectorKey: connector.connectorKey, providerMessagesDeleted: 2, threadsDeleted: 1, documentsDeleted: 3 });
  expect(calls[0]).toMatchObject({ path: "/email/trash/clear", body: { ...context, connectorKey: connector.connectorKey } });
});

test("bulk deletes generated email records through exact strict routes", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  expect(await client.deleteEmailMessageTranslationsForContext(context, { messageKey: message.key, translationKeys: [translationVersion.key] }, "translation-delete")).toEqual({ messageKey: message.key, deletedKeys: [translationVersion.key] });
  expect(await client.deleteEmailMessageSummariesForContext(context, { messageKey: message.key, summaryKeys: [summaryVersion.key] }, "summary-delete")).toEqual({ messageKey: message.key, deletedKeys: [summaryVersion.key] });
  expect(calls).toEqual([
    { method: "DELETE", path: `/email/messages/${message.key}/translations`, body: { ...context, translationKeys: [translationVersion.key] }, config: { headers: { "Idempotency-Key": "translation-delete" } } },
    { method: "DELETE", path: `/email/messages/${message.key}/summaries`, body: { ...context, summaryKeys: [summaryVersion.key] }, config: { headers: { "Idempotency-Key": "summary-delete" } } },
  ]);
  expect(() => client.emailTranslationDeleteInputSchema.parse({ messageKey: message.key, translationKeys: [translationVersion.key], extra: true })).toThrow();
  expect(() => client.emailSummaryDeleteInputSchema.parse({ messageKey: message.key, summaryKeys: [summaryVersion.key, summaryVersion.key] })).toThrow("distinct");
  expect(() => client.emailGeneratedDeleteResultSchema.parse({ messageKey: message.key, deletedKeys: [], extra: true })).toThrow();
});

test("sends idempotency keys only as mutation headers", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  await client.setEmailThreadsFavoriteForContext(context, [thread.key], true, "favorite-action");
  await client.setEmailThreadsReadStateForContext(context, [thread.key], true, "read-action");
  await client.trashEmailThreadForContext(context, thread.key, "trash-action");
  await client.clearEmailTrashForContext(context, connector.connectorKey, "clear-action");
  expect(calls.map(({ config }) => config)).toEqual([
    { headers: { "Idempotency-Key": "favorite-action" } },
    { headers: { "Idempotency-Key": "read-action" } },
    { headers: { "Idempotency-Key": "trash-action" } },
    { headers: { "Idempotency-Key": "clear-action" } },
  ]);
  expect(calls.every(({ body }) => !("idempotencyKey" in (body as object)))).toBe(true);
});

test("uses canonical hard-delete routes for persisted drafts and custom tones", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  expect(await client.deleteEmailDraftForContext(context, "draft-key", "draft-delete")).toEqual({ deletedKey: "draft-key" });
  expect(await client.deleteEmailToneForContext(context, "tone-direct", "tone-delete")).toEqual({ deletedKey: "tone-direct" });
  expect(calls).toEqual([
    { method: "DELETE", path: "/email/drafts/draft-key", body: context, config: { headers: { "Idempotency-Key": "draft-delete" } } },
    { method: "DELETE", path: "/email/tones/tone-direct", body: context, config: { headers: { "Idempotency-Key": "tone-delete" } } },
  ]);
});

test("forwards one supplied idempotency key for every supported mutation and never for reads", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  const mutate = async (key: string, operation: () => Promise<unknown>) => {
    const start = calls.length;
    await operation();
    expect(calls[start]?.config).toMatchObject({ headers: { "Idempotency-Key": key } });
  };
  await mutate("draft-create", () => client.createEmailDraftForContext(context, { threadKey: thread.key, replyMode: "reply", tone: "concise" }, "draft-create"));
  await mutate("draft-compose", () => client.composeEmailDraftForContext(context, { connectorKey: connector.connectorKey, to: ["one@example.com"], subject: "Subject", tone: "concise" }, "draft-compose"));
  await mutate("draft-update", () => client.updateEmailDraftForContext(context, draft.key, "Updated", "draft-update"));
  await mutate("draft-assign", () => client.assignEmailDraftForContext(context, draft.key, connector.connectorKey, "draft-assign"));
  await mutate("draft-send", () => client.sendEmailDraftForContext(context, draft.key, "draft-send"));
  await mutate("draft-delete", () => client.deleteEmailDraftForContext(context, draft.key, "draft-delete"));
  await mutate("tone-create", () => client.createEmailToneForContext(context, { name: "Direct", instruction: "Be direct" }, "tone-create"));
  await mutate("tone-update", () => client.updateEmailToneForContext(context, { toneKey: tones[1]!.key, isFavorite: true }, "tone-update"));
  await mutate("tone-delete", () => client.deleteEmailToneForContext(context, tones[1]!.key, "tone-delete"));
  await mutate("inbox-update", () => client.updateEmailInboxForContext(context, { connectorKey: connector.connectorKey, isFavorite: false }, "inbox-update"));
  await mutate("context-create", () => client.createEmailReplyContextForContext(context, { name: "Context", text: "Text" }, "context-create"));
  await mutate("context-update", () => client.updateEmailReplyContextForContext(context, { noteKey: replyContexts[0]!.key, text: "Updated" }, "context-update"));
  await mutate("context-delete", () => client.deleteEmailReplyContextsForContext(context, [replyContexts[0]!.key], "context-delete"));
  await mutate("translate", () => client.translateEmailMessageForContext(context, message.key, { targetLanguage: "French" }, "translate"));
  await mutate("summarize", () => client.summarizeEmailMessageForContext(context, message.key, {}, "summarize"));
  await mutate("translation-delete", () => client.deleteEmailMessageTranslationsForContext(context, { messageKey: message.key, translationKeys: [translationVersion.key] }, "translation-delete"));
  await mutate("summary-delete", () => client.deleteEmailMessageSummariesForContext(context, { messageKey: message.key, summaryKeys: [summaryVersion.key] }, "summary-delete"));
  await client.fetchEmailOverviewForContext(context);
  await client.fetchEmailThreadForContext(context, thread.key);
  await client.fetchEmailTonesForContext(context);
  expect(calls.slice(-3).every(({ config }) => !(config as { headers?: Record<string, string> } | undefined)?.headers?.["Idempotency-Key"])).toBe(true);
});

test("parses exact backend-shaped public projections and rejects private identities", async () => {
  const context = { organizationKey: "org-key", scopeKey: "scope-key" };
  expect((await client.fetchEmailOverviewForContext(context, { connectorKey: connector.connectorKey })).threads).toEqual([thread]);
  const detail = await client.fetchEmailThreadForContext(context, thread.key);
  expect(detail).toMatchObject({ thread, messages: [{ ...message, bodyTruncated: false }], nextCursor: null, truncated: false });
  expect(() => client.emailThreadSchema.parse({ ...thread, scopeKey: "private" })).toThrow();
  expect(() => client.emailThreadSchema.parse({ ...thread, accountKey: "private" })).toThrow();
  expect(() => client.emailThreadSchema.parse({ ...thread, providerThreadId: "private" })).toThrow();
  expect(() => client.emailMessageSchema.parse({ ...message, providerMessageId: "private" })).toThrow();
  expect(() => client.emailDraftSchema.parse({ ...draft, scopeKey: "private" })).toThrow();
});

test("thread detail continuations send the bounded cursor in the request body", async () => {
  await client.fetchEmailThreadForContext({ organizationKey: "org-key", scopeKey: "scope-key" }, thread.key, "next-page");
  expect(calls.at(-1)).toMatchObject({ method: "POST", path: `/email/threads/${thread.key}`, body: { organizationKey: "org-key", scopeKey: "scope-key", cursor: "next-page" } });
});
