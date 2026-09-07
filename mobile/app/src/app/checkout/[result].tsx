import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@vorinthex/shared/ui/button";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { refreshAuthoritativeBilling } from "@/lib/billing-refresh";
import { useAuthStore } from "@/state/auth";
import { useUiStore } from "@/state/ui";
import { fonts, palette, spacing } from "@/theme/tokens";

export default function CheckoutCallbackRoute() {
  const { result } = useLocalSearchParams<{ result?: string }>();
  const router = useRouter();
  const queryClient = useQueryClient();
  const status = useAuthStore((state) => state.status);
  const user = useAuthStore((state) => state.user);
  const openPaywall = useUiStore((state) => state.openPaywall);
  const enterOnboardingReferral = useUiStore((state) => state.enterOnboardingReferral);
  const [failure, setFailure] = useState<string>();
  const [refreshing, setRefreshing] = useState(result === "success");

  const confirmReturnedCheckout = async () => {
    if (!user?.key || refreshing) return;
    setRefreshing(true);
    setFailure(undefined);
    try {
      await refreshAuthoritativeBilling(queryClient, user.key);
      if (!user.isOnboarded) enterOnboardingReferral();
      router.replace(user.isOnboarded ? "/capability/archive" : "/onboarding");
    } catch {
      setFailure("Checkout returned, but billing status could not be refreshed. Webhook confirmation may still be processing.");
      setRefreshing(false);
    }
  };

  useEffect(() => {
    if (status === "bootstrapping") return;
    if (status === "unauthenticated") { router.replace("/auth"); return; }
    if (result !== "success" || !user?.key) return;
    let active = true;
    void refreshAuthoritativeBilling(queryClient, user.key).then(() => {
      if (!active) return;
      if (!user.isOnboarded) enterOnboardingReferral();
      router.replace(user.isOnboarded ? "/capability/archive" : "/onboarding");
    }).catch(() => {
      if (active) {
        setFailure("Checkout returned, but billing status could not be refreshed. Webhook confirmation may still be processing.");
        setRefreshing(false);
      }
    });
    return () => { active = false; };
  }, [enterOnboardingReferral, queryClient, result, router, status, user]);

  const returnToPlans = () => { openPaywall(); router.replace("/capability/archive"); };
  const returned = result === "success";
  return <View style={styles.root}><Text accessibilityRole="header" style={styles.title}>{returned ? "Checkout returned" : "Checkout not completed"}</Text><Text accessibilityLiveRegion="polite" style={styles.message}>{failure ?? (returned ? "Refreshing authoritative billing status. Webhook confirmation may take a moment." : "No billing confirmation was received. Return to your plans when you are ready.")}</Text>{failure ? <Button loading={refreshing} onPress={() => void confirmReturnedCheckout()} size="md" variant="primary">Confirm again</Button> : !returned ? <Button onPress={returnToPlans} size="md" variant="primary">Return to plans</Button> : null}</View>;
}

const styles = StyleSheet.create({ root: { alignItems: "center", backgroundColor: palette.page, flex: 1, gap: spacing.md, justifyContent: "center", padding: spacing.xl }, title: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 26 }, message: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 21, textAlign: "center" } });
