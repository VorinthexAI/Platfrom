import { useLocalSearchParams, useRouter, type Href } from "expo-router";
import { useEffect, useRef } from "react";

import { AuthSplashScreen } from "@/components/AuthSplashScreen";
import { postJson } from "@/lib/api-client";
import { setPendingTeamMfaChallenge } from "@/lib/team-client";
import { useAuthStore } from "@/state/auth";

const TOKEN_HASH = /^[a-f0-9]{64}$/;

function firstParam(value: string | string[] | undefined) {
  return typeof value === "string" ? value : value?.[0];
}

function signedInHref(): Href {
  return useAuthStore.getState().user?.isOnboarded ? "/home" : "/onboarding";
}

export default function MagicTokenRoute() {
  const params = useLocalSearchParams<{ token_hash?: string | string[]; token?: string | string[] }>();
  const router = useRouter();
  const hydrate = useAuthStore((state) => state.hydrate);
  const tokenHash = firstParam(params.token_hash) ?? firstParam(params.token);
  const processedToken = useRef(false);

  useEffect(() => {
    if (processedToken.current) return;
    if (!tokenHash) return;
    processedToken.current = true;
    if (!TOKEN_HASH.test(tokenHash)) {
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
        if (useAuthStore.getState().status !== "authenticated") await useAuthStore.getState().bootstrap();
        if (useAuthStore.getState().status !== "authenticated") throw new Error("Sign in could not be completed.");
        router.replace(signedInHref());
      })
      .catch(() => router.replace({ pathname: "/auth", params: { link_error: "invalid" } }));
  }, [hydrate, router, tokenHash]);

  useEffect(() => {
    if (tokenHash || processedToken.current) return;
    const timer = setTimeout(() => {
      if (processedToken.current) return;
      processedToken.current = true;
      router.replace({ pathname: "/auth", params: { link_error: "invalid" } });
    }, 4000);
    return () => clearTimeout(timer);
  }, [router, tokenHash]);

  return <AuthSplashScreen />;
}
