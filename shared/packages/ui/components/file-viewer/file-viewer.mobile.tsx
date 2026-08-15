import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Linking, ScrollView, StyleSheet, Text, View, type NativeSyntheticEvent, type TextLayoutEventData } from "react-native";
import Pdf from "react-native-pdf";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { highlightedSegments, searchDocumentPassagesLiteral, type DocumentSearchMatch, type HighlightRange } from "../../document-search";
import { BrainIcon } from "../../icons/brain/brain.mobile";
import { ChevronLeftIcon } from "../../icons/chevron-left/chevron-left.mobile";
import { CloseIcon } from "../../icons/close/close.mobile";
import { ClockIcon } from "../../icons/clock/clock.mobile";
import { EditIcon } from "../../icons/edit/edit.mobile";
import { MoreHorizontalIcon } from "../../icons/more-horizontal/more-horizontal.mobile";
import { SearchIcon } from "../../icons/search/search.mobile";
import { colors, radii, spacing } from "../../tokens";
import { Button } from "../button/button.mobile";
import { TextInput } from "../text-input/text-input.mobile";

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

export type FileViewerProps = { blocks?: FileViewerBlock[]; error?: string; loading?: boolean; onAi?: () => void; onBack: () => void; onEdit?: () => void; onHistory?: () => void; onMenu: () => void; onRenderError?: (message: string) => void; pdfUri?: string; title: string };

function passageText(runs: FileViewerInlineRun[]) {
  return runs.map(({ text }) => text).join("");
}

function flattenBlocks(blocks: FileViewerBlock[]) {
  const passages: { id: string; text: string }[] = [];
  const visit = (block: FileViewerBlock, id: string) => {
    if (block.type === "heading" || block.type === "paragraph") passages.push({ id, text: passageText(block.content) });
    else if (block.type === "codeBlock") passages.push({ id, text: block.text });
    else if (block.type === "blockquote" || block.type === "page") block.children.forEach((child, index) => visit(child, `${id}.child.${index}`));
    else if (block.type === "bulletList" || block.type === "orderedList") block.items.forEach((item, itemIndex) => {
      passages.push({ id: `${id}.item.${itemIndex}.content`, text: passageText(item.content) });
      item.children.forEach((child, childIndex) => visit(child, `${id}.item.${itemIndex}.child.${childIndex}`));
    });
    else if (block.type === "table") block.rows.forEach((row, rowIndex) => row.cells.forEach((cell, cellIndex) => passages.push({ id: `${id}.row.${rowIndex}.cell.${cellIndex}`, text: passageText(cell.content) })));
  };
  blocks.forEach((block, index) => visit(block, `block.${index}`));
  return passages;
}

function InlineContent({ onTextLayout, ranges = [], runs, style }: { onTextLayout?: (event: NativeSyntheticEvent<TextLayoutEventData>) => void; ranges?: HighlightRange[]; runs: FileViewerInlineRun[]; style?: object }) {
  let runOffset = 0;
  return <Text onTextLayout={onTextLayout} style={[styles.bodyText, style]}>{runs.map((run, index) => {
    const start = runOffset;
    runOffset += run.text.length;
    const runRanges = ranges.flatMap((range) => range.end > start && range.start < runOffset ? [{ start: Math.max(0, range.start - start), end: Math.min(run.text.length, range.end - start) }] : []);
    return <Text accessibilityRole={run.href ? "link" : undefined} key={index} onPress={run.href ? () => void Linking.openURL(run.href!) : undefined} style={[run.bold && styles.bold, run.italic && styles.italic, run.underline && styles.underline, run.strike && styles.strike, run.code && styles.inlineCode, run.href && styles.link]}>{highlightedSegments(run.text, runRanges).map((segment) => <Text key={`${segment.start}-${segment.end}`} style={segment.highlighted ? styles.highlight : undefined}>{segment.text}</Text>)}</Text>;
  })}</Text>;
}

type BlockProps = { block: FileViewerBlock; captureHighlight: (id: string, event: NativeSyntheticEvent<TextLayoutEventData>) => void; capturePassage: (id: string, node: View | null) => void; depth?: number; id: string; matches: Map<string, DocumentSearchMatch> };

function Passage({ children, id, capturePassage }: { children: ReactNode; id: string; capturePassage: BlockProps["capturePassage"] }) {
  const nodeRef = useRef<View>(null);
  const setRef = useCallback((node: View | null) => {
    nodeRef.current = node;
    if (!node) capturePassage(id, null);
  }, [capturePassage, id]);
  return <View collapsable={false} onLayout={() => capturePassage(id, nodeRef.current)} ref={setRef}>{children}</View>;
}

function Block({ block, captureHighlight, capturePassage, depth = 0, id, matches }: BlockProps) {
  if (block.type === "heading") return <Passage capturePassage={capturePassage} id={id}><InlineContent onTextLayout={(event) => captureHighlight(id, event)} ranges={matches.get(id)?.ranges} runs={block.content} style={[styles.heading, headingStyles[Math.min(6, Math.max(1, block.level))]]} /></Passage>;
  if (block.type === "paragraph") return <Passage capturePassage={capturePassage} id={id}><InlineContent onTextLayout={(event) => captureHighlight(id, event)} ranges={matches.get(id)?.ranges} runs={block.content} /></Passage>;
  if (block.type === "codeBlock") return <Passage capturePassage={capturePassage} id={id}><Text onTextLayout={(event) => captureHighlight(id, event)} selectable style={styles.codeText}>{highlightedSegments(block.text, matches.get(id)?.ranges ?? []).map((segment) => <Text key={`${segment.start}-${segment.end}`} style={segment.highlighted ? styles.highlight : undefined}>{segment.text}</Text>)}</Text></Passage>;
  if (block.type === "horizontalRule") return <View style={styles.rule} />;
  if (block.type === "blockquote") return <View style={styles.quote}>{block.children.map((child, index) => <Block block={child} captureHighlight={captureHighlight} capturePassage={capturePassage} depth={depth + 1} id={`${id}.child.${index}`} key={index} matches={matches} />)}</View>;
  if (block.type === "page") return <View accessibilityLabel={`Page ${block.page}`} style={styles.page}><Text style={styles.pageLabel}>PAGE {block.page}</Text>{block.children.map((child, index) => <Block block={child} captureHighlight={captureHighlight} capturePassage={capturePassage} depth={depth} id={`${id}.child.${index}`} key={index} matches={matches} />)}</View>;
  if (block.type === "bulletList" || block.type === "orderedList") return <View style={[styles.list, { paddingLeft: Math.min(depth, 3) * spacing.sm }]}>{block.items.map((item, index) => {
    const itemId = `${id}.item.${index}`;
    return <View key={index} style={styles.listItem}><Text style={styles.listMarker}>{block.type === "bulletList" ? "•" : `${block.start + index}.`}</Text><View style={styles.listContent}><Passage capturePassage={capturePassage} id={`${itemId}.content`}><InlineContent onTextLayout={(event) => captureHighlight(`${itemId}.content`, event)} ranges={matches.get(`${itemId}.content`)?.ranges} runs={item.content} /></Passage>{item.children.map((child, childIndex) => <Block block={child} captureHighlight={captureHighlight} capturePassage={capturePassage} depth={depth + 1} id={`${itemId}.child.${childIndex}`} key={childIndex} matches={matches} />)}</View></View>;
  })}</View>;
  return <View style={styles.table}>{block.rows.map((row, rowIndex) => <View key={rowIndex} style={styles.tableRow}>{row.cells.map((cell, cellIndex) => {
    const cellId = `${id}.row.${rowIndex}.cell.${cellIndex}`;
    return <View key={cellIndex} style={[styles.tableCell, { flex: cell.colSpan }]}><Passage capturePassage={capturePassage} id={cellId}><InlineContent onTextLayout={(event) => captureHighlight(cellId, event)} ranges={matches.get(cellId)?.ranges} runs={cell.content} style={cell.header ? styles.bold : undefined} /></Passage></View>;
  })}</View>)}</View>;
}

export function FileViewer({ blocks, error, loading = false, onAi, onBack, onEdit, onHistory, onMenu, onRenderError, pdfUri, title }: FileViewerProps) {
  const insets = useSafeAreaInsets();
  const [query, setQuery] = useState("");
  const [searchRevision, setSearchRevision] = useState(0);
  const [layoutVersion, setLayoutVersion] = useState(0);
  const scrollRef = useRef<ScrollView>(null);
  const viewportHeight = useRef(0);
  const offsets = useRef(new Map<string, { y: number; height: number }>());
  const highlightOffsets = useRef(new Map<string, number>());
  const passages = useMemo(() => flattenBlocks(blocks ?? []), [blocks]);
  const trimmedQuery = query.trim();
  const matches = useMemo(() => searchDocumentPassagesLiteral(passages, trimmedQuery), [passages, trimmedQuery]);
  const matchesById = useMemo(() => new Map(matches.map((match) => [match.id, match])), [matches]);
  const match = matches[0];

  const capturePassage = useCallback((id: string, node: View | null) => {
    if (!node) {
      offsets.current.delete(id);
      return;
    }
    const nativeScroll = scrollRef.current?.getNativeScrollRef();
    if (nativeScroll) node.measureLayout(nativeScroll, (_x, y, _width, height) => {
      const previous = offsets.current.get(id);
      if (previous?.y !== y || previous.height !== height) {
        offsets.current.set(id, { y, height });
        setLayoutVersion((value) => value + 1);
      }
    }, () => undefined);
  }, []);

  const captureHighlight = useCallback((id: string, event: NativeSyntheticEvent<TextLayoutEventData>) => {
    const range = matchesById.get(id)?.ranges[0];
    if (!range) return;
    const center = (range.start + range.end) / 2;
    let offset = 0;
    for (const line of event.nativeEvent.lines) {
      const next = offset + line.text.length;
      if (center <= next) {
        const measured = line.y + line.height / 2;
        if (Math.abs((highlightOffsets.current.get(id) ?? -1) - measured) > 1) {
          highlightOffsets.current.set(id, measured);
          setLayoutVersion((value) => value + 1);
        }
        break;
      }
      offset = next;
    }
  }, [matchesById]);

  useEffect(() => {
    highlightOffsets.current.clear();
  }, [trimmedQuery]);

  useEffect(() => {
    if (!trimmedQuery || !match) return;
    const target = offsets.current.get(match.id);
    const range = match.ranges[0];
    const rangeCenter = range ? (range.start + range.end) / 2 / Math.max(1, match.text.length) : 0.5;
    const highlightOffset = highlightOffsets.current.get(match.id) ?? (target ? target.height * rangeCenter : 0);
    if (target) scrollRef.current?.scrollTo({ animated: true, y: Math.max(0, target.y + highlightOffset - viewportHeight.current * 0.2) });
  }, [layoutVersion, match, searchRevision, trimmedQuery]);

  const showNativePdf = Boolean(pdfUri && !trimmedQuery);
  return <View style={[styles.root, { paddingBottom: insets.bottom + 78 + spacing.md }]}><View style={styles.scene}>
    <View style={styles.header}><Button accessibilityLabel="Back" contentMode="raw" onPress={onBack} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button><Text numberOfLines={1} style={styles.headerTitle}>{title}</Text><Button accessibilityLabel={`Manage ${title}`} contentMode="raw" onPress={onMenu} size="sm" variant="icon"><MoreHorizontalIcon size="sm" /></Button></View>
    <View style={styles.headerActions}>{onEdit ? <Button accessibilityLabel="Edit document text" contentMode="raw" onPress={onEdit} size="sm" variant="icon"><EditIcon size="sm" /></Button> : null}{onAi ? <Button accessibilityLabel="AI document actions" contentMode="raw" onPress={onAi} size="sm" variant="icon"><BrainIcon size="sm" /></Button> : null}{onHistory ? <Button accessibilityLabel="Document and audio versions" contentMode="raw" onPress={onHistory} size="sm" variant="icon"><ClockIcon size="sm" /></Button> : null}</View>
    <View style={styles.search}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search in document" maxLength={200} onChangeText={setQuery} onSubmitEditing={() => setSearchRevision((current) => current + 1)} placeholder="Search in document..." returnKeyType="search" style={styles.searchInput} value={query} />{query.trim() ? <Button accessibilityLabel="Clear document search" contentMode="raw" onPress={() => setQuery("")} size="xs" variant="icon"><CloseIcon size="sm" /></Button> : null}</View>
    <View style={styles.documentArea}>{loading ? <View accessibilityLabel={`Loading ${title}`} accessibilityRole="progressbar" style={styles.loadingSkeleton} /> : error ? <View style={styles.center}><Text accessibilityRole="alert" style={styles.error}>{error}</Text></View> : showNativePdf ? <View style={styles.content}><Pdf enableDoubleTapZoom={false} enablePaging={false} fitPolicy={0} horizontal={false} maxScale={1} minScale={1} onError={(cause) => onRenderError?.(cause.message || "The PDF could not be rendered.")} source={{ uri: pdfUri!, cache: false }} style={styles.pdf} trustAllCerts={false} /></View> : blocks ? <ScrollView contentContainerStyle={styles.document} horizontal={false} onLayout={(event) => { const height = event.nativeEvent.layout.height; if (viewportHeight.current !== height) { viewportHeight.current = height; setLayoutVersion((value) => value + 1); } }} ref={scrollRef} showsHorizontalScrollIndicator={false}>{blocks.map((block, index) => <Block block={block} captureHighlight={captureHighlight} capturePassage={capturePassage} id={`block.${index}`} key={index} matches={matchesById} />)}</ScrollView> : <View style={styles.center}><Text style={styles.error}>Preview unavailable.</Text></View>}</View>
  </View></View>;
}

const headingStyles: Record<number, object> = { 1: { fontSize: 30 }, 2: { fontSize: 25 }, 3: { fontSize: 21 }, 4: { fontSize: 18 }, 5: { fontSize: 16 }, 6: { fontSize: 14 } };
const styles = StyleSheet.create({
  loadingSkeleton: { flex: 1, borderRadius: radii.lg, backgroundColor: colors.hairlineBright, opacity: 0.72 },
  root: { flex: 1, minWidth: 0, paddingHorizontal: spacing.md, paddingTop: spacing.md, overflow: "hidden", backgroundColor: colors.page }, scene: { flex: 1, minWidth: 0, gap: spacing.sm }, header: { minHeight: 40, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs }, headerTitle: { flex: 1, minWidth: 0, color: colors.text, fontFamily: "Geist_500Medium", fontSize: 15, lineHeight: 20 }, headerActions: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: spacing.xs }, search: { minHeight: 44, width: "100%", paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: colors.hairline, borderWidth: 1, backgroundColor: colors.panelRaised }, searchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" }, searchStatus: { minHeight: 16, color: colors.muted, fontFamily: "Geist_400Regular", fontSize: 12, lineHeight: 16, textAlign: "right" }, documentArea: { flex: 1, minWidth: 0, minHeight: 0, padding: spacing.md, borderRadius: radii.xl, borderColor: colors.hairline, borderWidth: 1, overflow: "hidden", backgroundColor: colors.panelRaised }, title: { minWidth: 0, color: colors.text, fontFamily: "Geist_500Medium", fontSize: 28, lineHeight: 34 }, content: { flex: 1, minWidth: 0, minHeight: 0, gap: spacing.md, overflow: "hidden" }, center: { flex: 1, padding: spacing.lg, alignItems: "center", justifyContent: "center" }, error: { color: colors.muted, fontFamily: "Geist_400Regular", fontSize: 14, lineHeight: 21, textAlign: "center" }, pdf: { flex: 1, width: "100%", backgroundColor: colors.panelRaised }, document: { width: "100%", paddingBottom: spacing.xxl, gap: spacing.md }, bodyText: { flexShrink: 1, maxWidth: "100%", color: colors.accent, fontFamily: "Geist_400Regular", fontSize: 16, lineHeight: 26 }, heading: { color: colors.text, fontFamily: "Geist_600SemiBold", lineHeight: 36, marginTop: spacing.sm }, bold: { fontFamily: "Geist_600SemiBold" }, italic: { fontStyle: "italic" }, underline: { textDecorationLine: "underline" }, strike: { textDecorationLine: "line-through" }, inlineCode: { fontFamily: "monospace" }, link: { color: colors.accent, textDecorationLine: "underline" }, highlight: { backgroundColor: "rgba(255, 214, 64, 0.34)", color: colors.text }, quote: { minWidth: 0, paddingLeft: spacing.md, gap: spacing.sm, borderLeftColor: colors.muted, borderLeftWidth: 3 }, codeText: { width: "100%", flexShrink: 1, color: colors.accent, fontFamily: "monospace", fontSize: 13, lineHeight: 20 }, rule: { height: 1, backgroundColor: colors.hairline }, list: { minWidth: 0, gap: spacing.xs }, listItem: { minWidth: 0, flexDirection: "row", gap: spacing.xs }, listMarker: { width: 26, color: colors.muted, fontFamily: "Geist_600SemiBold", fontSize: 15, lineHeight: 26, textAlign: "right" }, listContent: { flex: 1, minWidth: 0, gap: spacing.xs }, page: { minWidth: 0, gap: spacing.md, paddingBottom: spacing.lg, borderBottomColor: colors.hairline, borderBottomWidth: 1 }, pageLabel: { color: colors.muted, fontFamily: "Geist_600SemiBold", fontSize: 10, letterSpacing: 1.5 }, table: { width: "100%", minWidth: 0, alignItems: "stretch", overflow: "hidden" }, tableRow: { width: "100%", minWidth: 0, flexDirection: "row" }, tableCell: { minWidth: 0, padding: spacing.sm, borderColor: colors.hairline, borderWidth: 1, overflow: "hidden" },
});
