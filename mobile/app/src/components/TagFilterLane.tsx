import { ScrollView, StyleSheet } from "react-native";
import { FilterPill } from "@vorinthex/shared/ui/filter-pill";

import type { ContentContext } from "@/lib/content-client";
import { tagFilterContextKey } from "@/lib/tag-client";
import { EMPTY_SELECTED_TAGS, useUiStore } from "@/state/ui";
import { spacing } from "@/theme/tokens";

export function TagFilterLane({ context }: { context: ContentContext }) {
  const contextKey = tagFilterContextKey(context);
  const tags = useUiStore((state) => state.selectedTagsByContext[contextKey] ?? EMPTY_SELECTED_TAGS);
  const removeSelectedTag = useUiStore((state) => state.removeSelectedTag);
  if (!tags.length) return null;
  return <ScrollView accessibilityLabel="Active tag filters" contentContainerStyle={styles.content} horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false}>{tags.map((tag) => <FilterPill key={tag.key} label={tag.name} onPress={() => removeSelectedTag(contextKey, tag.key)} onRemove={() => removeSelectedTag(contextKey, tag.key)} selected />)}</ScrollView>;
}

const styles = StyleSheet.create({
  content: { alignItems: "center", gap: spacing.xs, paddingRight: spacing.sm },
});
