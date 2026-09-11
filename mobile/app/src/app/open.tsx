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
    void readLocalOnboardingState().then((onboarding) => router.replace(onboarding.complete || onboarding.previewComplete ? "/auth" : "/onboarding"));
  }, [router, status]);

  return <View style={styles.root} />;
}

const styles = StyleSheet.create({ root: { backgroundColor: palette.page, flex: 1 } });
