import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useRef } from "react";

import { AuthSplashScreen } from "@/components/AuthSplashScreen";
import { postJson } from "@/lib/api-client";
import { setPendingTeamMfaChallenge } from "@/lib/team-client";
import { useAuthStore } from "@/state/auth";

const TOKEN_HASH = /^[a-f0-9]{64}$/;

export default function MagicTokenRoute() {
  const params = useLocalSearchParams<{ token_hash?: string; token?: string }>();
  const router = useRouter();
  const hydrate = useAuthStore((state) => state.hydrate);
  const tokenHash = useRef(params.token_hash ?? params.token).current;
  const processedToken = useRef(false);

  useEffect(() => {
    if (processedToken.current) return;
    processedToken.current = true;
    if (!tokenHash || !TOKEN_HASH.test(tokenHash)) {
      router.replace({ pathname: "/auth", params: { link_error: "invalid" } });
      return;
    }
    router.setParams({ token_hash: undefined, token: undefined });
    void postJson<{ token_hash: string }, { status: string; totp_challenge_token_hash?: string }>("/auth/magic/validate", { token_hash: tokenHash })
      .then(async (result) => {
        if ((result.status === "totp_setup_required" || result.status === "totp_required") && result.totp_challenge_token_hash) {
          setPendingTeamMfaChallenge(result.status === "totp_required" ? "totp_required" : "setup_required", result.totp_challenge_token_hash);
          router.replace("/auth/mfa");
          return;
        }
        if (result.status !== "authenticated") throw new Error("Sign in could not be completed.");
        await hydrate({ newSession: true });
      })
      .catch(() => router.replace({ pathname: "/auth", params: { link_error: "invalid" } }));
  }, [hydrate, router, tokenHash]);

  return <AuthSplashScreen />;
}
