import { postJson } from "./api-client";

export type OnboardingEventSlug =
  | "onboarding.vorinthex-ai"
  | "onboarding.archive"
  | "onboarding.gallery"
  | "onboarding.compass"
  | "onboarding.signal"
  | "onboarding.ascend"
  | "onboarding.core"
  | "onboarding.paywall"
  | "onboarding.referral"
  | "onboarding.reward"
  | "onboarding.notifications"
  | "onboarding.photos"
  | "onboarding.camera";

export async function recordOnboardingEvent(slug: OnboardingEventSlug) {
  await postJson<{ slug: OnboardingEventSlug }, { success: true }>("/events", { slug });
}
