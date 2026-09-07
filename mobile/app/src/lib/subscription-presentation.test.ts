import { expect, test } from "bun:test";

import type { CurrentSubscription } from "./billing-client";
import { subscriptionPresentation } from "./subscription-presentation";

const subscription = (status: CurrentSubscription["status"], cancelAtPeriodEnd = false): CurrentSubscription => ({
  key: "c000000000000000000000001",
  userKey: "c000000000000000000000002",
  productKey: "c000000000000000000000003",
  status,
  cancelAtPeriodEnd,
  currentPeriodStart: null,
  currentPeriodEnd: "2026-10-01T00:00:00.000Z",
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-01T00:00:00.000Z",
});

test("only renewable statuses expose cancellation or restoration actions", () => {
  for (const status of ["active", "trialing", "past_due"] as const) {
    expect(subscriptionPresentation(subscription(status), undefined).action).toBe("cancel");
    expect(subscriptionPresentation(subscription(status, true), undefined).action).toBe("restore");
  }
  for (const status of ["canceled", "unpaid", "paused", "incomplete", "incomplete_expired"] as const) {
    const presentation = subscriptionPresentation(subscription(status), undefined);
    expect(presentation.action).toBeNull();
    expect(presentation.copy).not.toContain("Renews automatically");
  }
});

test("does not infer a monthly plan from an unknown product", () => {
  expect(subscriptionPresentation(subscription("canceled"), undefined).title).toBe("Subscription");
});
