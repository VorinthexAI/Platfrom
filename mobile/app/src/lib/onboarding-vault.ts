import * as SecureStore from "expo-secure-store";
import { CAPABILITIES, type CapabilitySlug } from "@/data/registry";
import type { CapabilityDecision } from "@/state/onboarding";

const DECISIONS_KEY_PREFIX = "vorinthex.onboarding.decisions.v1";
export type CapabilityDecisions = Partial<Record<CapabilitySlug, CapabilityDecision>>;
let storageOperation = Promise.resolve<unknown>(undefined);

function serialize<T>(work: () => Promise<T>): Promise<T> {
  const next = storageOperation.then(work, work);
  storageOperation = next.catch(() => undefined);
  return next;
}

function decisionsKey(userKey: string) {
  return `${DECISIONS_KEY_PREFIX}.${userKey}`;
}

export function readOnboardingDecisions(userKey: string): Promise<CapabilityDecisions> {
  return serialize(async () => {
  const key = decisionsKey(userKey);
  const raw = await SecureStore.getItemAsync(key);
  if (!raw) return {};
  try {
    const value = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(CAPABILITIES.flatMap(({ slug }) =>
      value[slug] === "enabled" || value[slug] === "skipped" ? [[slug, value[slug]]] : [],
    ));
  } catch {
    await SecureStore.deleteItemAsync(key);
    return {};
  }
  });
}

export function writeOnboardingDecisions(userKey: string, decisions: CapabilityDecisions) {
  return serialize(() => SecureStore.setItemAsync(decisionsKey(userKey), JSON.stringify(decisions), {
    keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  }));
}
