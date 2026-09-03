import { Fragment, type ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, Text, View, type StyleProp, type TextStyle, type ViewProps, type ViewStyle } from "react-native";
import { colors, radii, spacing } from "../../tokens";
import { isSafeRichTextUrl, parseRichText, type RichTextBlock, type RichTextInline } from "./rich-text-parser";

export type RichTextStyles = {
  root?: StyleProp<ViewStyle>;
  paragraph?: StyleProp<TextStyle>;
  heading?: StyleProp<TextStyle>;
  heading1?: StyleProp<TextStyle>;
  heading2?: StyleProp<TextStyle>;
  heading3?: StyleProp<TextStyle>;
  heading4?: StyleProp<TextStyle>;
  heading5?: StyleProp<TextStyle>;
  heading6?: StyleProp<TextStyle>;
  bold?: StyleProp<TextStyle>;
  italic?: StyleProp<TextStyle>;
  strikethrough?: StyleProp<TextStyle>;
  link?: StyleProp<TextStyle>;
  inlineCode?: StyleProp<TextStyle>;
  codeBlockContainer?: StyleProp<ViewStyle>;
  codeBlock?: StyleProp<TextStyle>;
  blockquote?: StyleProp<ViewStyle>;
  blockquoteText?: StyleProp<TextStyle>;
  unorderedList?: StyleProp<ViewStyle>;
  orderedList?: StyleProp<ViewStyle>;
  listItem?: StyleProp<ViewStyle>;
  listMarker?: StyleProp<TextStyle>;
  thematicBreak?: StyleProp<ViewStyle>;
  tableScroll?: StyleProp<ViewStyle>;
  table?: StyleProp<ViewStyle>;
  tableRow?: StyleProp<ViewStyle>;
  tableHeaderCell?: StyleProp<ViewStyle>;
  tableHeaderText?: StyleProp<TextStyle>;
  tableCell?: StyleProp<ViewStyle>;
  tableCellText?: StyleProp<TextStyle>;
};

export type RichTextProps = Omit<ViewProps, "children"> & {
  content: string;
  styles?: RichTextStyles;
  onLinkPress?: (url: string) => void;
};

function InlineNodes({ nodes, overrides, onLinkPress, prefix }: { nodes: RichTextInline[]; overrides: RichTextStyles; onLinkPress?: (url: string) => void; prefix: string }) {
  return nodes.map((node, index): ReactNode => {
    const key = `${prefix}-${index}`;
    if (node.type === "text") return <Fragment key={key}>{node.text}</Fragment>;
    if (node.type === "break") return <Fragment key={key}>{"\n"}</Fragment>;
    if (node.type === "inlineCode") return <Text key={key} style={[defaultStyles.inlineCode, overrides.inlineCode]}>{node.text}</Text>;
    const children = <InlineNodes nodes={node.children} overrides={overrides} onLinkPress={onLinkPress} prefix={key} />;
    if (node.type === "strong") return <Text key={key} style={[defaultStyles.bold, overrides.bold]}>{children}</Text>;
    if (node.type === "emphasis") return <Text key={key} style={[defaultStyles.italic, overrides.italic]}>{children}</Text>;
    if (node.type === "strikethrough") return <Text key={key} style={[defaultStyles.strikethrough, overrides.strikethrough]}>{children}</Text>;
    if (!isSafeRichTextUrl(node.href)) return <Fragment key={key}>{children}</Fragment>;
    const open = () => onLinkPress ? onLinkPress(node.href) : void Linking.openURL(node.href).catch(() => undefined);
    return <Text accessibilityRole="link" key={key} onPress={open} style={[defaultStyles.link, overrides.link]}>{children}</Text>;
  });
}

function Blocks({ blocks, overrides, onLinkPress, prefix, quote = false }: { blocks: RichTextBlock[]; overrides: RichTextStyles; onLinkPress?: (url: string) => void; prefix: string; quote?: boolean }) {
  return blocks.map((block, index): ReactNode => {
    const key = `${prefix}-${index}`;
    if (block.type === "paragraph") return <Text key={key} selectable style={[defaultStyles.paragraph, quote && defaultStyles.blockquoteText, quote && overrides.blockquoteText, overrides.paragraph]}><InlineNodes nodes={block.children} overrides={overrides} onLinkPress={onLinkPress} prefix={key} /></Text>;
    if (block.type === "heading") {
      const level = Math.min(6, Math.max(1, block.depth)) as 1 | 2 | 3 | 4 | 5 | 6;
      const levelStyle = overrides[`heading${level}` as const];
      return <Text key={key} selectable style={[defaultStyles.paragraph, quote && defaultStyles.blockquoteText, defaultStyles.heading, quote && overrides.blockquoteText, overrides.heading, levelStyle]}><InlineNodes nodes={block.children} overrides={overrides} onLinkPress={onLinkPress} prefix={key} /></Text>;
    }
    if (block.type === "code") return <ScrollView horizontal key={key} style={[defaultStyles.codeBlockContainer, overrides.codeBlockContainer]}><Text selectable style={[defaultStyles.codeBlock, overrides.codeBlock]}>{block.text}</Text></ScrollView>;
    if (block.type === "blockquote") return <View key={key} style={[defaultStyles.blockquote, overrides.blockquote]}><Blocks blocks={block.children} overrides={overrides} onLinkPress={onLinkPress} prefix={key} quote /></View>;
    if (block.type === "thematicBreak") return <View key={key} style={[defaultStyles.thematicBreak, overrides.thematicBreak]} />;
    if (block.type === "list") return <View key={key} style={[defaultStyles.list, block.ordered ? overrides.orderedList : overrides.unorderedList]}>{block.items.map((item, itemIndex) => <View key={`${key}-${itemIndex}`} style={[defaultStyles.listItem, overrides.listItem]}><Text selectable style={[defaultStyles.listMarker, overrides.listMarker]}>{block.ordered ? `${block.start + itemIndex}.` : "•"}</Text><View style={defaultStyles.listContent}><Blocks blocks={item} overrides={overrides} onLinkPress={onLinkPress} prefix={`${key}-${itemIndex}`} /></View></View>)}</View>;
    return <ScrollView horizontal key={key} nestedScrollEnabled showsHorizontalScrollIndicator style={[defaultStyles.tableScroll, overrides.tableScroll]} contentContainerStyle={defaultStyles.tableScrollContent}><View style={[defaultStyles.table, overrides.table]}><View style={[defaultStyles.tableRow, overrides.tableRow]}>{block.header.map((cell, cellIndex) => <View key={`${key}-h-${cellIndex}`} style={[defaultStyles.tableCell, defaultStyles.tableHeaderCell, overrides.tableCell, overrides.tableHeaderCell]}><Text selectable style={[defaultStyles.paragraph, defaultStyles.tableHeaderText, overrides.tableCellText, overrides.tableHeaderText]}><InlineNodes nodes={cell} overrides={overrides} onLinkPress={onLinkPress} prefix={`${key}-h-${cellIndex}`} /></Text></View>)}</View>{block.rows.map((row, rowIndex) => <View key={`${key}-r-${rowIndex}`} style={[defaultStyles.tableRow, overrides.tableRow]}>{row.map((cell, cellIndex) => <View key={`${key}-${rowIndex}-${cellIndex}`} style={[defaultStyles.tableCell, overrides.tableCell]}><Text selectable style={[defaultStyles.paragraph, overrides.tableCellText]}><InlineNodes nodes={cell} overrides={overrides} onLinkPress={onLinkPress} prefix={`${key}-${rowIndex}-${cellIndex}`} /></Text></View>)}</View>)}</View></ScrollView>;
  });
}

export function RichText({ content, styles: overrides = {}, onLinkPress, style, ...props }: RichTextProps) {
  return <View style={[defaultStyles.root, overrides.root, style]} {...props}><Blocks blocks={parseRichText(content)} overrides={overrides} onLinkPress={onLinkPress} prefix="rich-text" /></View>;
}

const defaultStyles = StyleSheet.create({
  root: { gap: 6, minWidth: 0 },
  paragraph: { color: colors.text, fontSize: 14, lineHeight: 20 },
  heading: { fontSize: 14, lineHeight: 20, fontWeight: "700" },
  bold: { fontWeight: "700" },
  italic: { fontStyle: "italic" },
  strikethrough: { textDecorationLine: "line-through" },
  link: { color: colors.accent, textDecorationLine: "underline" },
  inlineCode: { backgroundColor: colors.border, color: colors.accentLight, fontFamily: "monospace", fontSize: 13 },
  codeBlockContainer: { maxWidth: "100%", borderColor: colors.hairline, borderRadius: radii.sm, borderWidth: 1, backgroundColor: colors.panelRaised },
  codeBlock: { color: colors.accentLight, fontFamily: "monospace", fontSize: 13, lineHeight: 19, padding: spacing.sm },
  blockquote: { borderLeftColor: colors.border, borderLeftWidth: 3, gap: 6, paddingLeft: spacing.sm },
  blockquoteText: { color: colors.muted },
  list: { gap: 4 },
  listItem: { alignItems: "flex-start", flexDirection: "row", gap: spacing.xs },
  listMarker: { color: colors.muted, fontSize: 14, lineHeight: 20, minWidth: 16, textAlign: "right" },
  listContent: { flex: 1, gap: 4, minWidth: 0 },
  thematicBreak: { backgroundColor: colors.hairline, height: StyleSheet.hairlineWidth },
  tableScroll: { maxWidth: "100%" },
  tableScrollContent: { paddingBottom: spacing.xxs },
  table: { alignSelf: "flex-start", borderLeftColor: colors.hairline, borderLeftWidth: 1, borderTopColor: colors.hairline, borderTopWidth: 1 },
  tableRow: { flexDirection: "row" },
  tableCell: { borderBottomColor: colors.hairline, borderBottomWidth: 1, borderRightColor: colors.hairline, borderRightWidth: 1, flexShrink: 0, minWidth: 120, maxWidth: 240, padding: spacing.xs, width: 160 },
  tableHeaderCell: { backgroundColor: colors.border },
  tableHeaderText: { fontWeight: "700" },
});
