import { StyleSheet, Text, View } from "react-native";

import { ChromeIcon } from "@/components/ChromeIcon";
import { vorinthexMarkSource } from "@/data/capability-icons";
import { fonts, palette, tracking } from "@/theme/tokens";

export function AuthSplashScreen() {
  return <View accessibilityLabel="Completing sign in" accessibilityRole="progressbar" style={styles.root}>
    <Text style={styles.wordmark}>VORINTHEX AI</Text>
    <ChromeIcon source={vorinthexMarkSource} size={150} glow={0.8} />
    <Text style={styles.tagline}>YOUR PERSONAL AI</Text>
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page, alignItems: "center", justifyContent: "center", gap: 52 },
  wordmark: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 15, letterSpacing: tracking.title, paddingLeft: tracking.title },
  tagline: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 12, letterSpacing: tracking.label + 1, paddingLeft: tracking.label + 1, lineHeight: 24, textAlign: "center" },
});
