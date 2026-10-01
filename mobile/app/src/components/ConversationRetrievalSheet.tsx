import { useQuery } from "@tanstack/react-query";
import { ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { FileIcon, FolderIcon } from "@vorinthex/shared/ui/icons-mobile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";

import { ContentFileTile } from "@/components/ContentFileTile";
import type { ConversationRetrieval } from "@/lib/conversation-client";
import { mergeConversationRetrievalResults, type ConversationRetrievalResult } from "@/lib/conversation-retrievals";
import { findContentFile, type ContentFile } from "@/lib/content-client";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

type ConversationRetrievalSheetProps = {
  onClose: () => void;
  onNavigate: (result: ConversationRetrievalResult) => void;
  open: boolean;
  retrievals: readonly ConversationRetrieval[];
};

export function ConversationRetrievalSheet({ onClose, onNavigate, open, retrievals }: ConversationRetrievalSheetProps) {
  const { width } = useWindowDimensions();
  const cardSize = Math.floor((width - 20 * 2 - 2 - 8 * 3) / 4);
  const visible = mergeConversationRetrievalResults(retrievals);
  const files = useQuery({
    queryKey: ["conversation-result-files", visible.filter((item) => item.collectionSlug === "files").map((item) => item.key)],
    queryFn: async () => Promise.all(visible.filter((item) => item.collectionSlug === "files").map(async (item) => findContentFile(item.key).catch(() => undefined))),
    enabled: open && visible.some((item) => item.collectionSlug === "files"),
  });
  const fileMap = new Map(files.data?.filter((file): file is ContentFile => Boolean(file)).map((file) => [file.key, file]) ?? []);

  return <BottomSheet footer={<Button onPress={onClose} size="md" variant="secondary">Close</Button>} height="full" onOpenChange={(next) => { if (!next) onClose(); }} open={open} title="Search results">
    {visible.length ? <ScrollView contentContainerStyle={styles.results} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}><View style={styles.grid}>{visible.map((item) => {
      if (item.collectionSlug === "files") {
        const file = fileMap.get(item.key);
        if (file) return <ContentFileTile accessibilityLabel={`Open ${file.name}`} file={file} key={`file:${item.key}`} onPress={() => onNavigate(item)} size={cardSize} />;
        if (files.isPending) return <Skeleton key={`file:${item.key}`} style={[styles.card, { width: cardSize, height: cardSize }]} />;
      }
      return <View key={`${item.collectionSlug}:${item.key}`} style={[styles.card, { width: cardSize, height: cardSize }]}><Button accessibilityLabel={`Open ${item.label}`} contentMode="raw" onPress={() => onNavigate(item)} shape="rounded" size="xl" style={styles.cardMain} variant="ghost">{item.collectionSlug === "folders" ? <FolderIcon size="lg" /> : <FileIcon size="lg" />}<Text ellipsizeMode="tail" numberOfLines={1} style={styles.cardLabel}>{item.label}</Text></Button></View>;
    })}</View></ScrollView> : <View style={styles.emptyResults}><Text style={styles.empty}>No search results were returned.</Text></View>}
  </BottomSheet>;
}

const styles = StyleSheet.create({
  results: { flexGrow: 1, paddingBottom: spacing.xl },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  card: { borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised, overflow: "hidden" },
  cardMain: { height: "100%", width: "100%", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 10, paddingHorizontal: 8, paddingVertical: 0 },
  cardLabel: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  emptyResults: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { color: palette.muted, fontSize: 13, textAlign: "center" },
});
