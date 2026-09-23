import { useRouter } from "expo-router";
import { useEffect } from "react";
import { StyleSheet, View } from "react-native";

import { readLocalOnboardingState } from "@/lib/onboarding-state";
import { useAuthStore } from "@/state/auth";
import { palette } from "@/theme/tokens";

export default function OpenAppRoute() {
  const router = useRouter();
  const status = useAuthStore((state) => state.status);

  useEffect(() => {
    if (status === "bootstrapping") return;
    if (status === "authenticated") {
      router.replace(useAuthStore.getState().user?.isOnboarded ? "/capability/archive" : "/onboarding");
      return;
    }
    let active = true;
    void readLocalOnboardingState().then((onboarding) => { if (active && useAuthStore.getState().status === "unauthenticated") router.replace(onboarding.previewComplete ? "/auth" : "/onboarding"); });
    return () => { active = false; };
  }, [router, status]);

  return <View style={styles.root} />;
}

const styles = StyleSheet.create({ root: { backgroundColor: palette.page, flex: 1 } });
