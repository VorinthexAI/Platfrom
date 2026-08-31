import { ScrollView, StyleSheet, Text, View } from "react-native";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { SearchHistoryPill } from "@vorinthex/shared/ui/search-history-pill";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";

import type { GalleryGenerationHistoryItem } from "@/lib/gallery-client";
import { fonts, palette, spacing } from "@/theme/tokens";

type Props = {
  error?: string;
  history: GalleryGenerationHistoryItem[];
  loading: boolean;
  onClose: () => void;
  onRemove: (item: GalleryGenerationHistoryItem) => void;
  onSelect: (item: GalleryGenerationHistoryItem) => void;
  open: boolean;
  removingPrompt?: string;
};

export function GalleryGenerationHistory({ error, history, loading, onClose, onRemove, onSelect, open, removingPrompt }: Props) {
  return <BottomSheet footer={<Button disabled={loading} onPress={onClose} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={(next) => { if (!next) onClose(); }} open={open} title="Generation history">
    <ScrollView contentContainerStyle={[styles.list, !loading && history.length === 0 && styles.emptyContent]} showsVerticalScrollIndicator={false} style={styles.scroll}>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {loading ? <View accessibilityLabel="Loading generation history" accessibilityRole="progressbar" style={styles.list}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.skeleton} />)}</View> : null}
      {!loading && history.length === 0 && !error ? <Text style={styles.empty}>No generations saved yet.</Text> : null}
      {!loading ? history.map((item) => <SearchHistoryPill count={item.usageCount} disabled={removingPrompt === item.normalizedPrompt} key={item.normalizedPrompt} onPress={() => onSelect(item)} onRemove={() => { if (!removingPrompt) onRemove(item); }} query={item.prompt} removing={removingPrompt === item.normalizedPrompt} />) : null}
    </ScrollView>
  </BottomSheet>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  list: { flexGrow: 1, gap: spacing.xs, paddingBottom: spacing.xl },
  emptyContent: { justifyContent: "center" },
  empty: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" },
  error: { color: palette.danger, fontFamily: fonts.medium, fontSize: 13, textAlign: "center" },
  skeleton: { width: "100%", height: 38, borderRadius: 999, backgroundColor: palette.hairlineBright, opacity: 0.72 },
});
