import { expect, test } from "bun:test";
import { APP_EVENTS_PATH, buildAppOpenedEvent, buildOnboardingEvent, postAppEvent } from "./analytics-events";

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

test("posts every lifecycle event through the unified endpoint", async () => {
  const distinctId = "app_12345678-1234-4234-9234-123456789012";
  const events = [
    buildAppOpenedEvent("evt_12345678-1234-4234-9234-123456789012", distinctId),
    buildOnboardingEvent(distinctId, "evt_onboarding_12345678_1", 1, "Archive", "enabled"),
  ];
  const requests: { path: string; body: unknown }[] = [];

  for (const event of events) {
    await postAppEvent(event, async (path, body) => { requests.push({ path, body }); });
  }

  expect(requests).toEqual(events.map((body) => ({ path: APP_EVENTS_PATH, body })));
});

test("retries the same event through the unified endpoint", async () => {
  const event = buildAppOpenedEvent(
    "evt_12345678-1234-4234-9234-123456789012",
    "app_12345678-1234-4234-9234-123456789012",
  );
  const requests: { path: string; body: unknown }[] = [];
  let attempts = 0;

  await postAppEvent(event, async (path, body) => {
    requests.push({ path, body });
    attempts += 1;
    if (attempts === 1) throw new Error("temporary failure");
  }, async () => undefined);

  expect(requests).toEqual([
    { path: APP_EVENTS_PATH, body: event },
    { path: APP_EVENTS_PATH, body: event },
  ]);
});
