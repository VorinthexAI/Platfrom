import { beforeEach, describe, expect, mock, test } from "bun:test";
import { subscribeUserSearchHistoryAppends } from "./user-search-history-events";

const calls: { method: string; path: string; body?: unknown; config?: unknown }[] = [];
const timestamp = "2026-09-01T10:00:00.000Z";
const serverConversation = { key: "conversation-key", organizationKey: "org", scopeKey: "scope", userKey: "user", name: "Planning", isFavorite: false, createdAt: timestamp, updatedAt: timestamp };
const retrieval = { query: "roadmap", limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: "documents", results: [{ key: "document-key", label: "Roadmap" }] }] };
const serverMessage = { key: "assistant-key", conversationKey: serverConversation.key, turnKey: "request", type: "TEXT", role: "ASSISTANT", status: "COMPLETED", content: "Answer", retrievals: [retrieval], createdAt: timestamp, completedAt: timestamp };
let response: unknown;
const responses = new Map<string, unknown>();

mock.module("./api-client", () => ({
  apiClient: {
    post: async (path: string, body: unknown, config?: unknown) => { calls.push({ method: "POST", path, body, config }); return { data: responses.get(path) ?? response }; },
    patch: async (path: string, body: unknown, config?: unknown) => { calls.push({ method: "PATCH", path, body, config }); return { data: response }; },
    delete: async (path: string, config?: unknown) => { calls.push({ method: "DELETE", path, config }); return { data: response }; },
  },
}));
mock.module("expo-file-system", () => ({ File: class { constructor(private uri: string) {} async arrayBuffer() { return new Uint8Array(Number(this.uri.split(":").at(-1))).buffer; } } }));
const client = await import("./conversation-client");
const context = { userKey: "user", organizationKey: "org", scopeKey: "scope" };
const start = { event: "start", id: "correlation", data: JSON.stringify({ type: "start", correlationKey: "correlation", conversationKey: serverConversation.key, userMessageKey: "user-message", assistantMessageKey: "assistant-key" }) };
const delta = { event: "delta", id: "correlation", data: JSON.stringify({ type: "delta", correlationKey: "correlation", assistantMessageKey: "assistant-key", text: "Ans" }) };
const done = { event: "done", id: "correlation", data: JSON.stringify({ type: "done", correlationKey: "correlation", conversationKey: serverConversation.key, message: serverMessage, name: "Named", replayed: false }) };

beforeEach(() => { calls.length = 0; responses.clear(); response = undefined; });

test("identifies only HTTP 404 responses as deleted conversation errors", () => {
  expect(client.isConversationNotFoundError({ isAxiosError: true, response: { status: 404 } })).toBe(true);
  expect(client.isConversationNotFoundError({ isAxiosError: true, response: { status: 500 } })).toBe(false);
  expect(client.isConversationNotFoundError(new Error("not found"))).toBe(false);
});

test("strictly parses owner-projected conversations and retains safe-message lifecycle fields", () => {
  expect(client.conversationSchema.parse(serverConversation)).toEqual({ key: serverConversation.key, name: "Planning", isFavorite: false, createdAt: timestamp, updatedAt: timestamp });
  expect(client.conversationMessageSchema.parse(serverMessage)).toEqual({ key: "assistant-key", conversationKey: serverConversation.key, turnKey: "request", kind: "text", role: "assistant", status: "COMPLETED", content: "Answer", retrievals: [retrieval], createdAt: timestamp, completedAt: timestamp });
  expect(() => client.conversationSchema.parse({ ...serverConversation, unknown: true })).toThrow();
  expect(() => client.conversationMessageSchema.parse({ ...serverMessage, role: "assistant" })).toThrow();
});

test("requires strict bounded retrievals on list messages and SSE completions", async () => {
  response = { success: true, data: { items: [serverMessage], nextCursor: null } };
  expect((await client.listConversationMessages(context, serverConversation.key)).messages[0]?.retrievals).toEqual([retrieval]);
  expect(client.parseConversationTurnEvent(done)).toMatchObject({ type: "done", message: { retrievals: [retrieval] } });
  expect(() => client.conversationMessageSchema.parse({ ...serverMessage, retrievals: undefined })).toThrow();
  expect(() => client.conversationMessageSchema.parse({ ...serverMessage, retrievals: [{ ...retrieval, unknown: true }] })).toThrow();
  expect(() => client.conversationMessageSchema.parse({ ...serverMessage, retrievals: [{ ...retrieval, filters: { unknown: true } }] })).toThrow();
  expect(() => client.conversationMessageSchema.parse({ ...serverMessage, retrievals: [{ ...retrieval, groups: [{ ...retrieval.groups[0], results: [{ ...retrieval.groups[0]!.results[0], unknown: true }] }] }] })).toThrow();
  expect(() => client.conversationMessageSchema.parse({ ...serverMessage, retrievals: [{ ...retrieval, groups: [] }] })).toThrow();
  expect(() => client.conversationMessageSchema.parse({ ...serverMessage, retrievals: [{ ...retrieval, limit: 51 }] })).toThrow();
  expect(() => client.conversationMessageSchema.parse({ ...serverMessage, retrievals: Array.from({ length: 5 }, () => retrieval) })).toThrow();
});

test("accepts query-free tool result retrievals but rejects query-free search retrievals", () => {
  const resultRetrieval = { source: "results", limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: "collections", results: [{ key: "collection-key", label: "City After Rain" }] }] };
  expect(client.conversationMessageSchema.parse({ ...serverMessage, retrievals: [resultRetrieval] })).toMatchObject({ retrievals: [resultRetrieval] });
  expect(() => client.conversationMessageSchema.parse({ ...serverMessage, retrievals: [{ ...retrieval, query: undefined }] })).toThrow();
  expect(() => client.conversationMessageSchema.parse({ ...serverMessage, retrievals: [{ ...retrieval, query: "   " }] })).toThrow();
});

test("sends favorite and history selectors only to corrected conversation endpoints", async () => {
  response = { success: true, data: { items: [serverConversation], nextCursor: "next" } };
  await client.listConversations(context, { cursor: "cursor", favoriteOnly: true });
  await client.listConversations(context, { query: "plan", favoriteOnly: true, recordHistory: false });
  await client.listConversations(context, { query: "plan", favoriteOnly: true, recordHistory: true });
  expect(calls.map(({ path }) => path)).toEqual(["/conversations/list", "/conversations/search", "/conversations/search"]);
  expect(calls[0]?.body).toEqual({ organizationKey: "org", scopeKey: "scope", cursor: "cursor", favoriteOnly: true, limit: 25 });
  expect(calls[2]?.body).toEqual({ organizationKey: "org", scopeKey: "scope", query: "plan", favoriteOnly: true, recordHistory: true, limit: 25 });
});

test("publishes canonical history only after a successful recordHistory search", async () => {
  const appended: string[] = [];
  const unsubscribe = subscribeUserSearchHistoryAppends((userKey) => appended.push(userKey));
  response = { success: true, data: { items: [], nextCursor: null } };
  await client.listConversations(context, { query: "plan", recordHistory: false });
  await client.listConversations(context, { query: "plan", recordHistory: true });
  response = { success: true, data: { items: [{ invalid: true }], nextCursor: null } };
  await expect(client.listConversations(context, { query: "broken", recordHistory: true })).rejects.toThrow();
  unsubscribe();
  expect(appended).toEqual(["user"]);
});

test("passes abort signals through create, update, favorite, and delete mutations", async () => {
  const controller = new AbortController();
  response = { success: true, data: serverConversation };
  await client.createConversation(context, "New chat", controller.signal);
  await client.updateConversation(context, serverConversation.key, { name: "Renamed" }, controller.signal);
  await client.updateConversation(context, serverConversation.key, { isFavorite: true }, controller.signal);
  response = { success: true, data: { deletedKey: serverConversation.key } };
  await client.deleteConversation(context, serverConversation.key, controller.signal);
  response = { success: true, data: { deletedKeys: [serverMessage.key, "user-message"] } };
  await expect(client.deleteConversationMessage(context, serverConversation.key, serverMessage.key, controller.signal)).resolves.toEqual({ deletedKeys: [serverMessage.key, "user-message"] });
  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /conversations", `PATCH /conversations/${serverConversation.key}`, `POST /conversations/${serverConversation.key}/favorite`, `DELETE /conversations/${serverConversation.key}`, `DELETE /conversations/${serverConversation.key}/messages/${serverMessage.key}`]);
  for (const call of calls) expect(call.config).toMatchObject({ signal: controller.signal });
  expect(calls.at(-1)?.config).toMatchObject({ data: { organizationKey: "org", scopeKey: "scope" } });
});

test("queues strict image turns and retains IMAGE lifecycle fields", async () => {
  const user = { ...serverMessage, key: "image-user", type: "IMAGE", role: "USER", content: "A silver forest", retrievals: [] };
  const assistant = { ...serverMessage, key: "image-assistant", type: "IMAGE", content: JSON.stringify({ prompt: user.content }), imageKey: "cm123456789", retrievals: [] };
  response = { success: true, data: { user, assistant, replayed: false } };
  await expect(client.enqueueConversationImageTurn(context, { conversationKey: serverConversation.key, prompt: user.content, requestKey: "image-request" })).resolves.toMatchObject({ assistant: { kind: "image", imageKey: "cm123456789" } });
  expect(calls[0]).toMatchObject({ method: "POST", path: `/conversations/${serverConversation.key}/image-turns`, body: { organizationKey: "org", scopeKey: "scope", prompt: user.content, requestKey: "image-request", referenceImageKeys: [], size: "1024x1024", quality: "medium", mode: "default" } });
  expect(() => client.conversationMessageSchema.parse({ ...assistant, type: "TEXT" })).toThrow();
});

test("uses exact backend bounds for names, turns, and message pages", async () => {
  response = { success: true, data: { items: [serverMessage], nextCursor: null } };
  await client.listConversationMessages(context, serverConversation.key, "older");
  expect(calls[0]?.body).toEqual({ organizationKey: "org", scopeKey: "scope", cursor: "older", limit: 10 });
  expect(client.CONVERSATION_MESSAGE_PAGE_SIZE).toBe(10);
  expect(client.CONVERSATION_NAME_MAX_LENGTH).toBe(200);
  expect(client.CONVERSATION_MESSAGE_MAX_LENGTH).toBe(20_000);
});

function transport(frames: { event: string; data: string; id?: string }[], failure?: Error) {
  return async (path: string, body: unknown, emit: (frame: { event: string; data: string; id?: string }) => void) => {
    calls.push({ method: "STREAM", path, body });
    for (const frame of frames) emit(frame);
    if (failure) throw failure;
  };
}

describe("strict conversation turn protocol", () => {
  test("accepts one start, matching deltas, and exactly one done", async () => {
    const events: string[] = [];
    await client.streamConversationTurnWithTransport(transport([start, delta, done]), context, { conversationKey: serverConversation.key, message: "x".repeat(20_000), requestKey: "request" }, (event) => events.push(event.type));
    expect(events).toEqual(["start", "delta", "done"]);
    expect(calls[0]).toMatchObject({ path: `/conversations/${serverConversation.key}/turn/stream`, body: { message: "x".repeat(20_000), requestKey: "request" } });
  });

  test("sends bounded attachment keys with the conversation turn", async () => {
    await client.streamConversationTurnWithTransport(transport([start, done]), context, { conversationKey: serverConversation.key, message: "Use these", requestKey: "request", attachmentKeys: ["attachment-1", "attachment-2"] }, () => undefined);
    expect(calls[0]?.body).toEqual({ organizationKey: "org", scopeKey: "scope", message: "Use these", requestKey: "request", attachmentKeys: ["attachment-1", "attachment-2"], referenceImageKeys: [] });
    await expect(client.streamConversationTurnWithTransport(transport([]), context, { conversationKey: serverConversation.key, message: "Too many", requestKey: "request", attachmentKeys: Array.from({ length: 11 }, (_, index) => `attachment-${index}`) }, () => undefined)).rejects.toThrow();
  });

  test("rejects messages above the exact 20k backend bound before transport", async () => {
    let invoked = false;
    await expect(client.streamConversationTurnWithTransport(async () => { invoked = true; }, context, { conversationKey: serverConversation.key, message: "x".repeat(20_001), requestKey: "request" }, () => undefined)).rejects.toThrow();
    expect(invoked).toBe(false);
  });

  test("rejects clean premature EOF and transport failure", async () => {
    await expect(client.streamConversationTurnWithTransport(transport([start]), context, { conversationKey: serverConversation.key, message: "Question", requestKey: "request" }, () => undefined)).rejects.toThrow("terminal");
    await expect(client.streamConversationTurnWithTransport(transport([], new Error("network lost")), context, { conversationKey: serverConversation.key, message: "Question", requestKey: "request" }, () => undefined)).rejects.toThrow("network lost");
  });

  test("rejects malformed, unknown, out-of-order, and duplicate events", async () => {
    const input = { conversationKey: serverConversation.key, message: "Question", requestKey: "request" };
    await expect(client.streamConversationTurnWithTransport(transport([{ event: "mystery", data: "{}" }]), context, input, () => undefined)).rejects.toThrow("Unknown");
    await expect(client.streamConversationTurnWithTransport(transport([{ event: "start", data: "{" }]), context, input, () => undefined)).rejects.toThrow();
    await expect(client.streamConversationTurnWithTransport(transport([delta]), context, input, () => undefined)).rejects.toThrow("before start");
    await expect(client.streamConversationTurnWithTransport(transport([start, start]), context, input, () => undefined)).rejects.toThrow("more than one start");
    await expect(client.streamConversationTurnWithTransport(transport([start, done, done]), context, input, () => undefined)).rejects.toThrow("after its terminal");
  });

  test("rejects mismatched ids, correlations, conversation keys, and assistant keys", async () => {
    const input = { conversationKey: serverConversation.key, message: "Question", requestKey: "request" };
    await expect(client.streamConversationTurnWithTransport(transport([{ ...start, id: "other" }]), context, input, () => undefined)).rejects.toThrow("event id");
    await expect(client.streamConversationTurnWithTransport(transport([start, { ...delta, id: "other", data: JSON.stringify({ type: "delta", correlationKey: "other", assistantMessageKey: "assistant-key", text: "x" }) }]), context, input, () => undefined)).rejects.toThrow("active turn");
    await expect(client.streamConversationTurnWithTransport(transport([start, { ...done, data: JSON.stringify({ ...JSON.parse(done.data), conversationKey: "other" }) }]), context, input, () => undefined)).rejects.toThrow("active turn");
    await expect(client.streamConversationTurnWithTransport(transport([start, { ...done, data: JSON.stringify({ ...JSON.parse(done.data), message: { ...serverMessage, key: "other" } }) }]), context, input, () => undefined)).rejects.toThrow("active turn");
  });

  test("accepts a matching pre-start failure and validates terminal error correlation", async () => {
    const input = { conversationKey: serverConversation.key, message: "Question", requestKey: "request" };
    const preStartError = { event: "error", id: "request", data: JSON.stringify({ type: "error", correlationKey: "request", code: "FAILED", message: "No response" }) };
    await expect(client.streamConversationTurnWithTransport(transport([preStartError]), context, input, () => undefined)).rejects.toThrow("No response");
    const wrongPreStart = { ...preStartError, id: "other", data: JSON.stringify({ type: "error", correlationKey: "other", code: "FAILED", message: "No response" }) };
    await expect(client.streamConversationTurnWithTransport(transport([wrongPreStart]), context, input, () => undefined)).rejects.toThrow("requested turn");
    const terminalError = { ...preStartError, id: "correlation", data: JSON.stringify({ type: "error", correlationKey: "correlation", code: "FAILED", message: "No response" }) };
    await expect(client.streamConversationTurnWithTransport(transport([start, terminalError]), context, input, () => undefined)).rejects.toThrow("No response");
    const wrong = { ...preStartError, id: "other", data: JSON.stringify({ type: "error", correlationKey: "other", code: "FAILED", message: "No response" }) };
    await expect(client.streamConversationTurnWithTransport(transport([start, wrong]), context, input, () => undefined)).rejects.toThrow("active turn");
  });
});

test("reserves, directly uploads, and completes transient attachments", async () => {
  const presignPath = `/conversations/${serverConversation.key}/attachments/uploads/presign`;
  const completePath = `/conversations/${serverConversation.key}/attachments/uploads/complete`;
  responses.set(presignPath, { success: true, data: { uploads: [{ clientKey: "local-1", attachmentKey: "attachment-1", url: "https://uploads.example/attachment", headers: { "Content-Type": "image/png" }, expiresAt: timestamp }] } });
  responses.set(completePath, { success: true, data: { attachments: [{ attachmentKey: "attachment-1", kind: "image", filename: "photo.png", mimeType: "image/png", sizeBytes: 4, width: 10, height: 20, status: "sealed" }] } });
  const originalFetch = globalThis.fetch;
  const uploads: { url: string; init?: RequestInit }[] = [];
  globalThis.fetch = (async (input: string | URL | Request, init?: RequestInit) => { uploads.push({ url: String(input), init }); return new Response(null, { status: 200 }); }) as typeof fetch;
  try {
    await expect(client.uploadConversationAttachments(context, serverConversation.key, "request", [{ clientKey: "local-1", kind: "image", filename: "photo.png", mimeType: "image/png", sizeBytes: 4, uri: "bytes:4" }])).resolves.toMatchObject({ attachmentKeys: ["attachment-1"] });
  } finally { globalThis.fetch = originalFetch; }
  expect(calls.map(({ path }) => path)).toEqual([presignPath, completePath]);
  expect(calls[0]?.body).toEqual({ organizationKey: "org", scopeKey: "scope", requestKey: "request", files: [{ clientKey: "local-1", filename: "photo.png", mimeType: "image/png", sizeBytes: 4 }] });
  expect(calls[1]?.body).toEqual({ organizationKey: "org", scopeKey: "scope", requestKey: "request", attachmentKeys: ["attachment-1"] });
  expect(uploads).toHaveLength(1);
  expect(uploads[0]).toMatchObject({ url: "https://uploads.example/attachment", init: { method: "PUT", headers: { "Content-Type": "image/png" } } });
});

test("compares mutable full identities for stale async guards", () => {
  const identity = client.conversationContextIdentity(context);
  const reference = { current: identity };
  expect(client.isConversationContextCurrent(identity, reference)).toBe(true);
  reference.current = client.conversationContextIdentity({ ...context, scopeKey: "other" });
  expect(client.isConversationContextCurrent(identity, reference)).toBe(false);
});
