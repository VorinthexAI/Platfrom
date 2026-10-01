import { useEffect, useRef, useState, type ComponentRef } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { FilterPill } from "@vorinthex/shared/ui/filter-pill";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useSessionToast as useToast } from "@/hooks/use-session-toast";

import { TagCreateSheet, TagSheetEmptyState } from "@/components/TagSheetShared";
import type { ContentContext } from "@/lib/content-client";
import { refreshScopeTags, scopeTagsQueryKey } from "@/lib/tag-query-cache";
import { createResourceTagKey, createScopeTag, tagFilterContextKey, type ScopeTag } from "@/lib/tag-client";
import { EMPTY_SELECTED_TAGS, useUiStore } from "@/state/ui";
import { fonts, palette, spacing } from "@/theme/tokens";

type TagFilterSheetProps = { context: ContentContext; onClose: () => void; open: boolean };

export function TagFilterSheet({ context, onClose, open }: TagFilterSheetProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { scopeKey, userKey } = context;
  const contextKey = tagFilterContextKey(context);
  const selected = useUiStore((state) => state.selectedTagsByContext[contextKey] ?? EMPTY_SELECTED_TAGS);
  const setSelectedTags = useUiStore((state) => state.setSelectedTags);
  const [draftKeys, setDraftKeys] = useState<string[]>([]);
  const [tags, setTags] = useState<ScopeTag[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [tagName, setTagName] = useState("");
  const requestRef = useRef(0);
  const createSubmissionRef = useRef<string | undefined>(undefined);
  const createInputRef = useRef<ComponentRef<typeof TextInput>>(null);

  useEffect(() => {
    if (!open) return;
    const request = ++requestRef.current;
    const timeout = setTimeout(() => {
      setDraftKeys(selected.map(({ key }) => key));
      setLoading(true);
      setError(undefined);
      void refreshScopeTags(queryClient, { scopeKey, userKey }).then((items) => {
        if (request === requestRef.current) setTags(items);
      }).catch((caught) => {
        if (request === requestRef.current) setError(caught instanceof Error ? caught.message : "Tags could not be loaded.");
      }).finally(() => {
        if (request === requestRef.current) setLoading(false);
      });
    }, 0);
    return () => { clearTimeout(timeout); requestRef.current += 1; };
  }, [open, queryClient, scopeKey, selected, userKey]);

  useEffect(() => {
    if (!open) {
      const timeout = setTimeout(() => {
        setCreateOpen(false);
        setTagName("");
      }, 0);
      return () => clearTimeout(timeout);
    }
    if (!createOpen) return;
    const timeout = setTimeout(() => createInputRef.current?.focus(), 300);
    return () => clearTimeout(timeout);
  }, [createOpen, open]);

  const closeCreate = () => {
    setCreateOpen(false);
    setTagName("");
  };

  const createTag = () => {
    const name = tagName.trim();
    if (!name || createSubmissionRef.current) return;
    const key = createResourceTagKey();
    createSubmissionRef.current = key;
    const timestamp = new Date().toISOString();
    const optimistic: ScopeTag = { key, name, createdAt: timestamp, updatedAt: timestamp };
    closeCreate();
    setTags((current) => [...current.filter((tag) => tag.key !== key), optimistic]);
    queryClient.setQueryData<ScopeTag[]>(scopeTagsQueryKey(context), (current) => [...(current ?? []).filter((tag) => tag.key !== key), optimistic]);
    showToast({ title: "Tag created", duration: 2_000 });
    void createScopeTag(context, { key, name }).then((created) => {
      setTags((current) => current.map((tag) => tag.key === key ? created : tag));
      queryClient.setQueryData<ScopeTag[]>(scopeTagsQueryKey(context), (current) => current?.map((tag) => tag.key === key ? created : tag));
      void queryClient.invalidateQueries({ queryKey: ["file-search", scopeKey] });
    }).catch((caught) => {
      setTags((current) => current.filter((tag) => tag.key !== key));
      queryClient.setQueryData<ScopeTag[]>(scopeTagsQueryKey(context), (current) => current?.filter((tag) => tag.key !== key));
      const active = useUiStore.getState().selectedTagsByContext[contextKey] ?? EMPTY_SELECTED_TAGS;
      if (active.some((tag) => tag.key === key)) setSelectedTags(contextKey, active.filter((tag) => tag.key !== key));
      showToast({ title: caught instanceof Error ? caught.message : "Tag could not be created.", duration: 3_000 });
    }).finally(() => { if (createSubmissionRef.current === key) createSubmissionRef.current = undefined; });
  };

  const toggle = (key: string) => setDraftKeys((current) => current.includes(key) ? current.filter((item) => item !== key) : [...current, key]);
  const apply = () => {
    const byKey = new Map(tags.map((tag) => [tag.key, tag]));
    setSelectedTags(contextKey, draftKeys.flatMap((key) => {
      const tag = byKey.get(key) ?? selected.find((item) => item.key === key);
      return tag ? [{ key: tag.key, name: tag.name }] : [];
    }));
    onClose();
  };

  return <>
    <BottomSheet description="Select one or more tags to show items that have every selected tag." footer={<View style={styles.footer}><Button disabled={loading || Boolean(error)} onPress={tags.length === 0 ? () => setCreateOpen(true) : apply} size="md" variant="primary">{tags.length === 0 ? "Create tag" : "Filter"}</Button><Button onPress={onClose} size="md" variant="secondary">Close</Button></View>} height="full" onOpenChange={(nextOpen) => { if (!nextOpen) onClose(); }} open={open} title="Tags">
      <ScrollView contentContainerStyle={[styles.list, !loading && tags.length === 0 && styles.emptyContent]} showsVerticalScrollIndicator={false} style={styles.scroll}>
        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
        {loading ? <View accessibilityLabel="Loading tags" accessibilityRole="progressbar" style={styles.list}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.skeleton} />)}</View> : null}
        {!loading && !error && tags.length === 0 ? <TagSheetEmptyState onCreate={() => setCreateOpen(true)} /> : null}
        {!loading ? tags.map((tag) => <FilterPill fullWidth key={tag.key} label={tag.name} onPress={() => toggle(tag.key)} selected={draftKeys.includes(tag.key)} />) : null}
      </ScrollView>
    </BottomSheet>
     <TagCreateSheet inputRef={createInputRef} name={tagName} onClose={closeCreate} onCreate={createTag} onNameChange={setTagName} open={open && createOpen} />
  </>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 },
  list: { flexGrow: 1, gap: spacing.xs, paddingBottom: spacing.xl },
  emptyContent: { justifyContent: "center" },
  error: { color: palette.danger, fontFamily: fonts.medium, fontSize: 13, textAlign: "center" },
  skeleton: { width: "100%", height: 38, borderRadius: 999, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  footer: { gap: spacing.sm },
});
