import { useQuery } from "@tanstack/react-query";
import { StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { PlusIcon } from "@vorinthex/shared/ui/icons-mobile";

import { GalleryThumb } from "@/components/capability/GalleryThumb";
import { PressableScale } from "@/components/PressableScale";
import { fetchCapabilityContent } from "@/data/mock";
import { useUiStore, type GalleryTab } from "@/state/ui";
import { fonts, palette, spacing, tracking } from "@/theme/tokens";

const TABS: { key: GalleryTab; label: string }[] = [
  { key: "all", label: "ALL" },
  { key: "collections", label: "COLLECTIONS" },
  { key: "favorites", label: "FAVORITES" },
];

const GRID_GAP = 8;
const COLUMNS = 3;

export function GalleryContent() {
  const { width } = useWindowDimensions();
  const tab = useUiStore((state) => state.galleryTab);
  const setTab = useUiStore((state) => state.setGalleryTab);

  const { data } = useQuery({
    queryKey: ["capability", "gallery"],
    queryFn: () => fetchCapabilityContent("gallery"),
  });

  const items = (data ?? []).filter((item) => {
    if (tab === "favorites") return item.favorite;
    if (tab === "collections") return item.collection !== undefined;
    return true;
  });

  const thumbSize = Math.floor(
    (width - spacing.lg * 2 - GRID_GAP * (COLUMNS - 1)) / COLUMNS,
  );

  return (
    <View>
      <View style={styles.tabs}>
        {TABS.map(({ key, label }) => (
          <PressableScale
            key={key}
            accessibilityRole="tab"
            accessibilityLabel={label}
            accessibilityState={{ selected: tab === key }}
            onPress={() => setTab(key)}
            style={styles.tab}
          >
            <Text style={[styles.tabText, tab === key && styles.tabTextActive]}>{label}</Text>
            <View style={[styles.tabLine, tab === key && styles.tabLineActive]} />
          </PressableScale>
        ))}
      </View>

      <View style={styles.grid}>
        {items.map((item) => (
          <GalleryThumb key={item.id} variant={item.variant} seed={item.seed} size={thumbSize} />
        ))}
      </View>

      <PressableScale
        accessibilityRole="button"
        accessibilityLabel="Create image"
        style={styles.fab}
      >
        <PlusIcon size="md" variant="accent" />
      </PressableScale>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: {
    flexDirection: "row",
    gap: 22,
    marginBottom: 16,
  },
  tab: {
    alignItems: "center",
    gap: 6,
  },
  tabText: {
    color: palette.silver500,
    fontFamily: fonts.medium,
    fontSize: 11,
    letterSpacing: tracking.micro,
  },
  tabTextActive: {
    color: palette.silver50,
  },
  tabLine: {
    alignSelf: "stretch",
    height: 1.5,
    borderRadius: 1,
    backgroundColor: "transparent",
  },
  tabLineActive: {
    backgroundColor: palette.silver100,
  },
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: GRID_GAP,
  },
  fab: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 46,
    height: 46,
    borderRadius: 23,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: palette.panelRaised,
    borderWidth: 1,
    borderColor: palette.hairlineBright,
    shadowColor: palette.voidBlack,
    shadowOpacity: 0.5,
    shadowRadius: 14,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
});
