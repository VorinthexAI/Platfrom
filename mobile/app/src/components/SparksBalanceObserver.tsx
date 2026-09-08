import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@vorinthex/shared/ui/toast";
import { useEffect, useRef } from "react";
import { AppState } from "react-native";

import { billingSummaryQueryKey, currentSubscriptionQueryKey } from "@/lib/billing-client";
import { subscribeDomainErrors } from "@/lib/domain-error-observer";
import { useAuthStore } from "@/state/auth";
import { useUiStore } from "@/state/ui";

export function SparksBalanceObserver({ isOffline }: { isOffline: boolean }) {
  const userKey = useAuthStore((state) => state.user?.key);
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const previousOffline = useRef(isOffline);

  useEffect(() => {
    const refresh = () => {
      if (!userKey) return;
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: billingSummaryQueryKey(userKey), exact: true, refetchType: "active" }),
        queryClient.invalidateQueries({ queryKey: currentSubscriptionQueryKey(userKey), exact: true, refetchType: "active" }),
      ]);
    };
    const subscription = AppState.addEventListener("change", (state) => { if (state === "active") refresh(); });
    if (previousOffline.current && !isOffline) refresh();
    previousOffline.current = isOffline;
    return () => subscription.remove();
  }, [isOffline, queryClient, userKey]);

  useEffect(() => subscribeDomainErrors(() => {
    showToast({ title: "Not enough Sparks", description: "You need more Sparks to continue.", duration: 3_000 });
    useUiStore.getState().openPaywall();
    if (userKey) void queryClient.invalidateQueries({ queryKey: billingSummaryQueryKey(userKey), exact: true, refetchType: "active" });
  }), [queryClient, showToast, userKey]);

  return null;
}
