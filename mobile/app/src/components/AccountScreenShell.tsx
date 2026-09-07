import type { ReactNode } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useRouter } from "expo-router";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Button } from "@vorinthex/shared/ui/button";
import { ChevronLeftIcon, SendIcon } from "@vorinthex/shared/ui/icons-mobile";

import { ChromeIcon } from "@/components/ChromeIcon";
import { PersistentCoreComposer } from "@/components/PersistentCoreComposer";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { assistantIconSource } from "@/data/capability-icons";
import { useAppsStore } from "@/state/apps";
import { fonts, palette, spacing } from "@/theme/tokens";

const CORE_PROMPTS = ["Ask anything", "Find something across your work", "Help me plan my next step"] as const;

export function AccountScreenShell({ children, rightAction, title }: { children: ReactNode; rightAction?: ReactNode; title: string }) {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const active = useAppsStore((state) => state.workspaceSelection) ?? "archive";

  return <View style={styles.root}>
    <View style={[styles.header, { paddingLeft: Math.max(insets.left, spacing.md), paddingRight: Math.max(insets.right, spacing.md), paddingTop: insets.top + 6 }]}>
      <Button accessibilityLabel={`Back from ${title}`} contentMode="raw" iconOnly onPress={() => router.back()} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button>
      <Text numberOfLines={1} style={styles.title}>{title}</Text>
      <View style={styles.headerAction}>{rightAction}</View>
    </View>
    <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={styles.viewport}>{children}</ScrollView>
    <PersistentCoreComposer
      accessibilityHint="Ask Core from this screen"
      accessibilityLabel="Ask Core"
      leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />}
      onChangeText={() => undefined}
      onSubmit={() => undefined}
      pageIdentity={(closeCore) => <WorkspaceAppSwitcher active={active} identity="core" onSelectActive={closeCore} />}
      prompts={CORE_PROMPTS}
      sendIcon={<SendIcon size="sm" />}
      value=""
    />
  </View>;
}

const styles = StyleSheet.create({
  root: { backgroundColor: palette.page, flex: 1 },
  header: { alignItems: "center", borderBottomColor: palette.hairline, borderBottomWidth: 1, flexDirection: "row", gap: spacing.sm, minHeight: 64, paddingBottom: 8 },
  title: { color: palette.silver50, flex: 1, fontFamily: fonts.medium, fontSize: 24 },
  headerAction: { alignItems: "flex-end", minWidth: 32 },
  viewport: { flex: 1, minHeight: 0 },
  content: { flexGrow: 1 },
});
