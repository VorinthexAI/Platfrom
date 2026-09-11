import { z } from "zod";

export const signalThreadPushDataSchema = z.strictObject({
  v: z.literal("2"),
  target: z.literal("signal-inbox"),
  notificationKey: z.string().min(1),
  signalThreadKey: z.string().min(1),
  signalMessageKey: z.string().min(1),
});

export function isPushPermissionAllowed(granted: boolean, iosStatus: unknown, allowedIosStatuses: readonly unknown[]) {
  return granted || allowedIosStatuses.includes(iosStatus);
}
