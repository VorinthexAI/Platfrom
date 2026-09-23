import * as SecureStore from "expo-secure-store";

import { initialLocalOnboardingState, withOnboardingComplete, withPostDeletion, withPreviewComplete, type LocalOnboardingState } from "./onboarding-policy";

const COMPLETE_KEY = "vorinthex.onboarding.complete.v2";
const POST_DELETION_KEY = "vorinthex.onboarding.post-deletion.v1";
const INTRO_SEEN_KEY = "vorinthex.onboarding.intro-seen.v2";
const LEGACY_INTRO_SEEN_KEY = "vorinthex.onboarding.intro-seen.v1";
const LEGACY_PREVIEW_COMPLETE_KEY = "vorinthex.onboarding.preview-complete.v1";
export type { LocalOnboardingState } from "./onboarding-policy";

let state: LocalOnboardingState = initialLocalOnboardingState;
let hydration: Promise<LocalOnboardingState> | undefined;
let revision = 0;
const listeners = new Set<(next: LocalOnboardingState) => void>();

function publish(next: LocalOnboardingState) {
  revision += 1;
  state = next;
  for (const listener of listeners) listener(next);
}

export function readLocalOnboardingState(): Promise<LocalOnboardingState> {
  if (!hydration) hydration = (async () => {
    const started = revision;
    const [complete, postDeletion, seen, legacySeen, legacyComplete] = await Promise.all([
      SecureStore.getItemAsync(COMPLETE_KEY), SecureStore.getItemAsync(POST_DELETION_KEY),
      SecureStore.getItemAsync(INTRO_SEEN_KEY), SecureStore.getItemAsync(LEGACY_INTRO_SEEN_KEY), SecureStore.getItemAsync(LEGACY_PREVIEW_COMPLETE_KEY),
    ]);
    const previewComplete = [complete, postDeletion, seen, legacySeen, legacyComplete].includes("true");
    if (previewComplete && seen !== "true") await SecureStore.setItemAsync(INTRO_SEEN_KEY, "true");
    if (started === revision) publish({ complete: complete === "true", postDeletion: postDeletion === "true", previewComplete, introActive: false });
    return state;
  })().catch((error) => { hydration = undefined; throw error; });
  return hydration.then(() => state);
}

export async function markOnboardingIntroShown() {
  if (state.previewComplete) return;
  publish({ ...state, previewComplete: true, introActive: true });
  await SecureStore.setItemAsync(INTRO_SEEN_KEY, "true");
}

export async function markOnboardingPreviewComplete() {
  publish(withPreviewComplete(state));
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
  await SecureStore.setItemAsync(POST_DELETION_KEY, "true");
}

export function resetOnboardingSession() {
  publish({ ...state, introActive: false });
}

export function getLocalOnboardingState() {
  return state;
}

export function subscribeLocalOnboardingState(listener: (next: LocalOnboardingState) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
