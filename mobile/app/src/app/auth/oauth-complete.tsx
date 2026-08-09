import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { postJson } from "@/lib/api-client";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, spacing } from "@/theme/tokens";

export default function OAuthCompleteRoute() {
  const { code, error } = useLocalSearchParams<{ code?: string; error?: string }>();
  const hydrate = useAuthStore((state) => state.hydrate);
  const router = useRouter();
  const [message, setMessage] = useState("Completing secure sign in...");

  useEffect(() => {
    if (error) {
      setMessage("Additional verification is required before this account can sign in.");
      return;
    }
    if (!code) {
      setMessage("The identity provider returned an incomplete sign-in response.");
      return;
    }
    void postJson<{ code: string }, unknown>("/auth/mobile/oauth/exchange", { code })
      .then(async () => {
        await hydrate();
        router.replace("/onboarding");
      })
      .catch(() => setMessage("This sign-in response is invalid or expired."));
  }, [code, error, hydrate, router]);

  return <View style={styles.root}><ActivityIndicator color={palette.silver100} /><Text style={styles.message}>{message}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, backgroundColor: palette.page, padding: spacing.xl },
  message: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, textAlign: "center" },
});
