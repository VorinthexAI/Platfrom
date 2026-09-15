import { postJson } from "./api-client";

export type OnboardingEventSlug =
  | "onboarding.welcome"
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
  | "onboarding.profile-badge"
  | "onboarding.profile-badge.claimed"
  | "onboarding.profile-badge.skipped"
  | "onboarding.notifications"
  | "onboarding.camera"
  | "onboarding.camera.allowed"
  | "onboarding.camera.skipped"
  | "onboarding.notifications.allowed"
  | "onboarding.notifications.skipped"
  | "onboarding.sign-in";

export type AuthOptionEventSlug =
  | "auth.option.selected.google"
  | "auth.option.selected.apple"
  | "auth.option.selected.email";

export type AnalyticsEventSlug = "app.opened" | AuthOptionEventSlug | OnboardingEventSlug;

export async function recordAnalyticsEvent(slug: AnalyticsEventSlug, appKey?: string) {
  await postJson<{ slug: AnalyticsEventSlug }, { success: true }>("/events", { slug }, { appKey });
}

export async function recordOnboardingEvent(slug: OnboardingEventSlug, appKey?: string) {
  await recordAnalyticsEvent(slug, appKey);
}
