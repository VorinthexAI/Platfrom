import type { ReactNode } from "react";
import { StyleSheet, Text } from "react-native";
import { Button } from "../button/button.mobile";

export type RoleOptionCardProps = {
  description?: string;
  icon: ReactNode;
  label: string;
  onPress: () => void;
  selected: boolean;
  width: number;
};

export function RoleOptionCard({ description, icon, label, onPress, selected, width }: RoleOptionCardProps) {
  return <Button accessibilityHint={description} accessibilityLabel={`${label} role`} accessibilityState={{ selected }} contentMode="raw" onPress={onPress} shape="rounded" size="md" style={[styles.card, selected && styles.selected, { width }]} variant="secondary">
    {icon}
    <Text numberOfLines={2} style={styles.label}>{label}</Text>
  </Button>;
}

const styles = StyleSheet.create({
  card: { height: 94, minHeight: 94, flexDirection: "column", gap: 8, paddingHorizontal: 4, paddingVertical: 8 },
  selected: { borderColor: "#F5F7F8" },
  label: { color: "#DDE2E5", fontFamily: "Geist_500Medium", fontSize: 10, lineHeight: 13, textAlign: "center" },
});
