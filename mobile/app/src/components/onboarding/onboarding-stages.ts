import type { ServerApp } from "@/lib/apps-registry";

export const ONBOARDING_APP_SLUGS = [
  "vorinthex-ai",
  "archive",
  "gallery",
  "compass",
  "signal",
  "ascend",
  "core",
] as const;

export type OnboardingAppSlug = (typeof ONBOARDING_APP_SLUGS)[number];
export type OnboardingAppStage = Pick<ServerApp, "key" | "name" | "description" | "logoUrl"> & { slug: OnboardingAppSlug };

export function selectOnboardingAppStages(apps: readonly ServerApp[]): OnboardingAppStage[] {
  return ONBOARDING_APP_SLUGS.flatMap((slug) => {
    const app = apps.find((candidate) => candidate.slug === slug);
    return app ? [{ key: app.key, slug, name: app.name, description: app.description, logoUrl: app.logoUrl }] : [];
  });
}
