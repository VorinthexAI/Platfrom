import { isAxiosError } from "axios";
import { z } from "zod";

import { apiClient } from "./api-client";
import * as apiTransport from "./api-client";
import { publishUserSearchHistoryAppend } from "./user-search-history-events";
import type { ServerSentEvent } from "./sse";

export const CONVERSATION_PAGE_SIZE = 25;
export const CONVERSATION_MESSAGE_PAGE_SIZE = 10;
export const CONVERSATION_NAME_MAX_LENGTH = 200;
export const CONVERSATION_MESSAGE_MAX_LENGTH = 20_000;
export const CONVERSATION_IMAGE_PROMPT_MAX_LENGTH = 8_000;
export const CONVERSATION_ATTACHMENT_MAX_FILES = 10;
export const CONVERSATION_ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;

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

export function isConversationNotFoundError(error: unknown) {
  return isAxiosError(error) && error.response?.status === 404;
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
  createdFrom: z.string().datetime().optional(),
  createdTo: z.string().datetime().optional(),
});
export const conversationRetrievalSchema = z.strictObject({
  query: z.string().trim().max(500).optional(),
  limit: z.number().int().min(1).max(50),
  minimumScore: z.number().min(-1).max(1).optional(),
  filters: conversationRetrievalFiltersSchema.optional(),
  searchCollectionSlugs: z.array(conversationRetrievalCollectionSlugSchema).min(1).max(10).optional(),
  source: z.enum(["search", "results"]).optional(),
  groups: z.array(z.strictObject({
    collectionSlug: conversationRetrievalCollectionSlugSchema,
    results: z.array(z.strictObject({ key: z.string().trim().min(1).max(255), label: z.string().trim().min(1).max(200), destinationKey: z.string().trim().min(1).max(255).optional(), destinationCollectionSlug: conversationRetrievalCollectionSlugSchema.optional() })).min(1).max(50),
  })).min(1).max(conversationRetrievalCollectionSlugSchema.options.length),
}).refine(({ groups }) => groups.reduce((count, group) => count + group.results.length, 0) <= 100, "Retrievals may contain at most 100 results.")
  .refine(({ query, source }) => source === "results" || Boolean(query && query.length >= 1), "Search retrievals require a query.");
export type ConversationRetrieval = z.infer<typeof conversationRetrievalSchema>;
export type ConversationRetrievalCollectionSlug = z.infer<typeof conversationRetrievalCollectionSlugSchema>;

const serverConversationMessageSchema = z.strictObject({
  key: z.string().min(1),
  conversationKey: z.string().min(1),
  turnKey: z.string().min(1),
  type: z.enum(["TEXT", "IMAGE"]),
  role: z.enum(["USER", "ASSISTANT"]),
  status: z.enum(["PENDING", "COMPLETED", "FAILED"]),
  content: z.string().min(1).max(100_000),
  imageKey: z.string().cuid().optional(),
  retrievals: z.array(conversationRetrievalSchema).max(4),
  createdAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
}).superRefine((message, context) => {
  if (message.role === "USER" && (message.status !== "COMPLETED" || !message.completedAt)) context.addIssue({ code: "custom", path: ["status"], message: "User messages must be completed." });
  if (message.status === "PENDING" && message.completedAt) context.addIssue({ code: "custom", path: ["completedAt"], message: "Pending messages cannot have a completion time." });
  if (message.status !== "PENDING" && !message.completedAt) context.addIssue({ code: "custom", path: ["completedAt"], message: "Terminal messages require a completion time." });
  if (message.type === "TEXT" && message.imageKey) context.addIssue({ code: "custom", path: ["imageKey"], message: "Text messages cannot reference an image." });
  if (message.type === "IMAGE" && message.role === "USER" && message.imageKey) context.addIssue({ code: "custom", path: ["imageKey"], message: "Image prompts cannot reference their generated image." });
  if (message.type === "IMAGE" && message.role === "ASSISTANT" && (message.status === "COMPLETED") !== Boolean(message.imageKey)) context.addIssue({ code: "custom", path: ["imageKey"], message: "Only completed image responses require an image reference." });
  if (message.type === "IMAGE" && message.retrievals.length) context.addIssue({ code: "custom", path: ["retrievals"], message: "Image messages cannot have retrievals." });
}).transform(({ role, type, ...message }) => ({ ...message, kind: type === "IMAGE" ? "image" as const : "text" as const, role: role === "USER" ? "user" as const : "assistant" as const }));
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

const attachmentFileSchema = z.strictObject({
  clientKey: z.string().trim().min(1).max(120),
  kind: z.enum(["image", "document"]),
  filename: z.string().trim().min(1).max(255),
  mimeType: z.enum(["image/jpeg", "image/png", "image/webp", "text/plain", "text/markdown", "text/x-markdown", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]),
  sizeBytes: z.number().int().positive().max(CONVERSATION_ATTACHMENT_MAX_BYTES),
  uri: z.string().min(1),
});
export type ConversationAttachmentFile = z.infer<typeof attachmentFileSchema>;
const attachmentUploadSchema = z.strictObject({ clientKey: z.string().min(1), attachmentKey: z.string().min(1), url: z.string().url(), headers: z.record(z.string(), z.string()), expiresAt: z.string().datetime() });
const attachmentDescriptorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ attachmentKey: z.string().min(1), kind: z.literal("image"), filename: z.string().min(1), mimeType: z.literal("image/png"), sizeBytes: z.number().int().positive(), width: z.number().int().positive(), height: z.number().int().positive(), status: z.literal("sealed") }),
  z.strictObject({ attachmentKey: z.string().min(1), kind: z.literal("document"), filename: z.string().min(1), mimeType: z.string().min(1), sizeBytes: z.number().int().positive(), extractedCharacters: z.number().int().nonnegative(), status: z.literal("sealed") }),
]);

export async function uploadConversationAttachments(context: ConversationContext, conversationKey: string, requestKey: string, rawFiles: ConversationAttachmentFile[], signal?: AbortSignal) {
  const files = z.array(attachmentFileSchema).min(1).max(CONVERSATION_ATTACHMENT_MAX_FILES).refine((items) => new Set(items.map(({ clientKey }) => clientKey)).size === items.length, "Attachment client keys must be unique.").parse(rawFiles);
  const key = z.string().min(1).parse(conversationKey);
  const request = z.string().trim().min(1).max(180).parse(requestKey);
  const reservationResponse = await apiClient.post(`/conversations/${encodeURIComponent(key)}/attachments/uploads/presign`, { ...selectors(context), requestKey: request, files: files.map(({ uri: _uri, kind: _kind, ...file }) => file) }, { signal });
  const reservation = unwrap(conversationEnvelope(z.strictObject({ uploads: z.array(attachmentUploadSchema).min(1).max(CONVERSATION_ATTACHMENT_MAX_FILES) })).parse(reservationResponse.data));
  await Promise.all(reservation.uploads.map(async (upload) => {
    const file = files.find(({ clientKey }) => clientKey === upload.clientKey);
    if (!file) throw new Error("An attachment upload reservation could not be matched.");
    const bytes = await new (await import("expo-file-system")).File(file.uri).arrayBuffer();
    if (bytes.byteLength !== file.sizeBytes) throw new Error("An attachment changed before it could be uploaded.");
    const response = await fetch(upload.url, { method: "PUT", headers: upload.headers, body: bytes, signal });
    if (!response.ok) throw new Error(`Attachment upload failed (${response.status}).`);
  }));
  const attachmentKeys = reservation.uploads.map(({ attachmentKey }) => attachmentKey);
  const completionResponse = await apiClient.post(`/conversations/${encodeURIComponent(key)}/attachments/uploads/complete`, { ...selectors(context), requestKey: request, attachmentKeys }, { signal, timeout: 2 * 60_000 });
  const completed = unwrap(conversationEnvelope(z.strictObject({ attachments: z.array(attachmentDescriptorSchema).length(attachmentKeys.length) })).parse(completionResponse.data));
  return { attachmentKeys: completed.attachments.map(({ attachmentKey }) => attachmentKey), attachments: completed.attachments };
}

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

export async function deleteConversationMessage(context: ConversationContext, conversationKey: string, messageKey: string, signal?: AbortSignal) {
  const keys = z.strictObject({ conversationKey: z.string().min(1), messageKey: z.string().min(1) }).parse({ conversationKey, messageKey });
  const response = await apiClient.delete(`/conversations/${encodeURIComponent(keys.conversationKey)}/messages/${encodeURIComponent(keys.messageKey)}`, { data: selectors(context), signal });
  return unwrap(conversationEnvelope(z.strictObject({ deletedKeys: z.array(z.string().min(1)).min(1).max(2) })).parse(response.data));
}

const conversationImageTurnResultSchema = z.strictObject({
  user: serverConversationMessageSchema,
  assistant: serverConversationMessageSchema,
  replayed: z.boolean(),
});

export async function enqueueConversationImageTurn(context: ConversationContext, input: { conversationKey: string; prompt: string; requestKey: string }, signal?: AbortSignal) {
  const parsed = z.strictObject({ conversationKey: z.string().min(1), prompt: z.string().trim().min(1).max(CONVERSATION_IMAGE_PROMPT_MAX_LENGTH), requestKey: z.string().trim().min(1).max(180) }).parse(input);
  const { conversationKey, ...turn } = parsed;
  const response = await apiClient.post(`/conversations/${encodeURIComponent(conversationKey)}/image-turns`, {
    ...selectors(context),
    ...turn,
    referenceImageKeys: [],
    size: "1024x1024",
    quality: "medium",
    mode: "default",
  }, { signal });
  return unwrap(conversationEnvelope(conversationImageTurnResultSchema).parse(response.data));
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

export async function streamConversationTurnWithTransport(transport: ConversationEventTransport, context: ConversationContext, input: { conversationKey: string; message: string; requestKey: string; attachmentKeys?: string[]; referenceImageKeys?: string[] }, onEvent: (event: ConversationTurnEvent) => void, signal?: AbortSignal) {
  const body = z.strictObject({ organizationKey: z.string().min(1), scopeKey: z.string().min(1), conversationKey: z.string().min(1), message: z.string().trim().min(1).max(CONVERSATION_MESSAGE_MAX_LENGTH), requestKey: z.string().min(1).max(180), attachmentKeys: z.array(z.string().min(1)).max(CONVERSATION_ATTACHMENT_MAX_FILES).default([]), referenceImageKeys: z.array(z.string().min(1)).max(1).default([]) }).parse({ ...selectors(context), ...input });
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
      const imageTurn = event.message.kind === "image" && event.message.role === "assistant";
      if (event.correlationKey !== started.correlationKey || event.conversationKey !== conversationKey || (!imageTurn && event.message.key !== started.assistantMessageKey) || event.message.conversationKey !== conversationKey) throw new Error("Conversation stream completion did not match the active turn.");
      if (event.message.status !== "COMPLETED" && !(imageTurn && event.message.status === "PENDING")) throw new Error("Conversation stream completed with a non-completed message.");
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

export function streamConversationTurn(context: ConversationContext, input: { conversationKey: string; message: string; requestKey: string; attachmentKeys?: string[]; referenceImageKeys?: string[] }, onEvent: (event: ConversationTurnEvent) => void, signal?: AbortSignal) {
  return streamConversationTurnWithTransport(apiTransport.postEventStream, context, input, onEvent, signal);
}
