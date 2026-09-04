import { StyleSheet, Text, View, type ViewProps } from "react-native";

import { Button } from "../button/button.mobile";
import { CloseIcon } from "../../icons/close/close.mobile";
import { colors } from "../../tokens";

export type FilterPillProps = Omit<ViewProps, "children"> & {
  disabled?: boolean;
  fullWidth?: boolean;
  label: string;
  mixed?: boolean;
  onPress: () => void;
  onRemove?: () => void;
  selected?: boolean;
};

export function FilterPill({ disabled, fullWidth = false, label, mixed = false, onPress, onRemove, selected = false, style, ...props }: FilterPillProps) {
  return (
    <View style={[styles.root, fullWidth && styles.fullWidth, selected && styles.selected, mixed && styles.mixed, style]} {...props}>
      <Button accessibilityLabel={`${mixed ? "Select for all" : selected ? "Deselect" : "Select"} ${label}`} accessibilityState={{ checked: mixed ? "mixed" : selected, selected }} contentMode="raw" disabled={disabled} onPress={onPress} size="md" style={[styles.labelButton, fullWidth && styles.grow]} variant="ghost">
        <Text numberOfLines={1} style={styles.label}>{label}</Text>
      </Button>
      {onRemove ? <Button accessibilityLabel={`Remove ${label} filter`} contentMode="raw" disabled={disabled} hitSlop={8} onPress={onRemove} size="md" style={styles.remove} variant="secondary"><CloseIcon size="sm" strokeWidth={1.2} /></Button> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { height: 38, minWidth: 0, padding: 2, flexDirection: "row", alignItems: "center", borderRadius: 999, borderColor: "rgba(221, 226, 229, 0.14)", borderWidth: 1, backgroundColor: colors.page },
  fullWidth: { width: "100%" },
  selected: { borderColor: "#F5F7F8" },
  mixed: { borderColor: "#9CA7AD", borderStyle: "dashed", backgroundColor: "rgba(245, 247, 248, 0.07)" },
  labelButton: { minWidth: 0, minHeight: 32, height: 32, paddingHorizontal: 10, paddingVertical: 0, overflow: "hidden" },
  grow: { flex: 1 },
  label: { color: "#F5F7F8", fontFamily: "Geist_500Medium", fontSize: 13 },
  remove: { width: 24, height: 24, minHeight: 24, marginRight: 4, paddingHorizontal: 0, paddingVertical: 0 },
});
