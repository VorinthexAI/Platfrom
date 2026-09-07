import * as SecureStore from "expo-secure-store";

const COMPLETE_KEY = "vorinthex.onboarding.complete.v2";
const LEGACY_PREVIEW_COMPLETE_KEY = "vorinthex.onboarding.preview-complete.v1";
export type LocalOnboardingState = {
  complete: boolean;
  previewComplete: boolean;
};

let state: LocalOnboardingState = { complete: false, previewComplete: false };
const listeners = new Set<(next: LocalOnboardingState) => void>();

function publish(next: LocalOnboardingState) {
  state = next;
  for (const listener of listeners) listener(next);
}

export async function readLocalOnboardingState() {
  const complete = await SecureStore.getItemAsync(COMPLETE_KEY);
  await Promise.all([
    SecureStore.deleteItemAsync(LEGACY_PREVIEW_COMPLETE_KEY),
  ]).catch(() => undefined);
  const next = {
    complete: complete === "true",
    previewComplete: false,
  };
  publish(next);
  return next;
}

export async function markOnboardingPreviewComplete() {
  publish({ ...state, previewComplete: true });
}

export async function markOnboardingComplete() {
  publish({ complete: true, previewComplete: true });
  await SecureStore.setItemAsync(COMPLETE_KEY, "true");
}

export async function clearOnboardingCompletion() {
  publish({ complete: false, previewComplete: false });
  await SecureStore.deleteItemAsync(COMPLETE_KEY);
}

export function resetOnboardingSession() {
  publish({ ...state, previewComplete: false });
}

export function subscribeLocalOnboardingState(listener: (next: LocalOnboardingState) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
