import { expect, test } from "bun:test";

import { initialLocalOnboardingState, withIntroSeen, withOnboardingComplete, withPostDeletion } from "./onboarding-policy";

test("keeps intro and post-deletion routing as separate installation decisions", () => {
  const introSeen = withIntroSeen(initialLocalOnboardingState);
  expect(introSeen).toMatchObject({ complete: false, introSeen: true, postDeletion: false });

  const postDeletion = withPostDeletion(introSeen);
  expect(postDeletion).toMatchObject({ complete: false, introSeen: true, postDeletion: true, previewComplete: false });

  expect(withOnboardingComplete()).toMatchObject({ complete: true, introSeen: true, postDeletion: false });
});
