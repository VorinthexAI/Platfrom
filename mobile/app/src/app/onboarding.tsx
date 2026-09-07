import { useRouter } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { OnboardingIntroSequence } from "@/components/onboarding/OnboardingIntroSequence";
import { OnboardingCoreSandbox } from "@/components/onboarding/OnboardingCoreSandbox";
import { OnboardingPermissions } from "@/components/onboarding/OnboardingPermissions";
import { OnboardingReward } from "@/components/onboarding/OnboardingReward";
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
  const [phase, setPhase] = useState<"intro" | "sandbox" | "paywall" | "reward" | "permissions">(initialPage === "referral" || authStatus === "authenticated" ? "paywall" : "intro");
  const apps = useAppsStore((state) => state.apps);
  const alreadyOnboarded = useRef(useAuthStore.getState().user?.isOnboarded === true);
  useEffect(() => {
    if (alreadyOnboarded.current) router.replace("/capability/archive");
  }, [router]);
  const handleComplete = useCallback(() => {
    const completion = completeOnboarding();
    router.replace("/capability/archive");
    void completion.catch(() => router.replace("/onboarding"));
  }, [completeOnboarding, router]);
  const startAuth = useCallback(async () => {
    await markOnboardingPreviewComplete();
    router.replace("/auth");
  }, [router]);

  return <View style={styles.root}>{phase === "permissions"
    ? <OnboardingPermissions onFinished={handleComplete} />
    : phase === "reward"
      ? <OnboardingReward onFinished={() => setPhase("permissions")} />
      : phase === "paywall"
        ? <PaywallSheet initialPage={initialPage} mode="onboarding" onComplete={() => setPhase("reward")} />
    : phase === "sandbox"
      ? <OnboardingCoreSandbox onFinished={() => void startAuth()} />
      : <OnboardingIntroSequence apps={apps} onFinished={() => setPhase("sandbox")} />}
  </View>;
}

const styles = StyleSheet.create({ root: { backgroundColor: palette.page, flex: 1 } });
