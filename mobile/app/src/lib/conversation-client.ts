import { z } from "zod";

import { apiClient } from "./api-client";
import * as apiTransport from "./api-client";
import { publishUserSearchHistoryAppend } from "./user-search-history-events";
import type { ServerSentEvent } from "./sse";

export const CONVERSATION_PAGE_SIZE = 25;
export const CONVERSATION_MESSAGE_PAGE_SIZE = 10;
export const CONVERSATION_NAME_MAX_LENGTH = 200;
export const CONVERSATION_MESSAGE_MAX_LENGTH = 20_000;

export const conversationContextSchema = z.strictObject({
  userKey: z.string().min(1),
  organizationKey: z.string().min(1),
  scopeKey: z.string().min(1),
});
export type ConversationContext = z.infer<typeof conversationContextSchema>;

export function conversationContextIdentity(context: ConversationContext) {
  return `${context.userKey}:${context.organizationKey}:${context.scopeKey}`;
}

export function isConversationContextCurrent(capturedIdentity: string, currentIdentity: { current: string }) {
  return capturedIdentity === currentIdentity.current;
}

export const conversationSchema = z.strictObject({
  key: z.string().min(1),
  organizationKey: z.string().min(1),
  scopeKey: z.string().min(1),
  userKey: z.string().min(1),
  name: z.string().min(1).max(CONVERSATION_NAME_MAX_LENGTH),
  isFavorite: z.boolean(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).transform(({ organizationKey: _organizationKey, scopeKey: _scopeKey, userKey: _userKey, ...conversation }) => conversation);
export type Conversation = z.infer<typeof conversationSchema>;

export const conversationRetrievalCollectionSlugSchema = z.enum(["folders", "documents", "files", "collections", "images", "inboxes", "email-tones", "email-messages", "email-drafts", "places", "trips", "countries", "books"]);
export const conversationRetrievalFiltersSchema = z.strictObject({
  folderKey: z.string().cuid().optional(),
  includeDescendants: z.boolean().optional(),
  collectionKey: z.string().cuid().optional(),
  connectorKey: z.string().cuid().optional(),
  readState: z.enum(["read", "unread"]).optional(),
  emailFacets: z.array(z.enum(["urgent", "important", "filtered", "favorite"])).max(4).optional(),
});
export const conversationRetrievalSchema = z.strictObject({
  query: z.string().trim().min(1).max(500),
  limit: z.number().int().min(1).max(50),
  minimumScore: z.number().min(-1).max(1),
  filters: conversationRetrievalFiltersSchema.optional(),
  groups: z.array(z.strictObject({
    collectionSlug: conversationRetrievalCollectionSlugSchema,
    results: z.array(z.strictObject({ key: z.string().trim().min(1).max(255), label: z.string().trim().min(1).max(200), destinationKey: z.string().trim().min(1).max(255).optional() })).min(1).max(50),
  })).min(1).max(10),
}).refine(({ groups }) => groups.reduce((count, group) => count + group.results.length, 0) <= 100, "Retrievals may contain at most 100 results.");
export type ConversationRetrieval = z.infer<typeof conversationRetrievalSchema>;
export type ConversationRetrievalCollectionSlug = z.infer<typeof conversationRetrievalCollectionSlugSchema>;

const serverConversationMessageSchema = z.strictObject({
  key: z.string().min(1),
  conversationKey: z.string().min(1),
  turnKey: z.string().min(1),
  role: z.enum(["USER", "ASSISTANT"]),
  status: z.enum(["PENDING", "COMPLETED", "FAILED"]),
  content: z.string().min(1).max(100_000),
  retrievals: z.array(conversationRetrievalSchema).max(4),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
}).transform(({ role, ...message }) => ({ ...message, role: role === "USER" ? "user" as const : "assistant" as const }));
export const conversationMessageSchema = serverConversationMessageSchema;
export type ConversationMessage = z.infer<typeof conversationMessageSchema>;

const cursorSchema = z.string().min(1).nullable().optional();
export const conversationPageSchema = z.strictObject({ items: z.array(conversationSchema), nextCursor: cursorSchema })
  .transform(({ items, nextCursor }) => ({ conversations: items, cursor: nextCursor }));
export const conversationMessagePageSchema = z.strictObject({ items: z.array(serverConversationMessageSchema).max(CONVERSATION_MESSAGE_PAGE_SIZE), nextCursor: cursorSchema })
  .transform(({ items, nextCursor }) => ({ messages: items, cursor: nextCursor }));
export type ConversationPage = z.infer<typeof conversationPageSchema>;
export type ConversationMessagePage = z.infer<typeof conversationMessagePageSchema>;

const conversationEnvelope = <T extends z.ZodTypeAny>(schema: T) => z.union([schema, z.strictObject({ success: z.literal(true), data: schema })]);
function unwrap<T>(value: T | { success: true; data: T }): T { return typeof value === "object" && value !== null && "success" in value ? value.data : value; }
function selectors(context: ConversationContext) { const { organizationKey, scopeKey } = conversationContextSchema.parse(context); return { organizationKey, scopeKey }; }

export type ConversationListInput = { cursor?: string; query?: string; favoriteOnly?: boolean; recordHistory?: boolean };

export async function listConversations(context: ConversationContext, input: ConversationListInput = {}, signal?: AbortSignal) {
  const parsed = z.strictObject({
    cursor: z.string().min(1).max(1_000).optional(),
    query: z.string().trim().min(1).max(500).optional(),
    favoriteOnly: z.boolean().default(false),
    recordHistory: z.boolean().default(false),
  }).parse(input);
  const path = parsed.query ? "/conversations/search" : "/conversations/list";
  const body = parsed.query
    ? { ...selectors(context), query: parsed.query, favoriteOnly: parsed.favoriteOnly, recordHistory: parsed.recordHistory, ...(parsed.cursor ? { cursor: parsed.cursor } : {}), limit: CONVERSATION_PAGE_SIZE }
    : { ...selectors(context), favoriteOnly: parsed.favoriteOnly, ...(parsed.cursor ? { cursor: parsed.cursor } : {}), limit: CONVERSATION_PAGE_SIZE };
  const response = await apiClient.post(path, body, { signal });
  const page = unwrap(conversationEnvelope(conversationPageSchema).parse(response.data));
  if (parsed.query && parsed.recordHistory) publishUserSearchHistoryAppend(context.userKey);
  return page;
}

export async function listConversationMessages(context: ConversationContext, conversationKey: string, cursor?: string, signal?: AbortSignal) {
  const key = z.string().min(1).parse(conversationKey);
  const parsedCursor = z.string().min(1).max(1_000).optional().parse(cursor);
  const response = await apiClient.post(`/conversations/${encodeURIComponent(key)}/messages/list`, { ...selectors(context), ...(parsedCursor ? { cursor: parsedCursor } : {}), limit: CONVERSATION_MESSAGE_PAGE_SIZE }, { signal });
  return unwrap(conversationEnvelope(conversationMessagePageSchema).parse(response.data));
}

export async function createConversation(context: ConversationContext, name = "New chat", signal?: AbortSignal) {
  const body = z.strictObject({ organizationKey: z.string().min(1), scopeKey: z.string().min(1), name: z.string().trim().min(1).max(CONVERSATION_NAME_MAX_LENGTH).optional() }).parse({ ...selectors(context), name });
  return unwrap(conversationEnvelope(conversationSchema).parse((await apiClient.post("/conversations", body, { signal })).data));
}

export async function updateConversation(context: ConversationContext, conversationKey: string, patch: { name?: string; isFavorite?: boolean }, signal?: AbortSignal) {
  const key = z.string().min(1).parse(conversationKey);
  const body = z.strictObject({ organizationKey: z.string().min(1), scopeKey: z.string().min(1), name: z.string().trim().min(1).max(CONVERSATION_NAME_MAX_LENGTH).optional(), isFavorite: z.boolean().optional() })
    .refine(({ name, isFavorite }) => name !== undefined || isFavorite !== undefined, "A conversation change is required.").parse({ ...selectors(context), ...patch });
  const response = patch.name !== undefined ? await apiClient.patch(`/conversations/${encodeURIComponent(key)}`, body, { signal }) : await apiClient.post(`/conversations/${encodeURIComponent(key)}/favorite`, body, { signal });
  return unwrap(conversationEnvelope(conversationSchema).parse(response.data));
}

export async function deleteConversation(context: ConversationContext, conversationKey: string, signal?: AbortSignal) {
  const key = z.string().min(1).parse(conversationKey);
  const response = await apiClient.delete(`/conversations/${encodeURIComponent(key)}`, { data: selectors(context), signal });
  return unwrap(conversationEnvelope(z.strictObject({ deletedKey: z.string().min(1) })).parse(response.data));
}

export const conversationTurnEventSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("start"), correlationKey: z.string().min(1), conversationKey: z.string().min(1), userMessageKey: z.string().min(1), assistantMessageKey: z.string().min(1) }),
  z.strictObject({ type: z.literal("delta"), correlationKey: z.string().min(1), assistantMessageKey: z.string().min(1), text: z.string().min(1) }),
  z.strictObject({ type: z.literal("done"), correlationKey: z.string().min(1), conversationKey: z.string().min(1), message: serverConversationMessageSchema, name: z.string().trim().min(1).max(CONVERSATION_NAME_MAX_LENGTH).optional(), replayed: z.boolean() }),
  z.strictObject({ type: z.literal("error"), correlationKey: z.string().min(1), message: z.string().min(1), code: z.string().min(1) }),
]);
export type ConversationTurnEvent = z.infer<typeof conversationTurnEventSchema>;

export function parseConversationTurnEvent(event: ServerSentEvent) {
  if (!(["start", "delta", "done", "error"] as const).includes(event.event as ConversationTurnEvent["type"])) throw new Error(`Unknown conversation stream event: ${event.event}.`);
  const data: unknown = JSON.parse(event.data);
  return conversationTurnEventSchema.parse({ ...(typeof data === "object" && data !== null ? data : {}), type: event.event });
}

export type ConversationEventTransport = (path: string, body: unknown, onEvent: (event: ServerSentEvent) => void, signal?: AbortSignal) => Promise<void>;

export async function streamConversationTurnWithTransport(transport: ConversationEventTransport, context: ConversationContext, input: { conversationKey: string; message: string; requestKey: string }, onEvent: (event: ConversationTurnEvent) => void, signal?: AbortSignal) {
  const body = z.strictObject({ organizationKey: z.string().min(1), scopeKey: z.string().min(1), conversationKey: z.string().min(1), message: z.string().trim().min(1).max(CONVERSATION_MESSAGE_MAX_LENGTH), requestKey: z.string().min(1).max(180) }).parse({ ...selectors(context), ...input });
  const { conversationKey, ...request } = body;
  let started: Extract<ConversationTurnEvent, { type: "start" }> | undefined;
  let terminal: Extract<ConversationTurnEvent, { type: "done" | "error" }> | undefined;
  await transport(`/conversations/${encodeURIComponent(conversationKey)}/turn/stream`, request, (frame) => {
    if (terminal) throw new Error("Conversation stream emitted after its terminal event.");
    const event = parseConversationTurnEvent(frame);
    if (frame.id && frame.id !== event.correlationKey) throw new Error("Conversation stream event id did not match its correlation key.");
    if (event.type === "start") {
      if (started) throw new Error("Conversation stream emitted more than one start event.");
      if (event.conversationKey !== conversationKey) throw new Error("Conversation stream started for a different conversation.");
      started = event;
    } else if (event.type === "delta") {
      if (!started) throw new Error("Conversation stream emitted a delta before start.");
      if (event.correlationKey !== started.correlationKey || event.assistantMessageKey !== started.assistantMessageKey) throw new Error("Conversation stream delta did not match the active turn.");
    } else if (event.type === "done") {
      if (!started) throw new Error("Conversation stream completed before start.");
      if (event.correlationKey !== started.correlationKey || event.conversationKey !== conversationKey || event.message.key !== started.assistantMessageKey || event.message.conversationKey !== conversationKey) throw new Error("Conversation stream completion did not match the active turn.");
      if (event.message.status !== "COMPLETED") throw new Error("Conversation stream completed with a non-completed message.");
      terminal = event;
    } else {
      if (started) {
        if (event.correlationKey !== started.correlationKey) throw new Error("Conversation stream error did not match the active turn.");
      } else if (event.correlationKey !== input.requestKey) {
        throw new Error("Conversation stream error did not match the requested turn.");
      }
      terminal = event;
    }
    onEvent(event);
  }, signal);
  if (!terminal) throw new Error("Conversation stream ended before a terminal event.");
  if (terminal.type === "error") throw Object.assign(new Error(terminal.message), { code: terminal.code });
}

export function streamConversationTurn(context: ConversationContext, input: { conversationKey: string; message: string; requestKey: string }, onEvent: (event: ConversationTurnEvent) => void, signal?: AbortSignal) {
  return streamConversationTurnWithTransport(apiTransport.postEventStream, context, input, onEvent, signal);
}
