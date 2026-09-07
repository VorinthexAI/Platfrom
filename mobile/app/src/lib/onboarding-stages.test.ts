import { expect, test } from "bun:test";

import { ONBOARDING_APP_SLUGS, selectOnboardingAppStages } from "@/components/onboarding/onboarding-stages";
import type { ServerApp } from "./apps-registry";

const timestamp = "2026-09-03T12:00:00.000Z";

function app(slug: string, index: number): ServerApp {
  return {
    key: `ck${String(index).padStart(23, "0")}`,
    slug,
    name: `${slug} server name`,
    description: `${slug} server description`,
    detailedDescription: `${slug} server detail`,
    logoUrl: `https://vorinthex.com/logos/${slug}.png`,
    version: "1.0.0",
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

test("selects onboarding apps in explicit order using server presentation fields", () => {
  const shuffled = [...ONBOARDING_APP_SLUGS].reverse().map(app);
  const stages = selectOnboardingAppStages([app("future-app", 9), ...shuffled]);
  expect(stages.map(({ slug }) => slug)).toEqual(ONBOARDING_APP_SLUGS);
  expect(stages[0]).toMatchObject({ name: "archive server name", description: "archive server description", logoUrl: "https://vorinthex.com/logos/archive.png" });
});

test("safely omits a missing registry stage", () => {
  const stages = selectOnboardingAppStages(ONBOARDING_APP_SLUGS.filter((slug) => slug !== "gallery").map(app));
  expect(stages.map(({ slug }) => slug)).toEqual(ONBOARDING_APP_SLUGS.filter((slug) => slug !== "gallery"));
});
