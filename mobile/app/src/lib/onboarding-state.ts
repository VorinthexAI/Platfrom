import * as SecureStore from "expo-secure-store";

import { initialLocalOnboardingState, withIntroSeen, withOnboardingComplete, withPostDeletion, type LocalOnboardingState } from "./onboarding-policy";

const COMPLETE_KEY = "vorinthex.onboarding.complete.v2";
const INTRO_SEEN_KEY = "vorinthex.onboarding.intro-seen.v1";
const POST_DELETION_KEY = "vorinthex.onboarding.post-deletion.v1";
const LEGACY_PREVIEW_COMPLETE_KEY = "vorinthex.onboarding.preview-complete.v1";
export type { LocalOnboardingState } from "./onboarding-policy";

let state: LocalOnboardingState = initialLocalOnboardingState;
const listeners = new Set<(next: LocalOnboardingState) => void>();

function publish(next: LocalOnboardingState) {
  state = next;
  for (const listener of listeners) listener(next);
}

export async function readLocalOnboardingState() {
  const [complete, introSeen, postDeletion] = await Promise.all([
    SecureStore.getItemAsync(COMPLETE_KEY),
    SecureStore.getItemAsync(INTRO_SEEN_KEY),
    SecureStore.getItemAsync(POST_DELETION_KEY),
  ]);
  await Promise.all([
    SecureStore.deleteItemAsync(LEGACY_PREVIEW_COMPLETE_KEY),
  ]).catch(() => undefined);
  const next = {
    complete: complete === "true",
    introSeen: introSeen === "true" || complete === "true",
    postDeletion: postDeletion === "true",
    previewComplete: false,
  };
  publish(next);
  return next;
}

export async function markOnboardingPreviewComplete() {
  publish(withIntroSeen(state));
  await SecureStore.setItemAsync(INTRO_SEEN_KEY, "true");
}

export async function markOnboardingComplete() {
  publish(withOnboardingComplete());
  await Promise.all([
    SecureStore.setItemAsync(COMPLETE_KEY, "true"),
    SecureStore.setItemAsync(INTRO_SEEN_KEY, "true"),
    SecureStore.deleteItemAsync(POST_DELETION_KEY),
  ]);
}

export async function markPostDeletionOnboarding() {
  publish(withPostDeletion(state));
  await Promise.all([
    SecureStore.setItemAsync(INTRO_SEEN_KEY, "true"),
    SecureStore.setItemAsync(POST_DELETION_KEY, "true"),
  ]);
}

export function resetOnboardingSession() {
  publish({ ...state, previewComplete: false });
}

export function getLocalOnboardingState() {
  return state;
}

export function subscribeLocalOnboardingState(listener: (next: LocalOnboardingState) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
