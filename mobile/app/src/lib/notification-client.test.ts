import { beforeEach, expect, mock, test } from "bun:test";

const calls: { path: string; body: unknown }[] = [];
let response: unknown;

mock.module("@/lib/api-client", () => ({ apiClient: {
  post: async (path: string, body: unknown) => { calls.push({ path, body }); return { data: response }; },
} }));

const client = await import("./notification-client");
const validItem = { key: "notification-1-user-1", title: "Ready", message: "Open the app.", scopeKey: "scope-1", isRead: false, readAt: null, createdAt: "2026-09-06T12:00:00.000Z" };

beforeEach(() => {
  calls.length = 0;
  response = { success: true, data: { items: [validItem], unreadCount: 1, nextCursor: null } };
});

test("sends exact default and explicit notification history requests", async () => {
  await expect(client.listNotifications({ teamKey: "team-1", scopeKey: "scope-1" })).resolves.toMatchObject({ unreadCount: 1 });
  await client.listNotifications({ teamKey: "team-1", scopeKey: "scope-1", markRead: true, limit: 10 });
  expect(calls).toEqual([
    { path: "/auth/me/notifications", body: { teamKey: "team-1", scopeKey: "scope-1", markRead: false, limit: 50 } },
    { path: "/auth/me/notifications", body: { teamKey: "team-1", scopeKey: "scope-1", markRead: true, limit: 10 } },
  ]);
});

test("strictly rejects malformed notification history responses", async () => {
  const invalidResponses = [
    { success: false, data: { items: [], unreadCount: 0, nextCursor: null } },
    { success: true, data: { items: [{ ...validItem, createdAt: "yesterday" }], unreadCount: 1, nextCursor: null } },
    { success: true, data: { items: [validItem], unreadCount: -1, nextCursor: null } },
    { success: true, data: { items: [validItem], unreadCount: 0.5, nextCursor: null } },
    { success: true, data: { items: [{ ...validItem, extra: true }], unreadCount: 1, nextCursor: null } },
    { success: true, data: { items: [validItem], unreadCount: 1, nextCursor: null }, extra: true },
  ];
  for (const invalid of invalidResponses) {
    response = invalid;
    await expect(client.listNotifications({ teamKey: "team-1", scopeKey: "scope-1" })).rejects.toThrow();
  }
});

test("isolates notification query caches by user and team", () => {
  expect(client.notificationQueryKey("user-1", "team-1")).toEqual(["notifications", "user-1", "team-1"]);
  expect(client.notificationQueryKey("user-2", "team-1")).not.toEqual(client.notificationQueryKey("user-1", "team-1"));
  expect(client.notificationQueryKey("user-1", "team-2")).not.toEqual(client.notificationQueryKey("user-1", "team-1"));
});
