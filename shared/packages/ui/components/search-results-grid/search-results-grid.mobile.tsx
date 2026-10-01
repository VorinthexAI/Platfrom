import type { ReactNode } from "react";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { Button } from "../button/button.mobile";
import { FileIcon } from "../../icons/file/file.mobile";
import { FolderIcon } from "../../icons/folder/folder.mobile";
import { colors } from "../../tokens";

export type SearchResultGridItem = { key: string; label: string; kind: "file" | "folder" };

export type SearchResultsGridProps<T extends SearchResultGridItem> = {
  items: readonly T[];
  onOpen: (item: T) => void;
  renderCover?: (item: T, size: number) => ReactNode;
  renderLabel?: (item: T) => ReactNode;
  horizontalInset?: number;
};

export function SearchResultsGrid<T extends SearchResultGridItem>({ items, onOpen, renderCover, renderLabel, horizontalInset = 20 }: SearchResultsGridProps<T>) {
  const { width } = useWindowDimensions();
  const size = Math.floor((width - horizontalInset * 2 - 24) / 4);
  return <View style={styles.grid}>{items.map((item) => <View key={`${item.kind}:${item.key}`} style={[styles.card, { width: size, height: size }]}>
    <Button accessibilityLabel={`Open ${item.label}`} contentMode="raw" onPress={() => onOpen(item)} shape="rounded" size="xl" style={styles.main} variant="ghost">
      {renderCover?.(item, size) ?? (item.kind === "folder" ? <FolderIcon size="lg" /> : <FileIcon size="lg" />)}
       {renderLabel ? renderLabel(item) : <Text ellipsizeMode="tail" numberOfLines={1} style={styles.label}>{item.label}</Text>}
    </Button>
  </View>)}</View>;
}

const styles = StyleSheet.create({
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { borderRadius: 14, borderWidth: 1, borderColor: colors.hairline, backgroundColor: colors.panelRaised, overflow: "hidden" },
  main: { height: "100%", width: "100%", flexDirection: "column", justifyContent: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 0 },
  label: { width: "100%", color: colors.accent, fontFamily: "Geist_500Medium", fontSize: 12, textAlign: "center" },
});
