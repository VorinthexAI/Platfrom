import type { QueryClient } from "@tanstack/react-query";
import { useAuthStore } from "@/state/auth";
import { useUiStore } from "@/state/ui";
import { refreshAuthoritativeBilling } from "./billing-refresh";

/** A successful browser return advances the UI; only backend reads grant balance. */
export function completeCheckoutReturn(queryClient: QueryClient, userKey: string) {
  const auth = useAuthStore.getState();
  if (auth.status !== "authenticated" || auth.user?.key !== userKey) return false;
  useUiStore.getState().closePaywall();
  if (!auth.user.isOnboarded) useUiStore.getState().enterOnboardingReferral();
  void refreshAuthoritativeBilling(queryClient, userKey);
  return true;
}
