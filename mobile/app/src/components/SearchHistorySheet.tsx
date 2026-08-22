import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { SearchHistoryPill } from "@vorinthex/shared/ui/search-history-pill";

import type { ContentSearchHistoryItem } from "@/lib/content-client";
import { fonts, palette, spacing } from "@/theme/tokens";

type SearchHistorySheetProps = {
  error?: string;
  history: ContentSearchHistoryItem[];
  loading: boolean;
  onClose: () => void;
  onOpenChange?: (open: boolean) => void;
  onRemove: (item: ContentSearchHistoryItem) => void;
  onSelect: (item: ContentSearchHistoryItem) => void;
  open: boolean;
  removingQuery?: string;
};

export function SearchHistorySheet({ error, history, loading, onClose, onOpenChange, onRemove, onSelect, open, removingQuery }: SearchHistorySheetProps) {
  return (
    <BottomSheet
      footer={<Button disabled={loading} onPress={onClose} size="md" variant="secondary">Close</Button>}
      height="full"
      onOpenChange={onOpenChange ?? ((nextOpen) => { if (!nextOpen) onClose(); })}
      open={open}
      title="Search history"
    >
      <ScrollView contentContainerStyle={[styles.list, !loading && history.length === 0 && styles.emptyContent]} showsVerticalScrollIndicator={false} style={styles.scroll}>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {loading ? <View accessibilityLabel="Loading search history" accessibilityRole="progressbar" style={styles.skeletons}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={styles.skeleton} />)}</View> : null}
        {!loading && history.length === 0 && !error ? <Text style={styles.empty}>No searches saved yet.</Text> : null}
        {!loading ? history.map((item) => <SearchHistoryPill count={item.usageCount} disabled={removingQuery === item.normalizedQuery} key={item.normalizedQuery} onPress={() => onSelect(item)} onRemove={() => { if (!removingQuery) onRemove(item); }} query={item.query} removing={removingQuery === item.normalizedQuery} />) : null}
      </ScrollView>
    </BottomSheet>
  );
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  list: { flexGrow: 1, gap: spacing.xs, paddingBottom: spacing.xl },
  emptyContent: { justifyContent: "center" },
  empty: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  error: { color: palette.danger, fontFamily: fonts.medium, fontSize: 13, textAlign: "center" },
  skeletons: { gap: spacing.xs },
  skeleton: { width: "100%", height: 38, borderRadius: 999, backgroundColor: palette.hairlineBright, opacity: 0.72 },
});
