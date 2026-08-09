import { postJson } from "./api-client";
import { randomUUID } from "expo-crypto";
import {
  buildAppOpenedEvent,
  buildOnboardingEvent,
  postAppEvent,
  type AppEvent,
  type CoreAppName,
} from "./analytics-events";
import { getDistinctId } from "./installation";

async function sendAppEvent(event: AppEvent) {
  await postAppEvent(event, (path, body) => postJson<AppEvent, { ok: true }>(path, body));
}

export async function trackAppOpened() {
  await sendAppEvent(buildAppOpenedEvent(`evt_${randomUUID()}`, await getDistinctId()));
}

export async function trackOnboardingDecision(
  step: 1 | 2 | 3 | 4 | 5,
  coreAppName: CoreAppName,
  decision: "enabled" | "skipped",
) {
  const distinctId = await getDistinctId();
  await sendAppEvent(buildOnboardingEvent(distinctId, `evt_onboarding_${distinctId.slice(4)}_${step}`, step, coreAppName, decision));
}
