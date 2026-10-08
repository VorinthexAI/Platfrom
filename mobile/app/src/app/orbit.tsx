import { StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { SendIcon } from "@vorinthex/shared/ui/icons-mobile";

import { AgentSwitcher } from "@/components/AgentSwitcher";
import { ChromeIcon } from "@/components/ChromeIcon";
import { PersistentCoreComposer } from "@/components/PersistentCoreComposer";
import { ProfileHeaderRight } from "@/components/ProfileAvatarButton";
import { assistantIconSource } from "@/data/capability-icons";
import { CORE_PLACEHOLDER_PROMPTS } from "@/data/core-prompts";
import { palette, spacing } from "@/theme/tokens";

export default function OrbitRoute() {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <AgentSwitcher />
        <ProfileHeaderRight />
      </View>
      <PersistentCoreComposer
        accessibilityLabel="Ask Orbit"
        expandedPrompts={[...CORE_PLACEHOLDER_PROMPTS]}
        generationMode="chat"
        leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />}
        onChangeText={() => undefined}
        onSubmit={() => undefined}
        openOnMount
        pageIdentity={() => <AgentSwitcher />}
        prompts={CORE_PLACEHOLDER_PROMPTS}
        sendIcon={<SendIcon size="sm" />}
        value=""
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  header: {
    minHeight: 64,
    paddingBottom: 8,
    paddingHorizontal: spacing.md,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    borderBottomColor: palette.hairline,
    borderBottomWidth: 1,
  },
});
