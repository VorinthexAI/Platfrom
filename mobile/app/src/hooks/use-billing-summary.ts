import { useQuery } from "@tanstack/react-query";

import { billingSummaryQueryKey, fetchBillingSummary, wholeSparks } from "@/lib/billing-client";

export const BILLING_BALANCE_POLL_INTERVAL_MS = 60_000;

export function useWholeSparkBalance(userKey: string | undefined) {
  return useQuery({
    queryKey: billingSummaryQueryKey(userKey ?? "unauthenticated"),
    queryFn: fetchBillingSummary,
    enabled: Boolean(userKey),
    refetchInterval: BILLING_BALANCE_POLL_INTERVAL_MS,
    refetchIntervalInBackground: false,
    refetchOnMount: "always",
    refetchOnReconnect: "always",
    select: (summary) => wholeSparks(summary.microSparkBalance),
  });
}
