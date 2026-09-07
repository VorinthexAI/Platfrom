import { z } from "zod";

import { apiClient } from "./api-client";

const notificationItemSchema = z.strictObject({
  key: z.string().min(1),
  title: z.string().min(1).max(100),
  message: z.string().min(1).max(1_000),
  scopeKey: z.string().min(1),
  isRead: z.boolean(),
  readAt: z.string().datetime().nullable(),
  createdAt: z.string().datetime(),
});

const notificationListResponseSchema = z.strictObject({
  success: z.literal(true),
  data: z.strictObject({
    items: z.array(notificationItemSchema),
    unreadCount: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  }),
});

export type NotificationItem = z.infer<typeof notificationItemSchema>;
export type NotificationList = z.infer<typeof notificationListResponseSchema>["data"];

export const notificationQueryKey = (userKey: string, teamKey: string) => ["notifications", userKey, teamKey] as const;

export async function listNotifications(input: { teamKey: string; scopeKey: string; markRead?: boolean; limit?: number }): Promise<NotificationList> {
  const response = await apiClient.post("/auth/me/notifications", { teamKey: input.teamKey, scopeKey: input.scopeKey, markRead: input.markRead ?? false, limit: input.limit ?? 50 });
  return notificationListResponseSchema.parse(response.data).data;
}
