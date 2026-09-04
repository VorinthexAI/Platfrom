import { useEffect, useRef, useState } from "react";
import { ScrollView, StyleSheet, Text, View, type TextInput as NativeTextInput } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { FilterPill } from "@vorinthex/shared/ui/filter-pill";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";

import { appSearchQueryRoot } from "@/lib/app-search-client";
import type { ContentContext } from "@/lib/content-client";
import { appendResourceTag, createResourceTagKey, createScopeTag, groupResourceTagAssignmentRequests, normalizeResourceTagTargets, persistResourceTagAssignments, removeResourceTag, replaceResourceTag, resolvePendingResourceTagDraft, type ResourceTagAssignmentState, type ResourceTagTarget, type ScopeTag } from "@/lib/tag-client";
import { applyResourceTagDraft, refreshResourceTagAssignments, refreshScopeTags, resourceTagAssignmentsQueryKey, resourceTagState, scopeTagsQueryKey, toggleResourceTagDraft, type ResourceTagDraft } from "@/lib/tag-query-cache";
import { invalidateAssistantChanges } from "@/lib/workspace-query-cache";
import { fonts, palette, spacing } from "@/theme/tokens";

export type ResourceTagsSheetProps = { context: ContentContext; targets: readonly ResourceTagTarget[]; open: boolean; onClose: () => void };

const workspaceByTarget = {
  folder: "archive", document: "archive", "image-collection": "gallery", image: "gallery", "image-highlight": "gallery", "image-memory": "gallery",
  place: "compass", trip: "compass", "email-inbox": "signal", "email-tone": "signal", "email-thread": "signal", "email-message": "signal", "email-draft": "signal", book: "ascend",
} as const;

export function ResourceTagsSheet({ context, targets, open, onClose }: ResourceTagsSheetProps) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const batchIdentity = normalizeResourceTagTargets(targets).map(({ type, key }) => `${type}:${key}`).join("|");
  const [state, setState] = useState<ResourceTagAssignmentState>();
  const [draft, setDraft] = useState<ResourceTagDraft>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string>();
  const [createOpen, setCreateOpen] = useState(false);
  const [tagName, setTagName] = useState("");
  const requestRef = useRef(0);
  const sessionRef = useRef(0);
  const createInputRef = useRef<NativeTextInput>(null);
  const createSubmissionRef = useRef<string | undefined>(undefined);
  const pendingCreationsRef = useRef(new Map<string, Promise<boolean>>());

  useEffect(() => {
    const session = ++sessionRef.current;
    if (!open) {
      setCreateOpen(false);
      setTagName("");
      return;
    }
    const request = ++requestRef.current;
    const normalizedTargets = normalizeResourceTagTargets(targets);
    setDraft({});
    setState(undefined);
    setLoading(true);
    setError(undefined);
    void refreshResourceTagAssignments(queryClient, context, normalizedTargets).then((next) => {
      if (request === requestRef.current) setState(next);
    }).catch((caught) => {
      if (request === requestRef.current) setError(caught instanceof Error ? caught.message : "Tags could not be loaded.");
    }).finally(() => {
      if (request === requestRef.current) setLoading(false);
    });
    return () => { requestRef.current += 1; if (sessionRef.current === session) sessionRef.current += 1; };
  }, [batchIdentity, context.organizationKey, context.scopeKey, context.userKey, open, queryClient]);

  useEffect(() => {
    if (!createOpen) return;
    const timeout = setTimeout(() => createInputRef.current?.focus(), 300);
    return () => clearTimeout(timeout);
  }, [createOpen]);

  const closeCreate = () => {
    setCreateOpen(false);
    setTagName("");
  };

  const openCreate = () => {
    createSubmissionRef.current = undefined;
    setTagName("");
    setCreateOpen(true);
  };

  const createTag = () => {
    const name = tagName.trim();
    if (!name || !state || createSubmissionRef.current) return;
    const key = createResourceTagKey();
    createSubmissionRef.current = key;
    const timestamp = new Date().toISOString();
    const optimisticTag: ScopeTag = { key, name, createdAt: timestamp, updatedAt: timestamp };
    const session = sessionRef.current;
    const normalizedTargets = normalizeResourceTagTargets(targets);
    const queryKey = resourceTagAssignmentsQueryKey(context, normalizedTargets);
    closeCreate();
    setState((current) => current ? appendResourceTag(current, optimisticTag) : current);
    queryClient.setQueryData<ResourceTagAssignmentState>(queryKey, (current) => appendResourceTag(current ?? state, optimisticTag));
    const catalogKey = scopeTagsQueryKey(context);
    queryClient.setQueryData<ScopeTag[]>(catalogKey, (current) => current ? [...current.filter((tag) => tag.key !== key), optimisticTag] : current);

    const pending = createScopeTag(context, { key, name }).then((created) => {
      if (sessionRef.current === session) setState((current) => current ? replaceResourceTag(current, created) : current);
      queryClient.setQueryData<ResourceTagAssignmentState>(queryKey, (current) => current ? replaceResourceTag(current, created) : current);
      queryClient.setQueryData<ScopeTag[]>(catalogKey, (current) => current ? [...current.filter((tag) => tag.key !== key), created] : [created]);
      void refreshScopeTags(queryClient, context).catch(() => undefined);
      return true;
    }).catch((caught) => {
      if (sessionRef.current === session) {
        setState((current) => current ? removeResourceTag(current, key) : current);
        setDraft((current) => { const next = { ...current }; delete next[key]; return next; });
      }
      queryClient.setQueryData<ResourceTagAssignmentState>(queryKey, (current) => current ? removeResourceTag(current, key) : current);
      queryClient.setQueryData<ScopeTag[]>(catalogKey, (current) => current?.filter((tag) => tag.key !== key));
      void refreshScopeTags(queryClient, context).catch(() => undefined);
      showToast({ title: caught instanceof Error ? caught.message : "Tag could not be created.", duration: 3_000 });
      return false;
    }).finally(() => {
      if (createSubmissionRef.current === key) createSubmissionRef.current = undefined;
    });
    pendingCreationsRef.current.set(key, pending);
  };

  const apply = () => {
    if (!state) return;
    const normalizedTargets = normalizeResourceTagTargets(targets);
    const queryKey = resourceTagAssignmentsQueryKey(context, normalizedTargets);
    const previous = queryClient.getQueryData<ResourceTagAssignmentState>(queryKey) ?? state;
    const optimistic = applyResourceTagDraft(previous, normalizedTargets, draft);
    queryClient.setQueryData(queryKey, optimistic);
    onClose();
    void (async () => {
      const resolved = await resolvePendingResourceTagDraft(draft, new Map(pendingCreationsRef.current));
      let baseline = resolved.failedKeys.reduce(removeResourceTag, previous);
      if (resolved.failedKeys.length) {
        try { baseline = await refreshResourceTagAssignments(queryClient, context, normalizedTargets); } catch { /* Keep local failure cleanup when reconciliation is unavailable. */ }
      }
      const resolvedOptimistic = applyResourceTagDraft(baseline, normalizedTargets, resolved.draft);
      queryClient.setQueryData(queryKey, resolvedOptimistic);
      const requests = groupResourceTagAssignmentRequests(normalizedTargets, resolved.draft);
      if (!requests.length) return;
      try {
        await persistResourceTagAssignments(context, requests);
      } catch (caught) {
        if (queryClient.getQueryData(queryKey) === resolvedOptimistic) queryClient.setQueryData(queryKey, baseline);
        try { await refreshResourceTagAssignments(queryClient, context, normalizedTargets); } catch { /* Keep the best available local state when reconciliation is unavailable. */ }
        showToast({ title: caught instanceof Error ? caught.message : "Tags could not be updated.", duration: 3_000 });
        return;
      }
      try { await refreshResourceTagAssignments(queryClient, context, normalizedTargets); } catch { /* Preserve the optimistic success when reconciliation is unavailable. */ }
      const changes = [...new Set(normalizedTargets.map(({ type }) => workspaceByTarget[type]))].map((workspace) => ({ workspace }));
      void Promise.all([invalidateAssistantChanges(queryClient, context, changes), queryClient.invalidateQueries({ queryKey: appSearchQueryRoot })]).catch(() => undefined);
    })();
  };

  const draftChanged = Object.keys(draft).length > 0;

  return <><BottomSheet description="Choose tags for the selected items. Tags shown with a dashed outline are currently on only some items." footer={<View style={styles.footer}><Button disabled={loading || Boolean(error) || !state} onPress={draftChanged ? apply : openCreate} size="md" variant="primary">{draftChanged ? "Apply" : "Create tag"}</Button><Button onPress={onClose} size="md" variant="secondary">Close</Button></View>} height="full" onOpenChange={(next) => { if (!next) onClose(); }} open={open} title="Tags">
    <ScrollView contentContainerStyle={[styles.list, !loading && state?.tags.length === 0 && styles.emptyContent]} showsVerticalScrollIndicator={false} style={styles.scroll}>
      {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}
      {loading ? <View accessibilityLabel="Loading tags" accessibilityRole="progressbar" style={styles.list}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={styles.skeleton} />)}</View> : null}
      {!loading && !error && state?.tags.length === 0 ? <Text style={styles.empty}>No tags yet.</Text> : null}
      {!loading && state ? state.tags.map((tag) => { const tagState = resourceTagState(state, targets, tag.key, draft); return <FilterPill fullWidth key={tag.key} label={tag.name} mixed={tagState === "some"} onPress={() => setDraft((current) => toggleResourceTagDraft(current, state, targets, tag.key))} selected={tagState === "all"} />; }) : null}
    </ScrollView>
  </BottomSheet><BottomSheet footer={<View style={styles.footer}><Button disabled={!tagName.trim()} onPress={createTag} size="md" variant="primary">Create</Button><Button onPress={closeCreate} size="md" variant="secondary">Close</Button></View>} onOpenChange={(next) => { if (!next) closeCreate(); }} open={open && createOpen} title="Create tag">
    <View style={styles.form}><Text style={styles.inputLabel}>Name</Text><TextInput accessibilityLabel="Name" autoFocusInBottomSheet={false} maxLength={120} onChangeText={setTagName} onSubmitEditing={createTag} placeholder="Tag name" ref={createInputRef} returnKeyType="done" value={tagName} /></View>
  </BottomSheet></>;
}

const styles = StyleSheet.create({
  scroll: { flex: 1 }, list: { flexGrow: 1, gap: spacing.xs, paddingBottom: spacing.xl }, emptyContent: { justifyContent: "center" },
  empty: { color: palette.muted, fontFamily: fonts.regular, fontSize: 13, textAlign: "center" }, error: { color: palette.danger, fontFamily: fonts.medium, fontSize: 13, textAlign: "center" },
  skeleton: { width: "100%", height: 38, borderRadius: 999, backgroundColor: palette.hairlineBright, opacity: 0.72 }, footer: { gap: spacing.sm },
  form: { gap: spacing.xs }, inputLabel: { color: palette.text, fontFamily: fonts.medium, fontSize: 13 },
});
