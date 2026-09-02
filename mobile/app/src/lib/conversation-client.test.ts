import { beforeEach, describe, expect, mock, test } from "bun:test";
import { subscribeUserSearchHistoryAppends } from "./user-search-history-events";

const calls: { method: string; path: string; body?: unknown; config?: unknown }[] = [];
const timestamp = "2026-09-01T10:00:00.000Z";
const serverConversation = { key: "conversation-key", organizationKey: "org", scopeKey: "scope", userKey: "user", name: "Planning", isFavorite: false, createdAt: timestamp, updatedAt: timestamp };
const retrieval = { query: "roadmap", limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: "documents", results: [{ key: "document-key", label: "Roadmap" }] }] };
const serverMessage = { key: "assistant-key", conversationKey: serverConversation.key, turnKey: "request", role: "ASSISTANT", status: "COMPLETED", content: "Answer", retrievals: [retrieval], createdAt: timestamp, completedAt: timestamp };
let response: unknown;

mock.module("./api-client", () => ({
  apiClient: {
    post: async (path: string, body: unknown, config?: unknown) => { calls.push({ method: "POST", path, body, config }); return { data: response }; },
    patch: async (path: string, body: unknown, config?: unknown) => { calls.push({ method: "PATCH", path, body, config }); return { data: response }; },
    delete: async (path: string, config?: unknown) => { calls.push({ method: "DELETE", path, config }); return { data: response }; },
  },
}));
const client = await import("./conversation-client");
const context = { userKey: "user", organizationKey: "org", scopeKey: "scope" };
const start = { event: "start", id: "correlation", data: JSON.stringify({ type: "start", correlationKey: "correlation", conversationKey: serverConversation.key, userMessageKey: "user-message", assistantMessageKey: "assistant-key" }) };
const delta = { event: "delta", id: "correlation", data: JSON.stringify({ type: "delta", correlationKey: "correlation", assistantMessageKey: "assistant-key", text: "Ans" }) };
const done = { event: "done", id: "correlation", data: JSON.stringify({ type: "done", correlationKey: "correlation", conversationKey: serverConversation.key, message: serverMessage, name: "Named", replayed: false }) };

beforeEach(() => { calls.length = 0; response = undefined; });

test("strictly parses owner-projected conversations and retains safe-message lifecycle fields", () => {
  expect(client.conversationSchema.parse(serverConversation)).toEqual({ key: serverConversation.key, name: "Planning", isFavorite: false, createdAt: timestamp, updatedAt: timestamp });
  expect(client.conversationMessageSchema.parse(serverMessage)).toEqual({ key: "assistant-key", conversationKey: serverConversation.key, turnKey: "request", role: "assistant", status: "COMPLETED", content: "Answer", retrievals: [retrieval], createdAt: timestamp, completedAt: timestamp });
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
  expect(calls.map(({ method, path }) => `${method} ${path}`)).toEqual(["POST /conversations", `PATCH /conversations/${serverConversation.key}`, `POST /conversations/${serverConversation.key}/favorite`, `DELETE /conversations/${serverConversation.key}`]);
  for (const call of calls) expect(call.config).toMatchObject({ signal: controller.signal });
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

test("compares mutable full identities for stale async guards", () => {
  const identity = client.conversationContextIdentity(context);
  const reference = { current: identity };
  expect(client.isConversationContextCurrent(identity, reference)).toBe(true);
  reference.current = client.conversationContextIdentity({ ...context, scopeKey: "other" });
  expect(client.isConversationContextCurrent(identity, reference)).toBe(false);
});
