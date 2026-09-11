import { describe, expect, test } from "bun:test";
import { isPushPermissionAllowed, signalThreadPushDataSchema } from "./notification-policy";

describe("notification policies", () => {
  test("accepts granted and approved iOS permission states only", () => {
    const approved = ["authorized", "provisional", "ephemeral"];
    expect(isPushPermissionAllowed(true, "denied", approved)).toBe(true);
    for (const status of approved) expect(isPushPermissionAllowed(false, status, approved)).toBe(true);
    expect(isPushPermissionAllowed(false, "denied", approved)).toBe(false);
    expect(isPushPermissionAllowed(false, undefined, approved)).toBe(false);
  });

  test("accepts only the strict versioned Signal thread payload", () => {
    const valid = { v: "2", target: "signal-inbox", notificationKey: "notification-1", signalThreadKey: "thread-1", signalMessageKey: "message-1" };
    expect(signalThreadPushDataSchema.parse(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, v: "1" },
      { ...valid, target: "profile" },
      { ...valid, signalThreadKey: "" },
      { ...valid, extra: true },
      { target: "signal-inbox", notificationKey: "notification-1", signalThreadKey: "thread-1", signalMessageKey: "message-1" },
      null,
    ]) expect(signalThreadPushDataSchema.safeParse(invalid).success).toBe(false);
  });
});
