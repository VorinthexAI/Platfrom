import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { DownloadIcon, SignalIcon } from "@vorinthex/shared/ui/icons-mobile";
import Constants from "expo-constants";
import { useState } from "react";
import { Linking, Platform, StyleSheet, Text, View } from "react-native";

import { appStoreUrl, shouldPromptForAppUpdate } from "@/lib/app-update";
import type { HealthResponse } from "@/lib/product-client";
import { fonts, palette, spacing } from "@/theme/tokens";

export function AppAvailabilitySheets({ isOffline, health }: { isOffline: boolean; health: HealthResponse | null }) {
  const availableVersion = health?.appVersion;
  const [dismissedVersion, setDismissedVersion] = useState<string | null>(null);
  const installedVersion = Constants.expoConfig?.version;
  const updateOpen = !isOffline && shouldPromptForAppUpdate(installedVersion, availableVersion, dismissedVersion);

  const closeUpdate = () => {
    if (availableVersion) setDismissedVersion(availableVersion);
  };

  const openStore = () => {
    if (!health) return;
    const url = appStoreUrl(Platform.OS, health);
    if (url) void Linking.openURL(url).catch(() => undefined);
  };

  return <>
    <BottomSheet
      dismissible={false}
      height="full"
      hideCloseButton
      hideHeading
      onOpenChange={() => undefined}
      open={isOffline}
      title="No internet connection"
    >
      <View style={styles.offlineContent}>
        <View style={styles.iconFrame}><SignalIcon size="lg" variant="muted" /></View>
        <Text accessibilityRole="header" style={styles.offlineTitle}>Connection lost</Text>
        <Text style={styles.offlineDescription}>The app needs an internet connection. This screen will close automatically when you are back online.</Text>
      </View>
    </BottomSheet>

    <BottomSheet
      description="A new version of the app is available."
      footer={<><Button icon={<DownloadIcon size="sm" />} onPress={openStore} size="md" variant="primary">Update</Button><Button onPress={closeUpdate} size="md" variant="secondary">Close</Button></>}
      onOpenChange={(open) => { if (!open) closeUpdate(); }}
      open={updateOpen}
      title="Update app"
    />
  </>;
}

const styles = StyleSheet.create({
  offlineContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.md,
    paddingHorizontal: spacing.xl,
    paddingBottom: 72,
  },
  iconFrame: {
    alignItems: "center",
    justifyContent: "center",
    width: 72,
    height: 72,
    marginBottom: spacing.sm,
    borderWidth: 1,
    borderColor: palette.hairlineBright,
    borderRadius: 36,
    backgroundColor: palette.insetHighlight,
  },
  offlineTitle: {
    color: palette.text,
    fontFamily: fonts.medium,
    fontSize: 24,
    letterSpacing: -0.5,
    textAlign: "center",
  },
  offlineDescription: {
    maxWidth: 340,
    color: palette.muted,
    fontFamily: fonts.regular,
    fontSize: 15,
    lineHeight: 22,
    textAlign: "center",
  },
});
