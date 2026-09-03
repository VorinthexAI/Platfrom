import { useQueries, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo } from "react";
import { FlatList, StyleSheet, Text, View } from "react-native";
import { ActionPill } from "@vorinthex/shared/ui/action-pill";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";

import { appSearchQueryKey, searchApp } from "@/lib/app-search-client";
import type { ConversationRetrieval } from "@/lib/conversation-client";
import { filterConversationRetrievalResults, mergeConversationRetrievalResults, validConversationRetrievalIdentities, type ConversationRetrievalResult } from "@/lib/conversation-retrievals";
import { palette, spacing } from "@/theme/tokens";

type ConversationRetrievalSheetProps = {
  contextIdentity: string;
  onClose: () => void;
  onNavigate: (result: ConversationRetrievalResult) => void;
  open: boolean;
  retrievals: readonly ConversationRetrieval[];
};

export function ConversationRetrievalSheet({ contextIdentity, onClose, onNavigate, open, retrievals }: ConversationRetrievalSheetProps) {
  const queryClient = useQueryClient();
  const searchable = useMemo(() => retrievals.filter((retrieval) => retrieval.source !== "results"), [retrievals]);
  const inputs = searchable.map((retrieval) => ({ retrieval, input: { query: retrieval.query!, collectionSlugs: retrieval.searchCollectionSlugs ?? [...new Set(retrieval.groups.map(({ collectionSlug }) => collectionSlug))], recordHistory: false as const, limit: retrieval.limit, ...(retrieval.filters ? { filters: retrieval.filters } : {}) } }));
  const queries = useQueries({
    queries: inputs.map(({ input }) => ({ queryKey: appSearchQueryKey(contextIdentity, input), queryFn: ({ signal }: { signal: AbortSignal }) => searchApp(input, signal), enabled: open, refetchOnMount: "always" as const, staleTime: 0 })),
  });
  useEffect(() => {
    if (!open) return;
    const keys = searchable.map((retrieval) => appSearchQueryKey(contextIdentity, { query: retrieval.query!, collectionSlugs: retrieval.searchCollectionSlugs ?? [...new Set(retrieval.groups.map(({ collectionSlug }) => collectionSlug))], recordHistory: false, limit: retrieval.limit, ...(retrieval.filters ? { filters: retrieval.filters } : {}) }));
    return () => { keys.forEach((queryKey) => queryClient.removeQueries({ queryKey, exact: true })); };
  }, [contextIdentity, open, queryClient, searchable]);
  const merged = mergeConversationRetrievalResults(retrievals);
  const validations = new Map<ConversationRetrieval, ReadonlySet<string>>();
  queries.forEach((query, index) => {
    const retrieval = inputs[index]?.retrieval;
    if (retrieval && query.data) validations.set(retrieval, validConversationRetrievalIdentities(retrieval, query.data));
  });
  const visible = filterConversationRetrievalResults(merged, validations);
  const failed = queries.some(({ isError }) => isError);

  return <BottomSheet height="full" onOpenChange={(next) => { if (!next) onClose(); }} open={open} title="Search results">
    <FlatList contentContainerStyle={[styles.results, visible.length === 0 && styles.emptyResults]} data={visible} initialNumToRender={12} keyboardShouldPersistTaps="handled" keyExtractor={(result) => `${result.collectionSlug}:${result.key}`} ListEmptyComponent={!queries.some(({ isPending, isFetching }) => isPending || isFetching) && !failed ? <Text style={styles.empty}>These results are no longer available.</Text> : null} ListHeaderComponent={failed ? <View accessibilityRole="alert" style={styles.error}><Text style={styles.errorText}>Some results could not be checked.</Text><Button onPress={() => { queries.forEach((query) => { if (query.isError) void query.refetch(); }); }} size="md" variant="secondary">Retry</Button></View> : null} maxToRenderPerBatch={12} renderItem={({ item }) => <ActionPill compact onPress={() => onNavigate(item)} pressLabel={`Open ${item.label}`}><Text numberOfLines={1} style={styles.label}>{item.label}</Text></ActionPill>} showsVerticalScrollIndicator={false} style={styles.scroll} updateCellsBatchingPeriod={50} windowSize={7} />
  </BottomSheet>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  results: { flexGrow: 1, gap: spacing.xs, paddingBottom: spacing.xl },
  emptyResults: { justifyContent: "center" },
  label: { minWidth: 0, flex: 1, color: palette.text, fontSize: 13 },
  empty: { color: palette.muted, fontSize: 13, textAlign: "center" },
  error: { gap: spacing.sm, marginBottom: spacing.sm },
  errorText: { color: palette.danger, fontSize: 12, textAlign: "center" },
});
