import { afterAll, beforeEach, expect, mock, test } from "bun:test";

const calls: { method: string; path: string; body: unknown; config?: unknown }[] = [];
const responses = new Map<string, unknown>();
let patchHandler: ((path: string, body: unknown) => Promise<unknown>) | undefined;

mock.module("expo-file-system", () => ({ File: class { async arrayBuffer() { return new Uint8Array(4).buffer; } } }));
mock.module("@/lib/api-client", () => ({ apiClient: {
  patch: async (path: string, body: unknown) => { calls.push({ method: "PATCH", path, body }); return { data: patchHandler ? await patchHandler(path, body) : responses.get(path) }; },
  post: async (path: string, body: unknown, config?: unknown) => { calls.push({ method: "POST", path, body, config }); return { data: responses.get(path) }; },
  put: async (path: string, body: unknown, config?: unknown) => { calls.push({ method: "PUT", path, body, config }); return { data: responses.get(path) }; },
} }));

const realFetch = globalThis.fetch;
const client = await import("./profile-client");

beforeEach(() => {
  calls.length = 0;
  responses.clear();
  patchHandler = undefined;
  globalThis.fetch = mock(async () => new Response(null, { status: 200 })) as typeof fetch;
});

test("updates a profile name with the exact endpoint payload", async () => {
  responses.set("/auth/me/profile", { user: { name: "Ada Lovelace" } });
  expect(await client.updateProfileName("  Ada Lovelace  ")).toEqual({ name: "Ada Lovelace" });
  expect(calls).toEqual([{ method: "PATCH", path: "/auth/me/profile", body: { name: "Ada Lovelace" } }]);
});

test("uploads and completes a profile avatar", async () => {
  responses.set("/auth/me/profile/avatar/uploads/presign", { uploadKey: "upload-key", url: "https://upload.example/avatar", headers: { "Content-Type": "image/png" } });
  responses.set("/auth/me/profile/avatar/uploads/complete", { avatarUrl: "https://cdn.example/avatar.png" });
  expect(await client.uploadProfileAvatar({ filename: "avatar.png", mimeType: "image/png", sizeBytes: 4, uri: "file:///avatar.png" })).toEqual({ avatarUrl: "https://cdn.example/avatar.png" });
  expect(calls.map(({ method, path, body }) => ({ method, path, body }))).toEqual([
    { method: "POST", path: "/auth/me/profile/avatar/uploads/presign", body: { filename: "avatar.png", mimeType: "image/png", sizeBytes: 4 } },
    { method: "POST", path: "/auth/me/profile/avatar/uploads/complete", body: { uploadKey: "upload-key" } },
  ]);
  expect(globalThis.fetch).toHaveBeenCalledWith("https://upload.example/avatar", { method: "PUT", headers: { "Content-Type": "image/png" }, body: expect.any(ArrayBuffer) });
});

test("keeps the local avatar when committed completion cannot sign a read URL", async () => {
  responses.set("/auth/me/profile/avatar/uploads/presign", { uploadKey: "upload-key", url: "https://upload.example/avatar" });
  responses.set("/auth/me/profile/avatar/uploads/complete", { profile: { avatarUrl: null } });
  await expect(client.uploadProfileAvatar({ filename: "avatar.png", mimeType: "image/png", sizeBytes: 4, uri: "file:///avatar.png" })).resolves.toEqual({ avatarUrl: "file:///avatar.png" });
});

test("serializes name updates so the server cannot commit them out of order", async () => {
  let releaseFirst!: () => void;
  const firstBlocked = new Promise<void>((resolve) => { releaseFirst = resolve; });
  patchHandler = async (_path, body) => {
    if ((body as { name: string }).name === "Grace") await firstBlocked;
    return { profile: body };
  };
  const first = client.updateProfileName("Grace");
  const second = client.updateProfileName("Katherine");
  await new Promise((resolve) => setTimeout(resolve, 0));
  expect(calls.map(({ body }) => body)).toEqual([{ name: "Grace" }]);
  releaseFirst();
  await Promise.all([first, second]);
  expect(calls.map(({ body }) => body)).toEqual([{ name: "Grace" }, { name: "Katherine" }]);
});

test("creates a scoped ticket with an idempotency key", async () => {
  const ticket = { key: "ticket-key", threadKey: "thread-key", initialMessageKey: "message-key", message: "Something broke", kind: "issue", createdAt: "2026-09-03T12:00:00.000Z" };
  responses.set("/tickets", { success: true, data: ticket });
  await expect(client.createSupportTicket({ teamKey: "team", scopeKey: "scope", message: "Something broke" }, "request-key")).resolves.toEqual(ticket);
  expect(calls).toEqual([{ method: "POST", path: "/tickets", body: { teamKey: "team", scopeKey: "scope", message: "Something broke" }, config: { headers: { "Idempotency-Key": "request-key" } } }]);
});

test("creates scoped feedback with strict thread linkage and no community list or vote requests", async () => {
  const feedback = { key: "feedback-key", threadKey: "thread-key", initialMessageKey: "message-key", message: "Add keyboard shortcuts", kind: "feedback", createdAt: "2026-09-03T12:00:00.000Z" };
  responses.set("/feedback", { success: true, data: feedback });

  await expect(client.createFeedback({ teamKey: "team", scopeKey: "scope", message: "Add keyboard shortcuts" }, "create-key")).resolves.toEqual(feedback);

  expect(calls).toEqual([{ method: "POST", path: "/feedback", body: { teamKey: "team", scopeKey: "scope", message: "Add keyboard shortcuts" }, config: { headers: { "Idempotency-Key": "create-key" } } }]);
});

test("profile request schemas reject unknown or invalid input", () => {
  expect(client.ticketSchema.safeParse({ teamKey: "team", scopeKey: "scope", message: "Issue", extra: true }).success).toBe(false);
  expect(client.ticketThreadLinkSchema.safeParse({ key: "ticket", threadKey: "thread", extra: true }).success).toBe(false);
  expect(client.avatarUploadSchema.safeParse({ filename: "../avatar.png", mimeType: "image/png", sizeBytes: 4, uri: "file:///avatar.png" }).success).toBe(false);
});

afterAll(() => { globalThis.fetch = realFetch; });
