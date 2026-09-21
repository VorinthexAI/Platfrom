import { FlatList, StyleSheet, Text, View } from "react-native";
import { ActionPill } from "@vorinthex/shared/ui/action-pill";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";

import type { ConversationRetrieval } from "@/lib/conversation-client";
import { mergeConversationRetrievalResults, type ConversationRetrievalResult } from "@/lib/conversation-retrievals";
import { palette, spacing } from "@/theme/tokens";

type ConversationRetrievalSheetProps = {
  onClose: () => void;
  onNavigate: (result: ConversationRetrievalResult) => void;
  open: boolean;
  retrievals: readonly ConversationRetrieval[];
};

export function ConversationRetrievalSheet({ onClose, onNavigate, open, retrievals }: ConversationRetrievalSheetProps) {
  const visible = mergeConversationRetrievalResults(retrievals);

  return <BottomSheet footer={<Button onPress={onClose} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={(next) => { if (!next) onClose(); }} open={open} title="Search results">
    <FlatList contentContainerStyle={[styles.results, visible.length === 0 && styles.emptyResults]} data={visible} initialNumToRender={12} keyboardShouldPersistTaps="handled" keyExtractor={(result) => `${result.collectionSlug}:${result.key}`} ListEmptyComponent={<Text style={styles.empty}>No search results were returned.</Text>} maxToRenderPerBatch={12} renderItem={({ item }) => <ActionPill compact onPress={() => onNavigate(item)} pressLabel={`Open ${item.label}`}><Text numberOfLines={1} style={styles.label}>{item.label}</Text></ActionPill>} showsVerticalScrollIndicator={false} style={styles.scroll} updateCellsBatchingPeriod={50} windowSize={7} />
  </BottomSheet>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  results: { flexGrow: 1, gap: spacing.xs, paddingBottom: spacing.xl },
  emptyResults: { justifyContent: "center" },
  label: { minWidth: 0, flex: 1, color: palette.text, fontSize: 13 },
  empty: { color: palette.muted, fontSize: 13, textAlign: "center" },
});
