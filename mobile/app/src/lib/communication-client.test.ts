import { beforeEach, expect, mock, test } from "bun:test";

const calls: { method: string; path: string; body?: unknown; config?: unknown }[] = [];
const responses = new Map<string, unknown>();
mock.module("@/lib/api-client", () => ({ apiClient: {
  get: async (path: string) => { calls.push({ method: "GET", path }); return { data: responses.get(path) }; },
  post: async (path: string, body: unknown, config?: unknown) => { calls.push({ method: "POST", path, body, config }); return { data: responses.get(path) }; },
  put: async (path: string, body: unknown) => { calls.push({ method: "PUT", path, body }); return { data: responses.get(path) }; },
} }));

const client = await import("./communication-client");
const timestamp = "2026-09-09T12:00:00.000Z";
const context = { userKey: "user-1", teamKey: "team-1", scopeKey: "scope-1" };
const thread = { key: "thread-1", kind: "issue", source: { kind: "internal", label: "Vorinthex Support" }, subject: "Support issue", preview: "We are looking into this.", isRead: false, canReply: true, updatedAt: timestamp };
const storedThread = { key: "thread-1", kind: "issue", subject: "Support issue", createdBy: "user", readAt: null, lastMessageAt: timestamp, preview: "We are looking into this." };
const storedDetail = { thread: storedThread, messages: [{ key: "message-1", sender: "staff", body: "We are looking into this.", createdAt: timestamp }] };

beforeEach(() => { calls.length = 0; responses.clear(); });

test("uses strict communication list, detail, read-state, and reply contracts", async () => {
  responses.set("/auth/me/communications/list", { success: true, data: { items: [storedThread], unreadCount: 1, nextCursor: null } });
  responses.set("/auth/me/communications/thread-1/read", { success: true, data: storedDetail });
  responses.set("/auth/me/communications/thread-1/read-state", { success: true, data: storedThread });
  responses.set("/auth/me/communications/thread-1/messages", { success: true, data: storedDetail.messages[0] });
  await expect(client.listCommunicationThreads({ tab: "inbox", limit: 50 }, context)).resolves.toEqual({ items: [{ ...thread, source: { kind: "internal", label: "Vorinthex" } }], unreadCount: 1, nextCursor: null });
  await client.readCommunicationThread("thread-1", context);
  await client.markCommunicationThreadRead("thread-1", context);
  await client.replyToCommunicationThread("thread-1", " Thank you ", "request-1", context);
  expect(calls).toEqual([
    { method: "POST", path: "/auth/me/communications/list", body: { teamKey: "team-1", scopeKey: "scope-1", mailbox: "inbox", limit: 50 }, config: undefined },
    { method: "POST", path: "/auth/me/communications/thread-1/read", body: { teamKey: "team-1", scopeKey: "scope-1" }, config: undefined },
    { method: "PUT", path: "/auth/me/communications/thread-1/read-state", body: { teamKey: "team-1", scopeKey: "scope-1", read: true } },
    { method: "POST", path: "/auth/me/communications/thread-1/read", body: { teamKey: "team-1", scopeKey: "scope-1" }, config: undefined },
    { method: "POST", path: "/auth/me/communications/thread-1/messages", body: { teamKey: "team-1", scopeKey: "scope-1", message: "Thank you" }, config: { headers: { "Idempotency-Key": "request-1" } } },
    { method: "POST", path: "/auth/me/communications/thread-1/read", body: { teamKey: "team-1", scopeKey: "scope-1" }, config: undefined },
  ]);
});

test("rejects unknown request and response fields and scopes query keys", async () => {
  expect(client.communicationListInputSchema.safeParse({ tab: "inbox", limit: 10, extra: true }).success).toBe(false);
  responses.set("/auth/me/communications/list", { success: true, data: { items: [{ ...storedThread, kind: "email" }], unreadCount: 0, nextCursor: null } });
  await expect(client.listCommunicationThreads({ tab: "inbox" }, context)).rejects.toThrow();
  const first = client.communicationQueryKeys.list({ userKey: "user-1", teamKey: "team", scopeKey: "scope" }, "inbox");
  const second = client.communicationQueryKeys.list({ userKey: "user-2", teamKey: "team", scopeKey: "scope" }, "inbox");
  expect(first).not.toEqual(second);
});
