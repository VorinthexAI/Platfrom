import { StyleSheet, Text, View } from "react-native";
import { Button } from "@vorinthex/shared/ui/button";
import { CloseIcon } from "@vorinthex/shared/ui/icons-mobile";

import type { ContentContext } from "@/lib/content-client";
import { tagFilterContextKey } from "@/lib/tag-client";
import { EMPTY_SELECTED_TAGS, useUiStore } from "@/state/ui";
import { fonts, palette, spacing } from "@/theme/tokens";

export function TagFilterLane({ context }: { context: ContentContext }) {
  const contextKey = tagFilterContextKey(context);
  const tags = useUiStore((state) => state.selectedTagsByContext[contextKey] ?? EMPTY_SELECTED_TAGS);
  const removeSelectedTag = useUiStore((state) => state.removeSelectedTag);
  if (!tags.length) return null;
  return <View accessibilityLabel="Active tag filters" style={styles.content}>{tags.map((tag) => <View key={tag.key} style={styles.pill}><Text numberOfLines={1} style={styles.label}>{tag.name}</Text><Button accessibilityLabel={`Remove ${tag.name} filter`} contentMode="raw" onPress={() => removeSelectedTag(contextKey, tag.key)} size="xs" style={styles.close} variant="icon"><CloseIcon size="sm" /></Button></View>)}</View>;
}

const styles = StyleSheet.create({
  content: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs },
  pill: { alignSelf: "flex-start", maxWidth: "100%", height: 32, padding: 2, paddingLeft: 10, flexDirection: "row", alignItems: "center", gap: 5, borderWidth: 1, borderColor: palette.hairline, borderRadius: 999, backgroundColor: palette.panel },
  label: { maxWidth: 210, color: palette.silver300, fontFamily: fonts.medium, fontSize: 11 },
  close: { width: 24, height: 24, minHeight: 24, paddingHorizontal: 0, paddingVertical: 0 },
});
