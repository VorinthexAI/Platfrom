import { StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChromeIcon } from "@/components/ChromeIcon";
import { ProfileHeaderRight } from "@/components/ProfileAvatarButton";
import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { capabilityIconSource } from "@/data/capability-icons";
import { getCapability } from "@/data/registry";
import { fonts, palette, spacing } from "@/theme/tokens";

export function TeamWorkspace() {
  const insets = useSafeAreaInsets();
  const capability = getCapability("hq");
  return (
    <View style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <WorkspaceAppSwitcher active="hq" />
        <ProfileHeaderRight />
      </View>
      <View style={styles.welcome}>
        <ChromeIcon glow={0.55} size={72} source={capabilityIconSource.hq} />
        <Text style={styles.name}>{capability.name}</Text>
        <Text style={styles.tagline}>{capability.tagline}</Text>
        <Text style={styles.body}>Coordinate people, membership, and shared work in one private headquarters.</Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: palette.hairline, borderBottomWidth: 1 },
  welcome: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, paddingHorizontal: spacing.xl },
  name: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 22, textAlign: "center" },
  tagline: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 16, lineHeight: 24, textAlign: "center" },
  body: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 14, lineHeight: 22, textAlign: "center", maxWidth: 320 },
});
