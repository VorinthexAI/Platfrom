export const CORE_APP_NAMES = ["Archive", "Gallery", "Signal", "Compass", "Ascend"] as const;
export type CoreAppName = typeof CORE_APP_NAMES[number];

export function buildAppOpenedEvent(eventId: string, distinctId: string) {
  return { slug: "app.opened" as const, eventId, distinctId };
}

export function buildOnboardingEvent(
  distinctId: string,
  eventId: string,
  step: 1 | 2 | 3 | 4 | 5,
  coreAppName: CoreAppName,
  decision: "enabled" | "skipped",
) {
  return {
    slug: "app.onboarding" as const,
    eventId,
    distinctId,
    step,
    coreAppName,
    enabled: decision === "enabled",
    skipped: decision === "skipped",
  };
}
