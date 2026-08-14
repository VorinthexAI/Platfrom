import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import Pdf from "react-native-pdf";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { ReactNode } from "react";

import { Button } from "../button/button.mobile";
import { Spinner } from "../spinner/spinner.mobile";
import { ChevronLeftIcon } from "../../icons/chevron-left/chevron-left.mobile";
import { MoreHorizontalIcon } from "../../icons/more-horizontal/more-horizontal.mobile";
import { colors, radii, spacing } from "../../tokens";

export type FileViewerInlineRun = { text: string; bold?: boolean; italic?: boolean; underline?: boolean; strike?: boolean; code?: boolean; href?: string };
export type FileViewerBlock =
  | { type: "heading"; level: number; content: FileViewerInlineRun[] }
  | { type: "paragraph"; content: FileViewerInlineRun[] }
  | { type: "blockquote"; children: FileViewerBlock[] }
  | { type: "bulletList"; items: { content: FileViewerInlineRun[]; children: FileViewerBlock[] }[] }
  | { type: "orderedList"; start: number; items: { content: FileViewerInlineRun[]; children: FileViewerBlock[] }[] }
  | { type: "codeBlock"; text: string }
  | { type: "table"; rows: { cells: { header: boolean; colSpan: number; rowSpan: number; content: FileViewerInlineRun[] }[] }[] }
  | { type: "horizontalRule" }
  | { type: "page"; page: number; children: FileViewerBlock[] };

export type FileViewerProps = { blocks?: FileViewerBlock[]; error?: string; headerAction?: ReactNode; loading?: boolean; onBack: () => void; onMenu: () => void; onRenderError?: (message: string) => void; pdfUri?: string; title: string };

function InlineContent({ runs, style }: { runs: FileViewerInlineRun[]; style?: object }) {
  return <Text style={[styles.bodyText, style]}>{runs.map((run, index) => <Text accessibilityRole={run.href ? "link" : undefined} key={index} onPress={run.href ? () => void Linking.openURL(run.href!) : undefined} style={[run.bold && styles.bold, run.italic && styles.italic, run.underline && styles.underline, run.strike && styles.strike, run.code && styles.inlineCode, run.href && styles.link]}>{run.text}</Text>)}</Text>;
}

function Block({ block, depth = 0 }: { block: FileViewerBlock; depth?: number }) {
  if (block.type === "heading") return <InlineContent runs={block.content} style={[styles.heading, headingStyles[Math.min(6, Math.max(1, block.level))]]} />;
  if (block.type === "paragraph") return <InlineContent runs={block.content} />;
  if (block.type === "codeBlock") return <Text selectable style={styles.codeText}>{block.text}</Text>;
  if (block.type === "horizontalRule") return <View style={styles.rule} />;
  if (block.type === "blockquote") return <View style={styles.quote}>{block.children.map((child, index) => <Block block={child} depth={depth + 1} key={index} />)}</View>;
  if (block.type === "page") return <View accessibilityLabel={`Page ${block.page}`} style={styles.page}><Text style={styles.pageLabel}>PAGE {block.page}</Text>{block.children.map((child, index) => <Block block={child} depth={depth} key={index} />)}</View>;
  if (block.type === "bulletList" || block.type === "orderedList") return <View style={[styles.list, { paddingLeft: Math.min(depth, 3) * spacing.sm }]}>{block.items.map((item, index) => <View key={index} style={styles.listItem}><Text style={styles.listMarker}>{block.type === "bulletList" ? "•" : `${block.start + index}.`}</Text><View style={styles.listContent}><InlineContent runs={item.content} />{item.children.map((child, childIndex) => <Block block={child} depth={depth + 1} key={childIndex} />)}</View></View>)}</View>;
  return <View style={styles.table}>{block.rows.map((row, rowIndex) => <View key={rowIndex} style={styles.tableRow}>{row.cells.map((cell, cellIndex) => <View key={cellIndex} style={[styles.tableCell, { flex: cell.colSpan }]}><InlineContent runs={cell.content} style={cell.header ? styles.bold : undefined} /></View>)}</View>)}</View>;
}

export function FileViewer({ blocks, error, headerAction, loading = false, onBack, onMenu, onRenderError, pdfUri, title }: FileViewerProps) {
  const insets = useSafeAreaInsets();
  return <View style={[styles.root, { paddingBottom: insets.bottom + 78 + spacing.md }]}><View style={styles.scene}><View style={styles.header}><Button accessibilityLabel="Back" contentMode="raw" onPress={onBack} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button><View style={styles.headerSpacer} />{headerAction}<Button accessibilityLabel={`Manage ${title}`} contentMode="raw" onPress={onMenu} size="sm" variant="icon"><MoreHorizontalIcon size="sm" /></Button></View><View style={styles.documentArea}>{loading ? <View accessibilityLabel={`Loading ${title}`} accessibilityRole="progressbar" style={styles.center}><Spinner size="large" /></View> : error ? <View style={styles.center}><Text accessibilityRole="alert" style={styles.error}>{error}</Text></View> : pdfUri ? <View style={styles.content}><Text numberOfLines={2} style={styles.title}>{title}</Text><Pdf enableDoubleTapZoom={false} enablePaging={false} fitPolicy={0} horizontal={false} maxScale={1} minScale={1} onError={(cause) => onRenderError?.(cause.message || "The PDF could not be rendered.")} source={{ uri: pdfUri, cache: false }} style={styles.pdf} trustAllCerts={false} /></View> : blocks ? <ScrollView contentContainerStyle={styles.document} horizontal={false} showsHorizontalScrollIndicator={false}><Text numberOfLines={2} style={styles.title}>{title}</Text>{blocks.map((block, index) => <Block block={block} key={index} />)}</ScrollView> : <View style={styles.center}><Text style={styles.error}>Preview unavailable.</Text></View>}</View></View></View>;
}

const headingStyles: Record<number, object> = { 1: { fontSize: 30 }, 2: { fontSize: 25 }, 3: { fontSize: 21 }, 4: { fontSize: 18 }, 5: { fontSize: 16 }, 6: { fontSize: 14 } };
const styles = StyleSheet.create({
  root: { flex: 1, minWidth: 0, paddingHorizontal: spacing.md, paddingTop: spacing.md, overflow: "hidden", backgroundColor: colors.page }, scene: { flex: 1, minWidth: 0, gap: spacing.sm }, header: { minHeight: 40, minWidth: 0, flexDirection: "row", alignItems: "center" }, headerSpacer: { flex: 1 }, documentArea: { flex: 1, minWidth: 0, minHeight: 0, padding: spacing.md, borderRadius: radii.xl, borderColor: colors.hairline, borderWidth: 1, overflow: "hidden", backgroundColor: colors.panelRaised }, title: { minWidth: 0, color: colors.text, fontFamily: "Geist_500Medium", fontSize: 28, lineHeight: 34 }, content: { flex: 1, minWidth: 0, minHeight: 0, gap: spacing.md, overflow: "hidden" }, center: { flex: 1, padding: spacing.lg, alignItems: "center", justifyContent: "center" }, error: { color: colors.muted, fontFamily: "Geist_400Regular", fontSize: 14, lineHeight: 21, textAlign: "center" }, pdf: { flex: 1, width: "100%", backgroundColor: colors.panelRaised }, document: { width: "100%", paddingBottom: spacing.xxl, gap: spacing.md }, bodyText: { flexShrink: 1, maxWidth: "100%", color: colors.accent, fontFamily: "Geist_400Regular", fontSize: 16, lineHeight: 26 }, heading: { color: colors.text, fontFamily: "Geist_600SemiBold", lineHeight: 36, marginTop: spacing.sm }, bold: { fontFamily: "Geist_600SemiBold" }, italic: { fontStyle: "italic" }, underline: { textDecorationLine: "underline" }, strike: { textDecorationLine: "line-through" }, inlineCode: { fontFamily: "monospace" }, link: { color: colors.accent, textDecorationLine: "underline" }, quote: { minWidth: 0, paddingLeft: spacing.md, gap: spacing.sm, borderLeftColor: colors.muted, borderLeftWidth: 3 }, codeText: { width: "100%", flexShrink: 1, color: colors.accent, fontFamily: "monospace", fontSize: 13, lineHeight: 20 }, rule: { height: 1, backgroundColor: colors.hairline }, list: { minWidth: 0, gap: spacing.xs }, listItem: { minWidth: 0, flexDirection: "row", gap: spacing.xs }, listMarker: { width: 26, color: colors.muted, fontFamily: "Geist_600SemiBold", fontSize: 15, lineHeight: 26, textAlign: "right" }, listContent: { flex: 1, minWidth: 0, gap: spacing.xs }, page: { minWidth: 0, gap: spacing.md, paddingBottom: spacing.lg, borderBottomColor: colors.hairline, borderBottomWidth: 1 }, pageLabel: { color: colors.muted, fontFamily: "Geist_600SemiBold", fontSize: 10, letterSpacing: 1.5 }, table: { width: "100%", minWidth: 0, alignItems: "stretch", overflow: "hidden" }, tableRow: { width: "100%", minWidth: 0, flexDirection: "row" }, tableCell: { minWidth: 0, padding: spacing.sm, borderColor: colors.hairline, borderWidth: 1, overflow: "hidden" },
});
