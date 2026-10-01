import { useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomSheet } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { FolderTile } from "@vorinthex/shared/ui/folder-tile";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { ChevronLeftIcon, CloseIcon, FilterIcon, SearchIcon } from "@vorinthex/shared/ui/icons-mobile";
import { ContentFileTile } from "@/components/ContentFileTile";
import { TagFilterLane } from "@/components/TagFilterLane";
import { TagFilterSheet } from "@/components/TagFilterSheet";
import { SearchHistorySheet } from "@/components/SearchHistorySheet";
import { Switch } from "@vorinthex/shared/ui/switch";
import {
  searchContent,
  deleteContentSearchHistory,
  type ContentContext,
  type ContentFile,
  type ContentFolder,
  type ContentSearchHistoryItem,
  type FileExtension,
} from "@/lib/content-client";
import { contentLocationQueryOptions } from "@/lib/content-query-cache";
import { tagFilterContextKey } from "@/lib/tag-client";
import { getUserSearchHistory, promoteCachedUserSearchHistory, removeCachedUserSearchHistory, userSearchHistoryQueryKey } from "@/lib/user-search-history-cache";
import { EMPTY_SELECTED_TAGS, useUiStore } from "@/state/ui";
import { useDebouncedContentSearchHistory } from "@/hooks/use-debounced-content-search-history";
import { useSessionToast as useToast } from "@/hooks/use-session-toast";
import { palette, radii, spacing } from "@/theme/tokens";

export function FilesPickerSheet({ context, onClose, onDone, open, title = "Tag files", acceptFile, selectionLimit }: { context: ContentContext; onClose: () => void; onDone: (files: ContentFile[], folders: ContentFolder[]) => void; open: boolean; title?: string; acceptFile?: (file: ContentFile) => boolean; selectionLimit?: number }) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const { width } = useWindowDimensions();
  const cardSize = Math.floor((width - 20 * 2 - 2 - 8 * 3) / 4);
  const [folderStack, setFolderStack] = useState<ContentFolder[]>([]);
  const [query, setQuery] = useState("");
  const [settledQuery, setSettledQuery] = useState("");
  const [sheet, setSheet] = useState<"filter" | "tags" | "history">();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [types, setTypes] = useState({ documents: true, images: true, videos: true, audio: true });
  const [selectedFiles, setSelectedFiles] = useState<ContentFile[]>([]);
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const historyRequest = useRef(0);
  const tagContextKey = tagFilterContextKey(context);
  const selectedTags = useUiStore((state) => state.selectedTagsByContext[tagContextKey] ?? EMPTY_SELECTED_TAGS);
  useEffect(() => { if (open) Keyboard.dismiss(); }, [open]);
  useEffect(() => {
    const timeout = setTimeout(() => setSettledQuery(query.trim()), 300);
    return () => clearTimeout(timeout);
  }, [query]);
  const currentFolder = folderStack.at(-1);
  const locationQuery = useQuery({
    ...contentLocationQueryOptions(context, currentFolder?.key, { favoritesOnly, includeHidden: showHidden }, { allFiles: true }),
    enabled: open,
  });
  const searching = Boolean(query.trim()) || selectedTags.length > 0;
  const extensions = useMemo(() => {
    const values: FileExtension[] = [];
    if (types.documents) values.push("txt", "md", "docx", "pdf");
    if (types.images) values.push("jpg", "jpeg", "png", "webp", "gif");
    if (types.videos) values.push("mp4");
    if (types.audio) values.push("mp3");
    return values;
  }, [types]);
  const searchQuery = useQuery({
    queryKey: ["file-search", context.scopeKey, currentFolder?.key ?? null, settledQuery, favoritesOnly, showHidden, selectedTags.map((tag) => tag.key).join(","), extensions.join(",")],
    queryFn: () => searchContent(settledQuery || selectedTags.map((tag) => tag.name).join(" "), currentFolder?.key, { favoritesOnly, includeHidden: showHidden, tagKeys: selectedTags.map((tag) => tag.key), extensions }),
    enabled: open && Boolean(settledQuery || selectedTags.length),
  });
  useDebouncedContentSearchHistory({ context, enabled: open, query, settledQuery, search: searchQuery });
  const folders = searching ? (searchQuery.data?.folders ?? []) : (locationQuery.data?.folders ?? []);
  const files = (searching ? (searchQuery.data?.files ?? []).map((file) => ({
    key: file.fileKey,
    scopeKey: context.scopeKey,
    folderKey: file.folderKey,
    name: file.name,
    extension: file.extension ?? "txt",
    mimeType: "application/octet-stream",
    sizeBytes: 1,
    processing: "ready" as const,
    isFavorite: file.isFavorite,
    createdAt: "",
    updatedAt: "",
  })) : (locationQuery.data?.files ?? [])).filter((file) => extensions.includes(file.extension) && (!acceptFile || acceptFile(file)));
  const selectedFileKeys = new Set(selectedFiles.map(({ key }) => key));
  const loading = searching ? query.trim() !== settledQuery || searchQuery.isPending : locationQuery.isPending;

  const closePicker = () => {
    historyRequest.current += 1;
    setSelectedFiles([]);
    setFolderStack([]);
    setQuery("");
    setSettledQuery("");
    setSheet(undefined);
    onClose();
  };

  const openSearchHistory = () => {
    const request = ++historyRequest.current;
    setHistory(queryClient.getQueryData<ContentSearchHistoryItem[]>(userSearchHistoryQueryKey(context.userKey)) ?? []);
    setHistoryError(undefined);
    setHistoryLoading(true);
    setRemovingHistoryQuery(undefined);
    setSheet("history");
    void queryClient.invalidateQueries({ queryKey: userSearchHistoryQueryKey(context.userKey), exact: true, refetchType: "none" })
      .then(() => getUserSearchHistory(queryClient, context))
      .then((items) => { if (historyRequest.current === request) setHistory(items); })
      .catch((error) => { if (historyRequest.current === request) setHistoryError(error instanceof Error ? error.message : "Search history could not be loaded."); })
      .finally(() => { if (historyRequest.current === request) setHistoryLoading(false); });
  };

  const removeSearchHistory = async (item: ContentSearchHistoryItem) => {
    const previous = removeCachedUserSearchHistory(queryClient, context, item.normalizedQuery);
    setHistory((current) => current.filter((entry) => entry.normalizedQuery !== item.normalizedQuery));
    setRemovingHistoryQuery(item.normalizedQuery);
    try {
      await deleteContentSearchHistory(item.normalizedQuery);
    } catch {
      queryClient.setQueryData(userSearchHistoryQueryKey(context.userKey), previous);
      setHistory(previous);
      showToast({ title: "Search could not be removed.", duration: 2_500 });
    } finally {
      setRemovingHistoryQuery(undefined);
    }
  };

  return <BottomSheet description={`Tap ${title === "Tag files" ? "files to tag" : "images to select"}.`} footer={<><Button disabled={!selectedFiles.length} onPress={() => { onDone(selectedFiles, []); closePicker(); }} size="md" variant="primary">Done</Button><Button onPress={closePicker} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(next) => { if (!next) closePicker(); }} open={open} title={title}>
    <View style={styles.searchRow}>
      {currentFolder ? <Button accessibilityLabel="Back" contentMode="raw" onPress={() => setFolderStack((stack) => stack.slice(0, -1))} size="xs" style={styles.roundBack} variant="secondary"><ChevronLeftIcon size="sm" /></Button> : null}
       <View style={styles.search}><SearchIcon size="sm" variant="muted" /><TextInput accessibilityLabel="Search files" autoFocusInBottomSheet={false} maxLength={500} onChangeText={setQuery} placeholder="Search anything..." style={styles.searchInput} value={query} />{query ? <Button accessibilityLabel="Clear search" contentMode="raw" iconOnly onPress={() => setQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}</View>
       <Button accessibilityLabel="Filter files" contentMode="raw" onPress={() => setSheet("filter")} size="md" variant="icon"><FilterIcon size="sm" variant={favoritesOnly || showHidden || selectedTags.length || !types.documents || !types.images || !types.videos || !types.audio ? "accent" : "default"} /></Button>
    </View>
    <TagFilterLane context={context} />
    {loading ? <View style={styles.grid}>{Array.from({ length: searching ? 4 : 8 }, (_, index) => <Skeleton key={index} style={[styles.card, styles.gridSkeleton, { width: cardSize, height: cardSize }]} />)}</View> : <View style={styles.grid}>
       {folders.map((folder) => <FolderTile accessibilityLabel={`Open ${folder.name}`} key={folder.key} label={folder.name} onPress={() => { setQuery(""); setFolderStack((stack) => [...stack, folder]); }} size={cardSize} />)}
      {files.map((file) => {
        const selected = selectedFileKeys.has(file.key);
        return <ContentFileTile accessibilityLabel={`${selected ? "Deselect" : "Select"} ${file.name}`} file={file} key={file.key} onPress={() => setSelectedFiles((current) => current.some(({ key }) => key === file.key) ? current.filter(({ key }) => key !== file.key) : selectionLimit && current.length >= selectionLimit ? current : [...current, file])} selected={selected} size={cardSize} />;
      })}
    </View>}
    <BottomSheet hideHeading onOpenChange={(next) => { if (!next) setSheet(undefined); }} open={sheet === "filter"} title="">
      <View style={styles.filterContent}>
        <View style={styles.filterRow}><Switch accessibilityLabel="Favorites" checked={favoritesOnly} onCheckedChange={(checked) => { setFavoritesOnly(checked); setSheet(undefined); }} /><Text style={styles.filterLabel}>Favorites</Text></View>
        <View style={styles.filterRow}><Switch accessibilityLabel="Show hidden" checked={showHidden} onCheckedChange={(checked) => { setShowHidden(checked); setSheet(undefined); }} /><Text style={styles.filterLabel}>Show hidden</Text></View>
        {(["documents", "images", "videos", "audio"] as const).map((key) => <View key={key} style={styles.filterRow}><Switch accessibilityLabel={key} checked={types[key]} onCheckedChange={(checked) => { setTypes((current) => ({ ...current, [key]: checked })); setSheet(undefined); }} /><Text style={styles.filterLabel}>{key[0]!.toUpperCase() + key.slice(1)}</Text></View>)}
        <Button onPress={() => setSheet("tags")} size="md" variant="secondary">Tags</Button>
        <Button onPress={openSearchHistory} size="md" variant="secondary">Search history</Button>
      </View>
    </BottomSheet>
    <TagFilterSheet context={context} onClose={() => setSheet(undefined)} open={sheet === "tags"} />
    <SearchHistorySheet error={historyError} history={history} loading={historyLoading} onClose={() => { historyRequest.current += 1; setSheet(undefined); }} onRemove={(item) => { void removeSearchHistory(item); }} onSelect={(item) => { promoteCachedUserSearchHistory(queryClient, context, item); setQuery(item.query); setSheet(undefined); }} open={sheet === "history"} removingQuery={removingHistoryQuery} />
  </BottomSheet>;
}

const styles = StyleSheet.create({
  searchRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  roundBack: { width: 36, height: 36, minHeight: 36, borderRadius: 999 },
  search: { minHeight: 44, flex: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 12, paddingRight: 8, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1 },
  searchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingTop: spacing.sm },
  card: { borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised, overflow: "hidden" },
  gridSkeleton: { backgroundColor: palette.hairlineBright },
  filterContent: { gap: spacing.sm },
  filterRow: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  filterLabel: { color: palette.text, fontSize: 13 },
});
