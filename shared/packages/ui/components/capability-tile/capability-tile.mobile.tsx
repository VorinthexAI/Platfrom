import type { ReactNode } from "react";
import { StyleSheet, Text, View } from "react-native";
import { Button } from "../button/button.mobile";
import { colors, radii } from "../../tokens";

export type CapabilityTileProps = { icon: ReactNode; label: string; onPress: () => void; size: number };

export function CapabilityTile({ icon, label, onPress, size }: CapabilityTileProps) {
  return <View style={[styles.card, { width: size, height: size }]}>
    <Button accessibilityLabel={`Open ${label}`} contentMode="raw" onPress={onPress} shape="rounded" size="xl" style={styles.button} variant="ghost">
      {icon}
      <Text numberOfLines={1} style={styles.label}>{label}</Text>
    </Button>
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.md, borderColor: colors.hairline, borderWidth: 1, backgroundColor: colors.panelRaised, overflow: "hidden" },
  button: { width: "100%", height: "100%", minHeight: 0, flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 5, paddingHorizontal: 2, paddingVertical: 0 },
  label: { color: colors.accent, fontFamily: "Geist_500Medium", fontSize: 10, textAlign: "center" },
});
