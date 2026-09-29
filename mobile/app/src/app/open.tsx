import { useRouter, type Href } from "expo-router";
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
      router.replace((useAuthStore.getState().user?.isOnboarded ? "/home" : "/onboarding") as Href);
      return;
    }
    let active = true;
    void readLocalOnboardingState().then(() => { if (active && useAuthStore.getState().status === "unauthenticated") router.replace("/auth"); });
    return () => { active = false; };
  }, [router, status]);

  return <View style={styles.root} />;
}

const styles = StyleSheet.create({ root: { backgroundColor: palette.page, flex: 1 } });
