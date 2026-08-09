import { postJson } from "./api-client";
import { randomUUID } from "expo-crypto";
import { buildAppOpenedEvent, buildOnboardingEvent, type CoreAppName } from "./analytics-events";
import { getDistinctId } from "./installation";

async function send(event: ReturnType<typeof buildAppOpenedEvent> | ReturnType<typeof buildOnboardingEvent>) {
  try {
    await postJson<typeof event, { ok: true }>("/platform/events", event);
  } catch {
    await new Promise((resolve) => setTimeout(resolve, 750));
    await postJson<typeof event, { ok: true }>("/platform/events", event);
  }
}

export async function trackAppOpened() {
  await send(buildAppOpenedEvent(`evt_${randomUUID()}`, await getDistinctId()));
}

export async function trackOnboardingDecision(
  step: 1 | 2 | 3 | 4 | 5,
  coreAppName: CoreAppName,
  decision: "enabled" | "skipped",
) {
  const distinctId = await getDistinctId();
  await send(buildOnboardingEvent(distinctId, `evt_onboarding_${distinctId.slice(4)}_${step}`, step, coreAppName, decision));
}
