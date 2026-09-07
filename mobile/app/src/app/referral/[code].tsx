import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "@vorinthex/shared/ui/button";

import { referralCodeSchema } from "@/lib/referral-client";
import { savePendingReferralCode } from "@/lib/pending-referral-vault";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, spacing } from "@/theme/tokens";

export default function ReferralRecipientRoute() {
  const { code } = useLocalSearchParams<{ code?: string }>();
  const router = useRouter();
  const status = useAuthStore((state) => state.status);
  const isOnboarded = useAuthStore((state) => state.user?.isOnboarded === true);
  const [vaultFailed, setVaultFailed] = useState(false);
  const invalidCode = status !== "bootstrapping" && !referralCodeSchema.safeParse(code).success;

  useEffect(() => {
    if (status === "bootstrapping") return;
    const parsed = referralCodeSchema.safeParse(code);
    if (!parsed.success) return;
    if (status === "authenticated") {
      router.replace(isOnboarded ? "/capability/archive" : "/onboarding");
      return;
    }
    void savePendingReferralCode(parsed.data).then(() => {
      router.replace("/auth");
    }).catch(() => setVaultFailed(true));
  }, [code, isOnboarded, router, status]);

  return <View style={styles.root}>{invalidCode || vaultFailed ? <><Text accessibilityRole="alert" style={styles.message}>This referral link is invalid.</Text><Button onPress={() => router.replace(status === "authenticated" ? "/capability/archive" : "/auth")} size="md" variant="primary">Continue</Button></> : <Text style={styles.message}>Preparing your referral...</Text>}</View>;
}

const styles = StyleSheet.create({ root: { alignItems: "center", backgroundColor: palette.page, flex: 1, gap: spacing.md, justifyContent: "center", padding: spacing.lg }, message: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, textAlign: "center" } });
