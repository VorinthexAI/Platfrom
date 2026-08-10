import { useLocalSearchParams } from "expo-router";
import { useEffect, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Spinner } from "@vorinthex/shared/ui/spinner";

import { postJson } from "@/lib/api-client";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, spacing } from "@/theme/tokens";

export default function OAuthCompleteRoute() {
  const { code, error } = useLocalSearchParams<{ code?: string; error?: string }>();
  const hydrate = useAuthStore((state) => state.hydrate);
  const [message, setMessage] = useState(() => error
    ? "Additional verification is required before this account can sign in."
    : code ? "Completing secure sign in..." : "The identity provider returned an incomplete sign-in response.");

  useEffect(() => {
    if (error || !code) return;
    void postJson<{ code: string }, unknown>("/auth/mobile/oauth/exchange", { code })
      .then(async () => {
        await hydrate();
      })
      .catch(() => setMessage("This sign-in response is invalid or expired."));
  }, [code, error, hydrate]);

  return <View style={styles.root}><Spinner size="small" /><Text style={styles.message}>{message}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, backgroundColor: palette.page, padding: spacing.xl },
  message: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, textAlign: "center" },
});
