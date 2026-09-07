import { Button } from "@vorinthex/shared/ui/button";
import { CheckIcon, WarningIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Spinner } from "@vorinthex/shared/ui/spinner";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { StyleSheet, Text, View } from "react-native";

import { postJson } from "@/lib/api-client";
import { setPendingTeamMfaChallenge } from "@/lib/team-client";
import { useAuthStore } from "@/state/auth";
import { fonts, palette, spacing } from "@/theme/tokens";

const TOKEN_HASH = /^[a-f0-9]{64}$/;
type LinkState = "invalid" | "processing" | "success" | "expired";

export default function MagicTokenRoute() {
  const params = useLocalSearchParams<{ token_hash?: string; token?: string }>();
  const router = useRouter();
  const hydrate = useAuthStore((state) => state.hydrate);
  const tokenHash = params.token_hash ?? params.token;
  const validTokenHash = tokenHash && TOKEN_HASH.test(tokenHash) ? tokenHash : null;
  const processedToken = useRef<string | null>(null);
  const [state, setState] = useState<LinkState>(validTokenHash ? "processing" : "invalid");
  const [message, setMessage] = useState(validTokenHash ? "Securing your session..." : "This sign-in link is incomplete or invalid.");

  useEffect(() => {
    if (!validTokenHash || processedToken.current === validTokenHash) return;
    processedToken.current = validTokenHash;
    router.setParams({ token_hash: undefined, token: undefined });
    void postJson<{ token_hash: string }, { status: string; totp_challenge_token_hash?: string }>("/auth/magic/validate", { token_hash: validTokenHash })
      .then(async (result) => {
        if ((result.status === "totp_setup_required" || result.status === "totp_required") && result.totp_challenge_token_hash) {
          setPendingTeamMfaChallenge(result.status === "totp_required" ? "totp_required" : "setup_required", result.totp_challenge_token_hash);
          router.replace("/auth/mfa");
          return;
        }
        if (result.status !== "authenticated") throw new Error("Additional verification is required.");
        setState("success");
        setMessage("Sign in complete. Opening your workspace...");
        await hydrate();
      })
      .catch(() => {
        setState("expired");
        setMessage("This sign-in link is invalid, expired, or has already been used.");
      });
  }, [hydrate, validTokenHash]);

  return <View style={styles.root}>
    <View style={styles.icon}>{state === "processing" ? <Spinner size="large" /> : state === "success" ? <CheckIcon size="lg" /> : <WarningIcon size="lg" variant="danger" />}</View>
    <Text accessibilityRole="header" style={styles.title}>{state === "processing" ? "Completing sign in" : state === "success" ? "You’re signed in" : "Link expired"}</Text>
    <Text accessibilityLiveRegion="polite" style={styles.message}>{message}</Text>
    {state === "expired" || state === "invalid" ? <Button onPress={() => router.replace("/auth")} size="lg" variant="primary">Request a new link</Button> : null}
  </View>;
}

const styles = StyleSheet.create({
  root: { alignItems: "center", backgroundColor: palette.page, flex: 1, gap: spacing.md, justifyContent: "center", padding: spacing.xl },
  icon: { alignItems: "center", height: 64, justifyContent: "center", width: 64 },
  title: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 30, lineHeight: 36, textAlign: "center" },
  message: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 23, maxWidth: 340, textAlign: "center" },
});
