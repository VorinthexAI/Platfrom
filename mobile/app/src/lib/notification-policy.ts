import { z } from "zod";

import { hrefFromDeepLinkUrl, MANAGED_INBOX_DEEP_LINK_HREF } from "./deep-links";

export const pushNotificationDataSchema = z.object({
  v: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  notificationKey: z.string().min(1).optional(),
}).strip();

export function pushNotificationHref(data: z.infer<typeof pushNotificationDataSchema>) {
  return (data.url ? hrefFromDeepLinkUrl(data.url) : undefined) ?? MANAGED_INBOX_DEEP_LINK_HREF;
}

export function isPushPermissionAllowed(granted: boolean, iosStatus: unknown, allowedIosStatuses: readonly unknown[]) {
  return granted || allowedIosStatuses.includes(iosStatus);
}
