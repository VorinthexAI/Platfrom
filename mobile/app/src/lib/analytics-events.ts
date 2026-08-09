export const CORE_APP_NAMES = ["Archive", "Gallery", "Signal", "Compass", "Ascend"] as const;
export type CoreAppName = typeof CORE_APP_NAMES[number];
export const APP_EVENTS_PATH = "/app/events";

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

export type AppEvent = ReturnType<typeof buildAppOpenedEvent> | ReturnType<typeof buildOnboardingEvent>;
export type EventPoster = (path: string, event: AppEvent) => Promise<unknown>;

export async function postAppEvent(
  event: AppEvent,
  post: EventPoster,
  wait: (milliseconds: number) => Promise<unknown> = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)),
) {
  try {
    await post(APP_EVENTS_PATH, event);
  } catch {
    await wait(750);
    await post(APP_EVENTS_PATH, event);
  }
}
