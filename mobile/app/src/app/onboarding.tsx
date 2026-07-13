import { useRouter } from "expo-router";
import { useCallback } from "react";
import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { CardStack } from "@/components/onboarding/CardStack";
import { palette } from "@/theme/tokens";

/** Five-card gesture-led onboarding: Archive, Gallery, Signal, Compass, Ascend. */
export default function OnboardingRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const handleComplete = useCallback(() => {
    router.replace("/building");
  }, [router]);

  return (
    <View
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 4 }]}
    >
      <CardStack onComplete={handleComplete} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.page,
  },
});
