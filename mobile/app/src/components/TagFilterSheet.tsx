import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { FilterPill } from "@vorinthex/shared/ui/filter-pill";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";

import type { ContentContext } from "@/lib/content-client";
import { refreshScopeTags } from "@/lib/tag-query-cache";
import { tagFilterContextKey, type ScopeTag } from "@/lib/tag-client";
import { EMPTY_SELECTED_TAGS, useUiStore } from "@/state/ui";
import { fonts, palette, spacing } from "@/theme/tokens";

type TagFilterSheetProps = { context: ContentContext; onClose: () => void; open: boolean };

export function TagFilterSheet({ context, onClose, open }: TagFilterSheetProps) {
  const queryClient = useQueryClient();
  const { organizationKey, scopeKey, userKey } = context;
  const contextKey = tagFilterContextKey(context);
  const selected = useUiStore((state) => state.selectedTagsByContext[contextKey] ?? EMPTY_SELECTED_TAGS);
  const setSelectedTags = useUiStore((state) => state.setSelectedTags);
  const [draftKeys, setDraftKeys] = useState<string[]>([]);
  const [tags, setTags] = useState<ScopeTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const requestRef = useRef(0);

  useEffect(() => {
    if (!open) return;
    const request = ++requestRef.current;
    setDraftKeys(selected.map(({ key }) => key));
    setLoading(true);
    setError(undefined);
    void refreshScopeTags(queryClient, { organizationKey, scopeKey, userKey }).then((items) => {
      if (request === requestRef.current) setTags(items);
    }).catch((caught) => {
      if (request === requestRef.current) setError(caught instanceof Error ? caught.message : "Tags could not be loaded.");
    }).finally(() => {
      if (request === requestRef.current) setLoading(false);
    });
    return () => { requestRef.current += 1; };
  }, [open, organizationKey, queryClient, scopeKey, selected, userKey]);

  const toggle = (key: string) => setDraftKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const apply = () => {
    const byKey = new Map(tags.map((tag) => [tag.key, tag]));
    setSelectedTags(contextKey, draftKeys.flatMap((key) => {
      const tag = byKey.get(key) ?? selected.find((item) => item.key === key);
      return tag ? [{ key: tag.key, name: tag.name }] : [];
    }));
    onClose();
  };

  return (
    <BottomSheet description="Select one or more tags to show items that have every selected tag." footer={<View style={styles.footer}><Button disabled={loading || Boolean(error)} onPress={apply} size="md" variant="primary">Filter</Button><Button onPress={onClose} size="md" variant="secondary">Close</Button></View>} height="full" onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} open={open} title="Tags">
      <ScrollView contentContainerStyle={[styles.list, !loading && tags.length === 0 && styles.emptyContent]} showsVerticalScrollIndicator={false} style={styles.scroll}>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {loading ? <View accessibilityLabel="Loading tags" accessibilityRole="progressbar" style={styles.list}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.skeleton} />)}</View> : null}
        {!loading && !error && tags.length === 0 ? <Text style={styles.empty}>No tags yet. Create a tag from an item's Tags menu, then return here to filter.</Text> : null}
        {!loading ? tags.map((tag) => <FilterPill fullWidth key={tag.key} label={tag.name} onPress={() => toggle(tag.key)} selected={draftKeys.includes(tag.key)} />) : null}
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
  skeleton: { width: "100%", height: 38, borderRadius: 999, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  footer: { gap: spacing.sm },
});
