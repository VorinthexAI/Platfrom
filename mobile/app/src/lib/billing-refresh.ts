import type { QueryClient } from "@tanstack/react-query";

import { billingSummaryQueryKey, currentSubscriptionQueryKey } from "./billing-client";

export async function refreshAuthoritativeBilling(queryClient: QueryClient, userKey: string) {
  const keys = [billingSummaryQueryKey(userKey), currentSubscriptionQueryKey(userKey)] as const;
  await Promise.all(keys.map((queryKey) => queryClient.invalidateQueries({ queryKey, exact: true })));
  await Promise.all(keys.map((queryKey) => queryClient.refetchQueries({ queryKey, exact: true }, { throwOnError: true })));
  for (const queryKey of keys) {
    const state = queryClient.getQueryState(queryKey);
    if (!state || state.status !== "success") throw new Error("Authoritative billing status could not be refreshed.");
  }
}
