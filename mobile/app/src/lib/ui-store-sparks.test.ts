import { expect, test } from "bun:test";

import { useUiStore } from "../state/ui";

test("opens and closes Sparks idempotently", () => {
  useUiStore.setState({ paywallOpen: false });
  let changes = 0;
  const unsubscribe = useUiStore.subscribe(() => { changes += 1; });
  useUiStore.getState().openPaywall();
  useUiStore.getState().openPaywall();
  expect(useUiStore.getState().paywallOpen).toBe(true);
  useUiStore.getState().closePaywall();
  useUiStore.getState().closePaywall();
  expect(useUiStore.getState().paywallOpen).toBe(false);
  expect(changes).toBe(2);
  unsubscribe();
});

test("consumes internal onboarding referral entry once", () => {
  useUiStore.setState({ onboardingReferralEntry: false });
  useUiStore.getState().enterOnboardingReferral();
  expect(useUiStore.getState().consumeOnboardingReferralEntry()).toBe(true);
  expect(useUiStore.getState().consumeOnboardingReferralEntry()).toBe(false);
});
