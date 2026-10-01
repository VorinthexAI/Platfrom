import { StyleSheet, Text, View } from "react-native";
import { Button } from "../button/button.mobile";
import { CheckIcon } from "../../icons/check/check.mobile";
import { ChevronLeftIcon } from "../../icons/chevron-left/chevron-left.mobile";
import { FolderIcon } from "../../icons/folder/folder.mobile";
import { colors, radii } from "../../tokens";

export type FolderTileProps = { accessibilityLabel: string; busy?: boolean; label: string; onLongPress?: () => void; onPress: () => void; parent?: boolean; selected?: boolean; size: number };

export function FolderTile({ accessibilityLabel, busy = false, label, onLongPress, onPress, parent = false, selected = false, size }: FolderTileProps) {
  return <View style={[styles.card, selected && styles.selected, { width: size, height: size }]}>
    <Button accessibilityLabel={accessibilityLabel} accessibilityState={{ selected, busy }} contentMode="raw" onLongPress={onLongPress} onPress={onPress} shape="rounded" size="xl" style={styles.cardMain} variant="ghost">
      {parent ? <ChevronLeftIcon size="lg" /> : <FolderIcon size="lg" />}
      {!parent ? <Text ellipsizeMode="tail" numberOfLines={1} style={styles.cardLabel}>{label}</Text> : null}
    </Button>
    {selected ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
  </View>;
}

const styles = StyleSheet.create({
  card: { borderRadius: radii.md, borderColor: colors.hairline, borderWidth: 1, backgroundColor: colors.panelRaised, overflow: "hidden" },
  selected: { borderColor: colors.text, borderWidth: 2 },
  cardMain: { height: "100%", width: "100%", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 0 },
  cardLabel: { width: "100%", color: colors.accent, fontFamily: "Geist_300Light", fontSize: 12, textAlign: "center" },
  selectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: colors.text },
});
