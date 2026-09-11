import { z } from "zod";

import { apiClient } from "./api-client";

const keySchema = z.string().trim().min(1).max(200);
const dateSchema = z.iso.datetime();

export const communicationTabSchema = z.enum(["inbox", "sent", "drafts"]);
export type CommunicationTab = z.infer<typeof communicationTabSchema>;

export const communicationListInputSchema = z.strictObject({
  tab: communicationTabSchema,
  cursor: keySchema.optional(),
  limit: z.number().int().min(1).max(50).optional(),
});

export const communicationSourceSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.literal("internal"), label: z.string().trim().min(1).max(100) }),
  z.strictObject({ kind: z.literal("external"), connectorKey: keySchema, label: z.string().trim().min(1).max(320) }),
]);

export const communicationThreadSchema = z.strictObject({
  key: keySchema,
  kind: z.enum(["notification", "issue", "feedback", "email"]),
  source: communicationSourceSchema,
  subject: z.string().trim().min(1).max(998),
  preview: z.string().trim().max(2_000),
  isRead: z.boolean(),
  canReply: z.boolean(),
  updatedAt: dateSchema,
});

export const communicationMessageSchema = z.strictObject({
  key: keySchema,
  author: z.enum(["user", "vorinthex", "external"]),
  authorName: z.string().trim().min(1).max(320),
  body: z.string().min(1).max(50_000),
  createdAt: dateSchema,
});

const communicationListResponseSchema = z.strictObject({
  success: z.literal(true),
  data: z.strictObject({
    items: z.array(communicationThreadSchema),
    unreadCount: z.number().int().nonnegative(),
    nextCursor: keySchema.nullable(),
  }),
});

const communicationThreadResponseSchema = z.strictObject({
  success: z.literal(true),
  data: z.strictObject({
    thread: communicationThreadSchema,
    messages: z.array(communicationMessageSchema),
  }),
});

const storedThreadSchema = z.object({
  key: keySchema,
  kind: z.enum(["notification", "issue", "feedback"]),
  subject: z.string().trim().min(1).max(200),
  createdBy: z.enum(["user", "system", "staff"]),
  readAt: dateSchema.nullable(),
  lastMessageAt: dateSchema,
  preview: z.string().max(8_000).optional(),
}).passthrough();
const storedMessageSchema = z.object({ key: keySchema, sender: z.enum(["user", "system", "staff"]), body: z.string().min(1).max(8_000), createdAt: dateSchema }).passthrough();
const storedListResponseSchema = z.object({ success: z.literal(true), data: z.object({ items: z.array(storedThreadSchema), unreadCount: z.number().int().nonnegative(), nextCursor: keySchema.nullable() }).passthrough() }).passthrough();
const storedDetailResponseSchema = z.object({ success: z.literal(true), data: z.object({ thread: storedThreadSchema, messages: z.array(storedMessageSchema) }).passthrough() }).passthrough();

export type CommunicationThread = z.infer<typeof communicationThreadSchema>;
export type CommunicationThreadDetail = z.infer<typeof communicationThreadResponseSchema>["data"];
export type CommunicationContext = Readonly<{ userKey: string; teamKey: string; scopeKey: string }>;

const contextKey = (context: CommunicationContext) => [context.userKey, context.teamKey, context.scopeKey] as const;

function requestContext(context: CommunicationContext) {
  return { teamKey: keySchema.parse(context.teamKey), scopeKey: keySchema.parse(context.scopeKey) };
}

function projectThread(thread: z.infer<typeof storedThreadSchema>): CommunicationThread {
  return communicationThreadSchema.parse({
    key: thread.key,
    kind: thread.kind,
    source: { kind: "internal", label: "Vorinthex" },
    subject: thread.subject,
    preview: thread.preview ?? thread.subject,
    isRead: thread.readAt !== null,
    canReply: thread.kind === "issue" || thread.kind === "feedback",
    updatedAt: thread.lastMessageAt,
  });
}

function projectDetail(data: z.infer<typeof storedDetailResponseSchema>["data"]): CommunicationThreadDetail {
  return communicationThreadResponseSchema.shape.data.parse({
    thread: projectThread(data.thread),
    messages: data.messages.map((message) => ({ key: message.key, author: message.sender === "user" ? "user" : "vorinthex", authorName: message.sender === "user" ? "You" : "Vorinthex", body: message.body, createdAt: message.createdAt })),
  });
}

export const communicationQueryKeys = {
  all: (context: CommunicationContext) => ["communication", ...contextKey(context)] as const,
  lists: (context: CommunicationContext) => [...communicationQueryKeys.all(context), "lists"] as const,
  list: (context: CommunicationContext, tab: CommunicationTab) => [...communicationQueryKeys.lists(context), tab] as const,
  details: (context: CommunicationContext) => [...communicationQueryKeys.all(context), "details"] as const,
  detail: (context: CommunicationContext, threadKey: string) => [...communicationQueryKeys.details(context), threadKey] as const,
};

export async function listCommunicationThreads(rawInput: z.input<typeof communicationListInputSchema>, context: CommunicationContext) {
  const input = communicationListInputSchema.parse(rawInput);
  if (input.tab === "drafts") return communicationListResponseSchema.shape.data.parse({ items: [], unreadCount: 0, nextCursor: null });
  const response = await apiClient.post("/auth/me/communications/list", { ...requestContext(context), mailbox: input.tab, ...(input.cursor ? { cursor: input.cursor } : {}), ...(input.limit ? { limit: input.limit } : {}) });
  const data = storedListResponseSchema.parse(response.data).data;
  return communicationListResponseSchema.shape.data.parse({ items: data.items.map(projectThread), unreadCount: data.unreadCount, nextCursor: data.nextCursor });
}

export async function readCommunicationThread(threadKey: string, context: CommunicationContext) {
  const key = keySchema.parse(threadKey);
  const response = await apiClient.post(`/auth/me/communications/${encodeURIComponent(key)}/read`, requestContext(context));
  return projectDetail(storedDetailResponseSchema.parse(response.data).data);
}

export async function markCommunicationThreadRead(threadKey: string, context: CommunicationContext) {
  const key = keySchema.parse(threadKey);
  await apiClient.put(`/auth/me/communications/${encodeURIComponent(key)}/read-state`, { ...requestContext(context), read: true });
  return readCommunicationThread(key, context);
}

export async function replyToCommunicationThread(threadKey: string, rawMessage: string, idempotencyKey: string, context: CommunicationContext) {
  const key = keySchema.parse(threadKey);
  const message = z.string().trim().min(1).max(8_000).parse(rawMessage);
  const requestKey = keySchema.parse(idempotencyKey);
  await apiClient.post(`/auth/me/communications/${encodeURIComponent(key)}/messages`, { ...requestContext(context), message }, { headers: { "Idempotency-Key": requestKey } });
  return readCommunicationThread(key, context);
}
