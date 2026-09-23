import { CancelledError, type QueryClient } from "@tanstack/react-query";

import { billingSummaryQueryKey, currentSubscriptionQueryKey, fetchBillingSummary, fetchCurrentSubscription, walletHistoryQueryKey } from "./billing-client";
import { useAuthStore } from "@/state/auth";

const refreshes = new WeakMap<QueryClient, Map<string, Promise<void>>>();

/** Bounded, best-effort convergence after checkout; never a navigation gate. */
export function refreshAuthoritativeBilling(queryClient: QueryClient, userKey: string): Promise<void> {
  let pending = refreshes.get(queryClient);
  if (!pending) { pending = new Map(); refreshes.set(queryClient, pending); }
  const existing = pending.get(userKey);
  if (existing) return existing;
  const current = () => useAuthStore.getState().status === "authenticated" && useAuthStore.getState().user?.key === userKey;
  const guarded = async <T,>(read: () => Promise<T>): Promise<T> => {
    if (!current()) throw new CancelledError({ silent: true });
    const value = await read();
    if (!current()) throw new CancelledError({ silent: true });
    return value;
  };
  const operation = (async () => {
    // A valid response may precede the paid-order/subscription webhook. Sample
    // again even after a successful read, with one owner for duplicate returns.
    for (const delay of [0, 1_500, 4_000, 10_000]) {
      if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
      if (!current()) return;
      await Promise.allSettled([
        queryClient.fetchQuery({ queryKey: billingSummaryQueryKey(userKey), queryFn: ({ signal }) => guarded(() => fetchBillingSummary({}, signal)), staleTime: 0, retry: false }),
        queryClient.fetchQuery({ queryKey: currentSubscriptionQueryKey(userKey), queryFn: ({ signal }) => guarded(() => fetchCurrentSubscription(signal)), staleTime: 0, retry: false }),
        queryClient.invalidateQueries({ queryKey: walletHistoryQueryKey(userKey), exact: true }),
      ]);
    }
  })().finally(() => { pending.delete(userKey); });
  pending.set(userKey, operation);
  return operation;
}
