import { useQuery } from "@tanstack/react-query";

import { billingSummaryQueryKey, currentSubscriptionQueryKey, fetchBillingSummary, fetchCurrentSubscription, scopedBillingSummaryQueryKey, wholeSparks } from "@/lib/billing-client";

export const BILLING_BALANCE_POLL_INTERVAL_MS = 60_000;

export function useWholeSparkBalance(userKey: string | undefined) {
  return useQuery({
    queryKey: billingSummaryQueryKey(userKey ?? "unauthenticated"),
    queryFn: ({ signal }) => fetchBillingSummary({}, signal),
    enabled: Boolean(userKey),
    refetchInterval: BILLING_BALANCE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    select: (summary) => wholeSparks(summary.microSparkBalance),
  });
}

export function useBillingSummary(userKey: string | undefined, scopeKey?: string) {
  return useQuery({
    queryKey: scopeKey ? scopedBillingSummaryQueryKey(userKey ?? "unauthenticated", scopeKey) : billingSummaryQueryKey(userKey ?? "unauthenticated"),
    queryFn: ({ signal }) => fetchBillingSummary(scopeKey ? { scopeKey } : {}, signal),
    enabled: Boolean(userKey),
    placeholderData: (previous, query) => query?.queryKey[1] === userKey ? previous : undefined,
    refetchInterval: BILLING_BALANCE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
  });
}

export function useCurrentSubscription(userKey: string | undefined) {
  return useQuery({
    queryKey: currentSubscriptionQueryKey(userKey ?? "unauthenticated"),
    queryFn: ({ signal }) => fetchCurrentSubscription(signal),
    enabled: Boolean(userKey),
    refetchOnMount: "always",
    refetchOnReconnect: "always",
  });
}
