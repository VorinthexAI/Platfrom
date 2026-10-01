import { z } from "zod";

import { hrefFromDeepLinkUrl, HOME_HREF } from "./deep-links";

export const pushNotificationDataSchema = z.object({
  v: z.string().min(1).optional(),
  url: z.string().min(1).optional(),
  notificationKey: z.string().min(1).optional(),
}).strip();

export function pushNotificationHref(data: z.infer<typeof pushNotificationDataSchema>) {
  return (data.url ? hrefFromDeepLinkUrl(data.url) : undefined) ?? HOME_HREF;
}

export function isGeneratedFilePush(data: unknown) {
  const parsed = pushNotificationDataSchema.safeParse(data);
  return Boolean(parsed.success && parsed.data.url && String(hrefFromDeepLinkUrl(parsed.data.url)).startsWith('/file?'));
}

export function isPushPermissionAllowed(granted: boolean, iosStatus: unknown, allowedIosStatuses: readonly unknown[]) {
  return granted || allowedIosStatuses.includes(iosStatus);
}
