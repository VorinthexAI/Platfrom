import { Dialog } from "@vorinthex/shared/ui/dialog";
import { Button } from "@vorinthex/shared/ui/button";
import { Badge } from "@vorinthex/shared/ui/badge";
import { ChromeIcon } from "@vorinthex/shared/ui/chrome-icon";
import { useToast } from "@vorinthex/shared/ui/toast";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { LinearGradient } from "expo-linear-gradient";
import { AppState, ScrollView, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useEffect, useRef } from "react";

import { billingSummaryQueryKey, currentSubscriptionQueryKey, formatWholeSparks, setSubscriptionCancellation } from "@/lib/billing-client";
import { subscribeDomainErrors } from "@/lib/domain-error-observer";
import { useBillingSummary, useCurrentSubscription } from "@/hooks/use-billing-summary";
import { useAuthStore } from "@/state/auth";
import { useUiStore } from "@/state/ui";
import { fonts, palette, spacing } from "@/theme/tokens";
import { useAppsStore } from "@/state/apps";
import { subscriptionPresentation } from "@/lib/subscription-presentation";
import { NeuralBackdrop } from "@/components/NeuralBackdrop";
import { vorinthexMarkSource } from "@/data/capability-icons";

export function SparksBalanceSheet({ isOffline }: { isOffline: boolean }) {
  const open = useUiStore((state) => state.sparksSheetOpen);
  const reason = useUiStore((state) => state.sparksSheetReason);
  const close = useUiStore((state) => state.closeSparksSheet);
  const openPaywall = useUiStore((state) => state.openPaywall);
  const products = useAppsStore((state) => state.products);
  const { width } = useWindowDimensions();
  const userKey = useAuthStore((state) => state.user?.key);
  const { data: billing, refetch } = useBillingSummary(userKey);
  const balance = billing ? Math.floor(billing.microSparkBalance / 1_000_000) : undefined;
  const subscriptionQuery = useCurrentSubscription(userKey);
  const refetchSubscription = subscriptionQuery.refetch;
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const previousOffline = useRef(isOffline);

  useEffect(() => subscribeDomainErrors(() => {
    showToast({ title: "Not enough Sparks", description: "You need more Sparks to continue.", duration: 3_000 });
    useUiStore.getState().openSparksSheet("insufficient-balance");
    if (userKey) void queryClient.invalidateQueries({ queryKey: billingSummaryQueryKey(userKey), exact: true, refetchType: "active" });
  }), [queryClient, showToast, userKey]);

  useEffect(() => {
    const subscription = AppState.addEventListener("change", (state) => {
      if (state === "active" && userKey) void Promise.all([refetch(), refetchSubscription()]);
    });
    return () => subscription.remove();
  }, [refetch, refetchSubscription, userKey]);

  useEffect(() => {
    if (previousOffline.current && !isOffline && userKey) void refetch();
    previousOffline.current = isOffline;
  }, [isOffline, refetch, userKey]);

  const insufficient = reason === "insufficient-balance";
  const subscription = subscriptionQuery.data;
  const subscriptionProduct = subscription ? products.find(({ key }) => key === subscription.productKey) : undefined;
  const subscriptionView = subscription ? subscriptionPresentation(subscription, subscriptionProduct) : undefined;
  const updateSubscription = useMutation({
    mutationFn: setSubscriptionCancellation,
    onSuccess: (updated) => {
      if (userKey) queryClient.setQueryData(currentSubscriptionQueryKey(userKey), updated);
      showToast({ title: updated.cancelAtPeriodEnd ? "Cancellation scheduled." : "Subscription renewed.", duration: 2_500 });
    },
    onError: () => showToast({ title: "Subscription could not be updated.", duration: 2_500 }),
  });

  const subscriptionAction = subscriptionView?.action ? <Button loading={updateSubscription.isPending} onPress={() => updateSubscription.mutate(subscriptionView.action === "cancel")} size="md" variant="secondary">{subscriptionView.action === "restore" ? "Restore renewal" : "Cancel renewal"}</Button> : null;
  const viewOffers = () => { close(); openPaywall(); };

  return <Dialog
    description={insufficient ? "Add Sparks to continue where you left off." : "See your balance and learn how to get more Sparks."}
    footer={<Button onPress={viewOffers} size="md" variant="primary">View offers</Button>}
    onOpenChange={(next) => { if (!next) close(); }}
    open={open}
    title={insufficient ? "You need more Sparks" : "Sparks"}
  >
    <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
      <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.artwork}>
        <NeuralBackdrop height={150} width={Math.max(220, width * 0.8 - spacing.xl * 2)} />
        <LinearGradient colors={["rgba(3,5,7,0)", palette.page]} locations={[0.2, 1]} style={StyleSheet.absoluteFill} />
        <View style={styles.mark}><ChromeIcon glow={0.7} size={92} source={vorinthexMarkSource} /></View>
      </View>
      <View style={styles.balanceCard}>
        <Text style={styles.cardLabel}>CURRENT BALANCE</Text>
        <Text accessibilityLabel={balance === undefined ? "Sparks balance unavailable. Showing 0 Sparks" : `Current balance: ${balance} Sparks`} style={styles.balance}>{formatWholeSparks(balance ?? 0)} <Text style={styles.balanceUnit}>Sparks</Text></Text>
        {insufficient ? <Badge><Text style={styles.badgeText}>MORE SPARKS NEEDED</Text></Badge> : null}
        {billing?.spendingBlocked ? <Text accessibilityRole="alert" style={styles.debtNotice}>Spending is paused until {formatWholeSparks(Math.ceil(billing.microSparkDebt / 1_000_000))} refunded Sparks are recovered by future credits.</Text> : null}
      </View>

      {subscriptionQuery.isLoading ? <View style={styles.planCard}><Text style={styles.cardLabel}>SUBSCRIPTION</Text><Text style={styles.copy}>Checking subscription status...</Text></View> : subscription ? <View style={styles.planCard}>
        <View style={styles.topupRow}><Text style={styles.cardLabel}>SUBSCRIPTION</Text><Badge><Text style={styles.badgeText}>{subscription.status.replace("_", " ").toUpperCase()}</Text></Badge></View>
        <Text style={styles.heading}>{subscriptionView?.title}</Text>
        <Text style={styles.copy}>{subscriptionView?.copy}</Text>
      </View> : <View style={styles.planCard}>
        <Text style={styles.cardLabel}>SUBSCRIPTION</Text>
        <Text style={styles.heading}>No active plan</Text>
        <Text style={styles.copy}>{subscriptionQuery.isError ? "Subscription status could not be loaded. Close and reopen this sheet to retry." : "Subscribe for an automatic weekly or monthly Spark grant."}</Text>
      </View>}
      {subscriptionAction}
    </ScrollView>
  </Dialog>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.md },
  artwork: { alignItems: "center", height: 150, justifyContent: "center", overflow: "hidden" },
  mark: { position: "absolute" },
  balanceCard: { backgroundColor: palette.insetHighlight, borderColor: palette.hairlineBright, borderRadius: 20, borderWidth: 1, gap: spacing.sm, padding: spacing.lg },
  planCard: { borderColor: palette.hairline, borderRadius: 16, borderWidth: 1, gap: spacing.sm, padding: spacing.md },
  cardLabel: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 10, letterSpacing: 2 },
  balance: { color: palette.text, fontFamily: fonts.medium, fontSize: 32 },
  balanceUnit: { color: palette.silver500, fontSize: 15 },
  debtNotice: { color: palette.danger, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  badgeText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1 },
  heading: { color: palette.text, fontFamily: fonts.medium, fontSize: 16 },
  copy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
  topupRow: { alignItems: "center", flexDirection: "row", justifyContent: "space-between" },
});
