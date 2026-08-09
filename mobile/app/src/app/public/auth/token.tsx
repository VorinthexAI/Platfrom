import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useState } from "react";
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";

import { postJson } from "@/lib/api-client";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, spacing } from "@/theme/tokens";

export default function MagicTokenRoute() {
  const params = useLocalSearchParams<{ token_hash?: string; token?: string }>();
  const router = useRouter();
  const hydrate = useAuthStore((state) => state.hydrate);
  const tokenHash = params.token_hash ?? params.token;
  const [message, setMessage] = useState(tokenHash ? "Securing your session..." : "This sign-in link is incomplete.");

  useEffect(() => {
    if (!tokenHash) return;
    void postJson<{ token_hash: string }, { status: string }>("/auth/magic/validate", { token_hash: tokenHash })
      .then(async (result) => {
        if (result.status !== "authenticated") throw new Error("Additional verification is required on the web.");
        await hydrate();
        router.replace("/onboarding");
      })
      .catch((error: unknown) => setMessage(error instanceof Error ? error.message : "This sign-in link is invalid or expired."));
  }, [hydrate, router, tokenHash]);

  return <View style={styles.root}><ActivityIndicator color={palette.silver100} /><Text style={styles.message}>{message}</Text></View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.lg, backgroundColor: palette.page, padding: spacing.xl },
  message: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, textAlign: "center" },
});
