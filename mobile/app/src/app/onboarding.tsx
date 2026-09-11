import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { OnboardingCoreConversation } from "@/components/onboarding/OnboardingCoreConversation";
import { OnboardingReward } from "@/components/onboarding/OnboardingReward";
import { OnboardingProfileBadge } from "@/components/onboarding/OnboardingProfileBadge";
import { PaywallSheet } from "@/components/PaywallSheet";
import { markOnboardingPreviewComplete } from "@/lib/onboarding-state";
import { useAppsStore } from "@/state/apps";
import { useAuthStore } from "@/state/auth";
import { useUiStore } from "@/state/ui";
import { palette } from "@/theme/tokens";

export default function OnboardingRoute() {
  const router = useRouter();
  const completeOnboarding = useAuthStore((state) => state.completeOnboarding);
  const authStatus = useAuthStore((state) => state.status);
  const [initialPage] = useState<"plans" | "referral">(() => useUiStore.getState().consumeOnboardingReferralEntry() ? "referral" : "plans");
  const [phase, setPhase] = useState<"conversation" | "paywall" | "reward" | "profile-badge">(initialPage === "referral" || authStatus === "authenticated" ? "paywall" : "conversation");
  const apps = useAppsStore((state) => state.apps);
  const alreadyOnboarded = useRef(useAuthStore.getState().user?.isOnboarded === true);
  useEffect(() => {
    if (alreadyOnboarded.current) router.replace("/capability/archive");
  }, [router]);
  const handleComplete = useCallback(() => {
    const completion = completeOnboarding();
    useUiStore.getState().requestAgentGreeting("onboarding");
    router.replace("/capability/archive");
    void completion.catch(() => router.replace("/onboarding"));
  }, [completeOnboarding, router]);
  const startAuth = useCallback(async () => {
    await markOnboardingPreviewComplete();
    router.replace("/auth");
  }, [router]);

  return <View style={styles.root}>{phase === "profile-badge"
      ? <OnboardingProfileBadge onFinished={handleComplete} />
      : phase === "reward"
      ? <OnboardingReward onFinished={() => setPhase("profile-badge")} />
      : phase === "paywall"
        ? <PaywallSheet initialPage={initialPage} mode="onboarding" onComplete={() => setPhase("reward")} />
        : <OnboardingCoreConversation apps={apps} onFinished={() => void startAuth()} />}
  </View>;
}

const styles = StyleSheet.create({ root: { backgroundColor: palette.page, flex: 1 } });
