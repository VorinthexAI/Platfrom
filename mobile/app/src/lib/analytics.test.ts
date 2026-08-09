import { expect, test } from "bun:test";
import { buildAppOpenedEvent, buildOnboardingEvent } from "./analytics-events";

test("builds strict app-prefixed lifecycle events", () => {
  const distinctId = "app_12345678-1234-4234-9234-123456789012";
  expect(buildAppOpenedEvent("evt_12345678-1234-4234-9234-123456789012", distinctId)).toEqual({
    slug: "app.opened",
    eventId: "evt_12345678-1234-4234-9234-123456789012",
    distinctId,
  });
  expect(buildOnboardingEvent(distinctId, "evt_onboarding_12345678_2", 2, "Gallery", "skipped")).toEqual({
    slug: "app.onboarding",
    eventId: "evt_onboarding_12345678_2",
    distinctId,
    step: 2,
    coreAppName: "Gallery",
    enabled: false,
    skipped: true,
  });
});
