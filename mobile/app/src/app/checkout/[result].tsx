import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@vorinthex/shared/ui/toast";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef } from "react";

import { completeCheckoutReturn } from "@/lib/checkout-return";
import { useAuthStore } from "@/state/auth";
import { useUiStore } from "@/state/ui";

export default function CheckoutCallbackRoute() {
  const { result } = useLocalSearchParams<{ result?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useAuthStore((state) => state.status);
  const userKey = useAuthStore((state) => state.user?.key);
  const isOnboarded = useAuthStore((state) => state.user?.isOnboarded);
  const { showToast } = useToast();
  const handled = useRef<string | undefined>(undefined);

  useEffect(() => {
    if (status === "bootstrapping") return;
    if (status === "unauthenticated") { router.replace("/auth"); return; }
    if (!userKey) return;
    const key = `${userKey}:${result}`;
    if (handled.current === key) return;
    handled.current = key;
    if (result === "success") completeCheckoutReturn(queryClient, userKey);
    else {
      showToast({ title: "Checkout was not completed.", duration: 2_500 });
      if (isOnboarded) useUiStore.getState().openPaywall();
    }
    router.replace(isOnboarded ? "/capability/archive" : "/onboarding");
  }, [isOnboarded, queryClient, result, router, showToast, status, userKey]);

  return null;
}
