import { describe, expect, test } from "bun:test";
import { isPushPermissionAllowed, notificationHubDataSchema } from "./notification-policy";

describe("notification policies", () => {
  test("accepts granted and approved iOS permission states only", () => {
    const approved = ["authorized", "provisional", "ephemeral"];
    expect(isPushPermissionAllowed(true, "denied", approved)).toBe(true);
    for (const status of approved) expect(isPushPermissionAllowed(false, status, approved)).toBe(true);
    expect(isPushPermissionAllowed(false, "denied", approved)).toBe(false);
    expect(isPushPermissionAllowed(false, undefined, approved)).toBe(false);
  });

  test("accepts only the strict versioned notification-hub payload", () => {
    const valid = { v: "1", target: "notification-hub", notificationKey: "notification-1" };
    expect(notificationHubDataSchema.parse(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, v: "2" },
      { ...valid, target: "profile" },
      { ...valid, notificationKey: "" },
      { ...valid, extra: true },
      { target: "notification-hub", notificationKey: "notification-1" },
      null,
    ]) expect(notificationHubDataSchema.safeParse(invalid).success).toBe(false);
  });
});
