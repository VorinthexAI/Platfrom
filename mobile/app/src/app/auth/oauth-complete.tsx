import { useLocalSearchParams, useRouter } from "expo-router";
import { useEffect } from "react";

import { AuthSplashScreen } from "@/components/AuthSplashScreen";
import { exchangeOAuthCode } from "@/lib/oauth";
import { useAuthStore } from "@/state/auth";

export default function OAuthCompleteRoute() {
  const { code, error } = useLocalSearchParams<{ code?: string; error?: string }>();
  const router = useRouter();
  const hydrate = useAuthStore((state) => state.hydrate);

  useEffect(() => {
    if (error || !code) {
      router.replace({ pathname: "/auth", params: { oauth_error: "1" } });
      return;
    }
    void exchangeOAuthCode(code)
      .then(() => hydrate({ newSession: true }))
      .catch(() => router.replace({ pathname: "/auth", params: { oauth_error: "1" } }));
  }, [code, error, hydrate, router]);

  return <AuthSplashScreen />;
}
