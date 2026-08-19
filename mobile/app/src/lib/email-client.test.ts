import { beforeEach, expect, mock, test } from "bun:test";

const calls: { method: string; path: string; body: unknown; config?: unknown }[] = [];
const authState = { organization: { key: "org-key", role: "member" }, scope: { key: "scope-key", role: "moderator" } };
const now = "2026-08-11T10:00:00.000Z";
const thread = { key: "thread-key", scopeKey: "scope-key", accountKey: "account-key", providerThreadId: "provider-thread", subject: "Subject", summary: "Summary", intent: "Review message", priority: "normal", state: "needs_action", lastMessageAt: now, latestFrom: "sender@example.com", isFavorite: false, createdAt: now, updatedAt: now };
const draft = { key: "draft-key", scopeKey: "scope-key", threadKey: "thread-key", messageKey: "message-key", generatedContent: "Reply", status: "generated", createdAt: now, updatedAt: now };

mock.module("@/state/auth", () => ({ useAuthStore: { getState: () => authState } }));
mock.module("expo-linking", () => ({ parse: () => ({ queryParams: {} }) }));
mock.module("expo-web-browser", () => ({ openAuthSessionAsync: async () => ({ type: "cancel" }) }));
mock.module("./api-client", () => ({ apiClient: {
  post: async (path: string, body: unknown, config?: unknown) => {
    calls.push({ method: "POST", path, body, config });
    const data = path === "/email/overview" ? { account: null, connector: null, threads: [thread], counts: { all: 1, important: 0, urgent: 0, needsAction: 1, filtered: 0, unread: 0, favorite: 0 } }
      : path === "/email/drafts" ? draft
        : path.endsWith("/favorite") ? { ...thread, isFavorite: true }
        : path.endsWith("/send") ? { sent: true, providerMessageId: "sent-1", threadKey: "thread-key" }
          : path === "/email/sync" ? { synced: 1, lastSyncedAt: now }
            : path === "/assistant/respond" ? { type: "answer", message: "Synced Signal.", sources: [], changes: [{ workspace: "signal" }] }
              : {};
    return { data: { success: true, data } };
  },
  patch: async (path: string, body: unknown) => { calls.push({ method: "PATCH", path, body }); return { data: { success: true, data: { ...draft, finalContent: "Edited", status: "edited" } } }; },
} }));

const client = await import("./email-client");
beforeEach(() => calls.splice(0));

test("sends scoped overview, sync, draft, edit, and send requests", async () => {
  expect((await client.fetchEmailOverview({ filter: "needs_action" })).threads).toHaveLength(1);
  await client.syncEmail();
  await client.setEmailThreadFavorite("thread-key", true);
  await client.createEmailDraft({ threadKey: "thread-key", tone: "warm" });
  await client.updateEmailDraft("draft-key", "Edited");
  await client.sendEmailDraft("draft-key");
  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual([
    "POST /email/overview", "POST /email/sync", "POST /email/threads/thread-key/favorite", "POST /email/drafts", "PATCH /email/drafts/draft-key", "POST /email/drafts/draft-key/send",
  ]);
  expect(calls[0]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", filter: "needs_action" });
  expect(calls[1]?.config).toEqual({ timeout: 120_000 });
  expect(calls[2]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", isFavorite: true });
  expect(calls[3]?.body).toEqual({ organizationKey: "org-key", scopeKey: "scope-key", threadKey: "thread-key", tone: "warm" });
});

test("rejects invalid drafting tones before a request", () => {
  expect(() => client.emailToneSchema.parse("deceptive")).toThrow();
  expect(client.getEmailPermissions()).toEqual({ canManageConnector: false, canMutate: true });
});

test("sends Signal assistant requests with a replay key and accepts workspace changes", async () => {
  expect(await client.askEmailAssistant("Sync my inbox", "request-1")).toEqual({ type: "answer", message: "Synced Signal.", sources: [], changes: [{ workspace: "signal" }] });
  expect(calls[0]).toMatchObject({
    method: "POST",
    path: "/assistant/respond",
    body: { organizationKey: "org-key", scopeKey: "scope-key", input: { surface: "signal-workspace", requestKey: "request-1", message: "Sync my inbox" } },
  });
});
