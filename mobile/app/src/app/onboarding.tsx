import { useRouter } from "expo-router";
import { useCallback, useState } from "react";
import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@vorinthex/shared/ui/button";

import { CardStack } from "@/components/onboarding/CardStack";
import { palette } from "@/theme/tokens";
import { useAuthStore } from "@/state/auth";

/** Five-card gesture-led onboarding: Archive, Gallery, Signal, Compass, Ascend. */
export default function OnboardingRoute() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const completeOnboarding = useAuthStore((state) => state.completeOnboarding);
  const [completionError, setCompletionError] = useState<string>();
  const [completing, setCompleting] = useState(false);

  const handleComplete = useCallback(async () => {
    if (completing) return;
    setCompleting(true);
    setCompletionError(undefined);
    try {
      await completeOnboarding();
      router.replace("/capability/archive");
    } catch (error) {
      setCompletionError(error instanceof Error ? error.message : "Onboarding could not be completed.");
    } finally {
      setCompleting(false);
    }
  }, [completeOnboarding, completing, router]);

  return (
    <View
      style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom + 4 }]}
    >
      <CardStack onComplete={handleComplete} />
      {completionError ? (
        <View style={styles.retry}>
          <Text style={styles.error}>{completionError}</Text>
          <Button loading={completing} onPress={() => void handleComplete()} size="md" variant="primary">Retry completion</Button>
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: palette.page,
  },
  retry: { position: "absolute", right: 24, bottom: 28, left: 24, gap: 12 },
  error: { color: palette.silver300, textAlign: "center" },
});
