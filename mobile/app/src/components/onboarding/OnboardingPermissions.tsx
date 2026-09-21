import { Button } from "@vorinthex/shared/ui/button";
import { BellIcon } from "@vorinthex/shared/ui/icons-mobile";
import * as Notifications from "expo-notifications";
import { useEffect, useEffectEvent, useState } from "react";
import { AppState, Linking, Platform, StyleSheet, Text } from "react-native";

import { OnboardingStepLayout } from "@/components/onboarding/OnboardingStepLayout";
import { recordOnboardingEvent } from "@/lib/onboarding-events";
import { fonts, palette } from "@/theme/tokens";
import { syncPushSubscription } from "@/lib/push-notifications";

type PermissionStep = "notifications";
type Recovery = "request" | "settings";

const STEPS: readonly PermissionStep[] = ["notifications"];
const PRESENTATION = {
  notifications: { title: "Allow notifications", description: "Stay up to date with updates and never miss anything.", Icon: BellIcon },
} as const;

function settingsInstructions() {
  return Platform.OS === "ios"
    ? "Open Settings, choose Notifications, then turn on Allow Notifications. Return here when finished."
    : "Open App settings, choose Notifications, then turn on Allow notifications. Return here when finished.";
}

async function accessIsEnabled() {
  return (await Notifications.getPermissionsAsync()).granted;
}

export function OnboardingPermissions({ onFinished }: { onFinished: () => void }) {
  const [index, setIndex] = useState(0);
  const [recovery, setRecovery] = useState<Recovery>("request");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const step = STEPS[index] ?? "notifications";
  const presentation = PRESENTATION[step];
  const StepIcon = presentation.Icon;
  const advanceAfterSettings = useEffectEvent(() => next());

  useEffect(() => { void recordOnboardingEvent(`onboarding.${step}`).catch(() => undefined); }, [step]);

  useEffect(() => {
    if (recovery !== "settings") return;
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") return;
      void accessIsEnabled().then((enabled) => { if (enabled) advanceAfterSettings(); }).catch(() => undefined);
    });
    return () => subscription.remove();
  }, [recovery, step]);

  function next() {
    const nextIndex = index + 1;
    if (nextIndex >= STEPS.length) onFinished();
    else {
      setIndex(nextIndex);
      setRecovery("request");
      setError("");
    }
  }

  async function request() {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      if (recovery === "settings") {
        await Linking.openSettings();
        return;
      }
      if (step === "notifications") {
        if (Platform.OS === "android") await Notifications.setNotificationChannelAsync("default", { importance: Notifications.AndroidImportance.DEFAULT, name: "Notifications" });
        const permission = await Notifications.requestPermissionsAsync({ ios: { allowAlert: true, allowBadge: true, allowSound: true } });
        if (permission.granted) {
          await syncPushSubscription().catch(() => undefined);
          next();
        } else {
          setRecovery(permission.canAskAgain ? "request" : "settings");
          setError(permission.canAskAgain ? "Notifications were not enabled. Tap Allow to try again, or use the close button to continue without them." : settingsInstructions());
        }
        return;
      }
    } catch {
      setError(settingsInstructions());
      setRecovery("settings");
    } finally {
      setBusy(false);
    }
  }

  return <OnboardingStepLayout
    action={<Button disabled={busy} onPress={() => void request()} size="md" variant="primary">{recovery === "settings" ? "Open settings" : "Allow"}</Button>}
    closeDisabled={busy}
    closeLabel={`Close ${step} access`}
    description={presentation.description}
    icon={<StepIcon size="lg" />}
    onClose={next}
    title={presentation.title}
  >{error ? <Text accessibilityRole="alert" style={recovery === "settings" ? styles.instructions : styles.error}>{error}</Text> : null}</OnboardingStepLayout>;
}

const styles = StyleSheet.create({
  instructions: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 14, lineHeight: 21, maxWidth: 350, textAlign: "center" },
  error: { color: palette.danger, fontFamily: fonts.regular, fontSize: 13, lineHeight: 19, textAlign: "center" },
});
