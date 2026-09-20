import { z } from "zod";

import { apiClient } from "./api-client";
import { appSearchResults, searchApp } from "./app-search-client";

export const MANAGED_INBOX_PAGE_SIZE = 10;
const keySchema = z.string().trim().min(1).max(200);
const dateSchema = z.iso.datetime();

export const communicationTabSchema = z.enum(["unread", "read", "sent"]);
export type CommunicationTab = z.infer<typeof communicationTabSchema>;
export const communicationReadStateSchema = z.enum(["read", "unread"]);
export type CommunicationReadState = z.infer<typeof communicationReadStateSchema>;

export const communicationThreadSchema = z.strictObject({
  key: keySchema,
  kind: z.enum(["notification", "issue", "feedback"]),
  subject: z.string().trim().min(1).max(8_000),
  preview: z.string().trim().min(1).max(8_000),
  isRead: z.boolean(),
  updatedAt: dateSchema,
});

const notificationSchema = z.strictObject({
  key: keySchema,
  title: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1).max(1_000),
  isRead: z.boolean(),
  createdAt: dateSchema,
});
const ticketSchema = z.strictObject({
  key: keySchema,
  message: z.string().trim().min(1).max(8_000),
  kind: z.enum(["issue", "feedback"]),
  createdAt: dateSchema,
});
const listResponseSchema = z.strictObject({
  success: z.literal(true),
  data: z.strictObject({
    items: z.array(z.unknown()),
    nextCursor: keySchema.nullable(),
  }),
});

export type CommunicationThread = z.infer<typeof communicationThreadSchema>;
export type CommunicationContext = Readonly<{ userKey: string; teamKey: string; scopeKey: string }>;

const contextKey = (context: CommunicationContext) => [context.userKey, context.teamKey, context.scopeKey] as const;

function requestContext(context: CommunicationContext) {
  return { teamKey: keySchema.parse(context.teamKey), scopeKey: keySchema.parse(context.scopeKey) };
}

function fromNotification(item: z.infer<typeof notificationSchema>): CommunicationThread {
  return communicationThreadSchema.parse({ key: item.key, kind: "notification", subject: item.title, preview: item.message, isRead: item.isRead, updatedAt: item.createdAt });
}

function fromTicket(item: z.infer<typeof ticketSchema>): CommunicationThread {
  return communicationThreadSchema.parse({ key: item.key, kind: item.kind, subject: item.kind === "feedback" ? "Product feedback" : "Support issue", preview: item.message, isRead: true, updatedAt: item.createdAt });
}

export const communicationQueryKeys = {
  all: (context: CommunicationContext) => ["communication", ...contextKey(context)] as const,
  lists: (context: CommunicationContext) => [...communicationQueryKeys.all(context), "lists"] as const,
  list: (context: CommunicationContext, tab: CommunicationTab, query = "") => [...communicationQueryKeys.lists(context), tab, query] as const,
};

export async function listCommunicationThreads(rawInput: { tab: CommunicationTab; cursor?: string; limit?: number; query?: string }, context: CommunicationContext) {
  const tab = communicationTabSchema.parse(rawInput.tab);
  const query = rawInput.query?.trim() ?? "";
  if (query) {
    const collectionSlug = tab === "sent" ? "tickets" : "notifications";
    const output = await searchApp({
      query,
      collectionSlugs: [collectionSlug],
      limit: rawInput.limit ?? MANAGED_INBOX_PAGE_SIZE,
      recordHistory: true,
      ...(tab === "sent" ? {} : { filters: { readState: tab } }),
    });
    const items = tab === "sent"
      ? appSearchResults(output, "tickets", ticketSchema.extend({ score: z.number().optional() }).strip()).map(({ score: _score, ...item }) => fromTicket(item))
      : appSearchResults(output, "notifications", notificationSchema.extend({ score: z.number().optional() }).strip()).map(({ score: _score, ...item }) => fromNotification(item));
    return { items, nextCursor: null as string | null };
  }
  if (tab === "sent") {
    const response = await apiClient.post("/tickets/list", { ...requestContext(context), limit: rawInput.limit ?? MANAGED_INBOX_PAGE_SIZE, ...(rawInput.cursor ? { cursor: rawInput.cursor } : {}) });
    const data = listResponseSchema.parse(response.data).data;
    return { items: z.array(ticketSchema).parse(data.items).map(fromTicket), nextCursor: data.nextCursor };
  }
  const response = await apiClient.post("/auth/me/notifications", { ...requestContext(context), readState: tab, limit: rawInput.limit ?? MANAGED_INBOX_PAGE_SIZE, ...(rawInput.cursor ? { cursor: rawInput.cursor } : {}) });
  const data = listResponseSchema.parse(response.data).data;
  return { items: z.array(notificationSchema).parse(data.items).map(fromNotification), nextCursor: data.nextCursor };
}

export async function markCommunicationThreadRead(threadKey: string, context: CommunicationContext, read = true) {
  const key = keySchema.parse(threadKey);
  const response = await apiClient.put(`/auth/me/notifications/${encodeURIComponent(key)}/read-state`, { ...requestContext(context), read });
  return fromNotification(z.strictObject({ success: z.literal(true), data: notificationSchema }).parse(response.data).data);
}
