import { Button } from "@vorinthex/shared/ui/button";
import { BellIcon, CameraIcon, GalleryIcon } from "@vorinthex/shared/ui/icons-mobile";
import * as ImagePicker from "expo-image-picker";
import * as Notifications from "expo-notifications";
import { useEffect, useEffectEvent, useState } from "react";
import { AppState, Linking, Platform, StyleSheet, Text } from "react-native";

import { OnboardingStepLayout } from "@/components/onboarding/OnboardingStepLayout";
import { recordOnboardingEvent } from "@/lib/onboarding-events";
import { fonts, palette } from "@/theme/tokens";
import { syncPushSubscription } from "@/lib/push-notifications";

type PermissionStep = "notifications" | "photos" | "camera";
type Recovery = "request" | "settings";

const STEPS: readonly PermissionStep[] = ["notifications", "photos", "camera"];
const PRESENTATION = {
  notifications: { title: "Allow notifications", description: "Stay up to date with updates and never miss anything.", Icon: BellIcon },
  photos: { title: "Allow Gallery", description: "Let Gallery organize, search, and enrich your photo library for the features you choose.", Icon: GalleryIcon },
  camera: { title: "Allow camera", description: "Use your camera to scan documents and capture images directly in Vorinthex.", Icon: CameraIcon },
} as const;

function settingsInstructions(step: PermissionStep) {
  if (step === "notifications") return Platform.OS === "ios"
    ? "Open Settings, choose Notifications, then turn on Allow Notifications. Return here when finished."
    : "Open App settings, choose Notifications, then turn on Allow notifications. Return here when finished.";
  if (step === "photos") return Platform.OS === "ios"
    ? "Open Settings, choose Photos, then select Full Access. Return here when finished."
    : "Open App settings, choose Photos and videos, then allow full access. Return here when finished.";
  return Platform.OS === "ios"
    ? "Open Settings, choose Camera, then turn on camera access. Return here when finished."
    : "Open App settings, choose Permissions, then allow Camera access. Return here when finished.";
}

async function accessIsEnabled(step: PermissionStep) {
  if (step === "notifications") return (await Notifications.getPermissionsAsync()).granted;
  if (step === "photos") {
    const permission = await ImagePicker.getMediaLibraryPermissionsAsync();
    return permission.granted && permission.accessPrivileges === "all";
  }
  return (await ImagePicker.getCameraPermissionsAsync()).granted;
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
      void accessIsEnabled(step).then((enabled) => { if (enabled) advanceAfterSettings(); }).catch(() => undefined);
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
          setError(permission.canAskAgain ? "Notifications were not enabled. Tap Allow to try again, or use the close button to continue without them." : settingsInstructions("notifications"));
        }
        return;
      }
      if (step === "photos") {
        const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
        if (permission.granted && permission.accessPrivileges === "all") next();
        else {
          setRecovery(permission.canAskAgain && permission.accessPrivileges !== "limited" ? "request" : "settings");
          setError(permission.accessPrivileges === "limited" ? settingsInstructions("photos") : permission.canAskAgain ? "Photo access was not enabled. Tap Allow to try again, or use the close button to continue." : settingsInstructions("photos"));
        }
        return;
      }
      const permission = await ImagePicker.requestCameraPermissionsAsync();
      if (permission.granted) next();
      else {
        setRecovery(permission.canAskAgain ? "request" : "settings");
        setError(permission.canAskAgain ? "Camera access was not enabled. Tap Allow to try again, or use the close button to continue." : settingsInstructions("camera"));
      }
    } catch {
      setError(settingsInstructions(step));
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
