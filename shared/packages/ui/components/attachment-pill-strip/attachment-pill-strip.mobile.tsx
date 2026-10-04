import { ScrollView, StyleSheet, Text, View } from "react-native";
import { ActionPill } from "../action-pill/action-pill.mobile";
import { CloseIcon } from "../../icons/close/close.mobile";
import { colors } from "../../tokens";
import type { AttachmentPillStripProps } from "./attachment-pill-strip.types";

export type { AttachmentPillItem, AttachmentPillStripProps } from "./attachment-pill-strip.types";

export function AttachmentPillStrip({ items, disabled }: AttachmentPillStripProps) {
  if (!items.length) return null;
  return <ScrollView accessibilityLabel="Draft attachments" alwaysBounceHorizontal={false} contentContainerStyle={styles.content} horizontal keyboardShouldPersistTaps="handled" showsHorizontalScrollIndicator={false} style={styles.scroll}>
    {items.map((item) => <ActionPill action={<CloseIcon size="sm" />} actionLabel={`Remove ${item.name}`} compact dense disabled={disabled} fitContent key={item.key} onAction={item.onRemove} onPress={item.onOpen} pressLabel={item.onOpen ? `Open ${item.name}` : undefined} style={styles.pill}><View style={styles.pillContent}>{item.icon}<Text numberOfLines={1} style={styles.name}>{item.name}</Text></View></ActionPill>)}
  </ScrollView>;
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0, flexShrink: 0, height: 28 },
  content: { alignItems: "center", gap: 6, paddingHorizontal: 2 },
  pill: { backgroundColor: colors.page, flexShrink: 0, maxWidth: 158 },
  pillContent: { alignItems: "center", alignSelf: "flex-start", flexDirection: "row", flexShrink: 1, gap: 5 },
  name: { color: colors.text, flexShrink: 1, fontSize: 11, maxWidth: 88 },
});
