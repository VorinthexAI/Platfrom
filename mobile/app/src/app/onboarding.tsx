import { useRouter, type Href } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import { StyleSheet, View } from "react-native";

import { OnboardingReward } from "@/components/onboarding/OnboardingReward";
import { PaywallSheet } from "@/components/PaywallSheet";
import { fetchBillingSummary, hasNewcomerAccountGrant } from "@/lib/billing-client";
import { getLocalOnboardingState } from "@/lib/onboarding-state";
import { useAuthStore } from "@/state/auth";
import { useUiStore } from "@/state/ui";
import { palette } from "@/theme/tokens";

export default function OnboardingRoute() {
  const router = useRouter();
  const completeOnboarding = useAuthStore((state) => state.completeOnboarding);
  const authStatus = useAuthStore((state) => state.status);
  const [initialPage] = useState<"plans" | "referral">(() => useUiStore.getState().consumeOnboardingReferralEntry() ? "referral" : "plans");
  const [postDeletion] = useState(() => getLocalOnboardingState().postDeletion);
  const [phase, setPhase] = useState<"paywall" | "reward">("paywall");
  const alreadyOnboarded = useRef(useAuthStore.getState().user?.isOnboarded === true);
  useEffect(() => {
    if (authStatus === "unauthenticated") router.replace("/auth");
  }, [authStatus, router]);
  useEffect(() => {
    if (alreadyOnboarded.current) router.replace("/home" as Href);
  }, [router]);
  const handleComplete = useCallback(() => {
    const completion = completeOnboarding();
    useUiStore.getState().requestAgentGreeting("onboarding");
    router.replace("/home" as Href);
    void completion.catch(() => { if (useAuthStore.getState().status === "authenticated") router.replace("/onboarding"); });
  }, [completeOnboarding, router]);

  return <View style={styles.root}>{phase === "reward"
    ? <OnboardingReward onFinished={handleComplete} />
    : <PaywallSheet initialPage={initialPage} mode="onboarding" onComplete={async () => {
      if (postDeletion) {
        handleComplete();
        return;
      }
      const summary = await fetchBillingSummary({ kind: "adjustment", limit: 200 });
      if (hasNewcomerAccountGrant(summary)) setPhase("reward");
      else handleComplete();
    }} />}
  </View>;
}

const styles = StyleSheet.create({ root: { backgroundColor: palette.page, flex: 1 } });
