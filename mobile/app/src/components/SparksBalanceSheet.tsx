import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { useToast } from "@vorinthex/shared/ui/toast";
import { useQueryClient } from "@tanstack/react-query";
import { AppState, Linking, StyleSheet, Text, View } from "react-native";
import { useEffect, useRef } from "react";

import { billingSummaryQueryKey, formatWholeSparks } from "@/lib/billing-client";
import { subscribeDomainErrors } from "@/lib/domain-error-observer";
import { useWholeSparkBalance } from "@/hooks/use-billing-summary";
import { useAuthStore } from "@/state/auth";
import { useUiStore } from "@/state/ui";
import { fonts, palette, spacing } from "@/theme/tokens";

export function SparksBalanceSheet({ isOffline }: { isOffline: boolean }) {
  const open = useUiStore((state) => state.sparksSheetOpen);
  const reason = useUiStore((state) => state.sparksSheetReason);
  const close = useUiStore((state) => state.closeSparksSheet);
  const userKey = useAuthStore((state) => state.user?.key);
  const { data: balance, refetch } = useWholeSparkBalance(userKey);
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
      if (state === "active" && userKey) void refetch();
    });
    return () => subscription.remove();
  }, [refetch, userKey]);

  useEffect(() => {
    if (previousOffline.current && !isOffline && userKey) void refetch();
    previousOffline.current = isOffline;
  }, [isOffline, refetch, userKey]);

  const insufficient = reason === "insufficient-balance";

  return <BottomSheet
    description="Sparks power AI actions across Vorinthex."
    footer={<><Button onPress={() => void Linking.openURL("https://vorinthex.com/pricing").catch(() => undefined)} size="md" variant="primary">View pricing</Button><Button onPress={close} size="md" variant="secondary">Close</Button></>}
    onOpenChange={(next) => { if (!next) close(); }}
    open={open}
    title="Sparks"
  >
    <View style={styles.content}>
      <Text accessibilityLabel={balance === undefined ? "Sparks balance unavailable" : `Current balance: ${balance} Sparks`} style={styles.balance}>{balance === undefined ? "--" : formatWholeSparks(balance)} Sparks</Text>
      <Text style={styles.heading}>{insufficient ? "You need more Sparks" : "Your Sparks balance"}</Text>
      <Text style={styles.copy}>{insufficient ? "This action needs more Sparks than your current balance." : "Sparks power AI actions across Vorinthex."} Purchases are not available in the app. View current pricing and availability on vorinthex.com.</Text>
    </View>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  content: { gap: spacing.xs },
  balance: { color: palette.text, fontFamily: fonts.medium, fontSize: 28, marginBottom: spacing.sm },
  heading: { color: palette.text, fontFamily: fonts.medium, fontSize: 16 },
  copy: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19 },
});
