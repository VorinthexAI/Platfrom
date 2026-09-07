import { z } from "zod";

export const notificationHubDataSchema = z.strictObject({
  v: z.literal("1"),
  target: z.literal("notification-hub"),
  notificationKey: z.string().min(1),
});

export function isPushPermissionAllowed(granted: boolean, iosStatus: unknown, allowedIosStatuses: readonly unknown[]) {
  return granted || allowedIosStatuses.includes(iosStatus);
}
