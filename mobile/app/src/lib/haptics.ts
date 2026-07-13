import * as Haptics from "expo-haptics";

/** Subtle haptics, silently skipped where unavailable. */
export function decisionHaptic(): void {
  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});
}

export function completionHaptic(): void {
  Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
}
