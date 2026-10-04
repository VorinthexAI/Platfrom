import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import { ImageManipulator, SaveFormat } from "expo-image-manipulator";
import { Image } from "expo-image";
import { File } from "expo-file-system";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useVideoPlayer, VideoView } from "expo-video";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeScrollEvent, type NativeSyntheticEvent } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { AudioPlayback } from "@vorinthex/shared/ui/audio-playback";
import { Button } from "@vorinthex/shared/ui/button";
import { FileViewer } from "@vorinthex/shared/ui/file-viewer";
import { FolderTile } from "@vorinthex/shared/ui/folder-tile";
import { PullToRefresh } from "@vorinthex/shared/ui/pull-to-refresh";
import { SearchResultsGrid } from "@vorinthex/shared/ui/search-results-grid";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Switch } from "@vorinthex/shared/ui/switch";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { ChevronLeftIcon, CloseIcon, FilterIcon, FolderIcon, MoreHorizontalIcon, PlusIcon, SearchIcon, SendIcon } from "@vorinthex/shared/ui/icons-mobile";
import { AgentSwitcher } from "@/components/AgentSwitcher";
import { ContentFileCardLabel as FileCardLabel, ContentFileCover as FileCover, ContentFileTile, displayContentFileName, IMAGE_EXTENSIONS } from "@/components/ContentFileTile";
import { DestinationFolderSheet } from "@/components/DestinationFolderSheet";
import { ChromeIcon } from "@/components/ChromeIcon";
import { PersistentCoreComposer as CoreComposer } from "@/components/PersistentCoreComposer";
import { ProfileHeaderRight } from "@/components/ProfileAvatarButton";
import { ResourceTagsSheet } from "@/components/ResourceTagsSheet";
import { SearchHistorySheet } from "@/components/SearchHistorySheet";
import { TagFilterLane } from "@/components/TagFilterLane";
import { TagFilterSheet } from "@/components/TagFilterSheet";
import { CORE_PLACEHOLDER_PROMPTS } from "@/data/core-prompts";
import { assistantIconSource } from "@/data/capability-icons";
import { useSessionToast as useToast } from "@/hooks/use-session-toast";
import { useDebouncedContentSearchHistory } from "@/hooks/use-debounced-content-search-history";
import { useConversationFiles } from "@/hooks/use-conversation-files";
import {
  copyContentSelection,
  createContentFolder,
  createContentMutationKey,
  createContentRecordKey,
  deleteContentFile,
  deleteContentFolder,
  deleteContentSearchHistory,
  downloadContentFile,
  FILE_EXTENSIONS,
  findContentFile,
  findContentFolder,
  isContentContextConfigured,
  moveContentSelection,
  searchContent,
  setContentFileFavorite,
  setContentFolderFavorite,
  updateContentFile,
  updateContentFolder,
  uploadContentFiles,
  type ContentFile,
  type ContentFolder,
  type ContentSearchHistoryItem,
  type FileExtension,
} from "@/lib/content-client";
import {
  addCachedContentFolder,
  contentLocationQueryOptions,
  contentQueryKeys,
  hasMoreContentLocationPages,
  invalidateContentLocations,
  loadContentLocationPage,
  removeCachedContentFile,
  removeCachedContentFolder,
  STORAGE_PAGE_SIZE,
  type ContentLocation,
} from "@/lib/content-query-cache";
import { actionToast } from "@/lib/action-toast";
import type { ConversationFileView } from "@/lib/conversation-retrievals";
import { saveTemporaryUrlFile, saveUrlDownload } from "@/lib/device-download";
import { tagFilterContextKey } from "@/lib/tag-client";
import { getUserSearchHistory, promoteCachedUserSearchHistory, removeCachedUserSearchHistory, userSearchHistoryQueryKey } from "@/lib/user-search-history-cache";
import { convertedPngFilename, iphoneMediaFilename, iphoneMediaFormat } from "@/lib/iphone-upload-formats";
import { useAuthStore } from "@/state/auth";
import { EMPTY_SELECTED_TAGS, useUiStore } from "@/state/ui";
import { fonts, palette, radii, spacing } from "@/theme/tokens";

const TEXT_EXTENSIONS = new Set<FileExtension>(["txt", "md"]);

function VideoPreview({ uri }: { uri: string }) {
  const player = useVideoPlayer(uri);
  return <VideoView contentFit="contain" player={player} style={styles.previewImage} />;
}

const dateFormatter = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });

type PendingUpload = { key: string; name: string; extension: FileExtension; uri: string; thumbnailUri?: string; folderKey?: string; scopeKey: string; createdAt: string; order: number };
type SessionUpload = { uiKey: string; uri?: string; createdAt: string; order: number };
type SessionUploadMap = Record<string, SessionUpload>;
const EMPTY_SESSION_UPLOADS: SessionUploadMap = {};
type GridItem = { kind: "upload"; file: PendingUpload; createdAt: string; uiKey: string; order: number } | { kind: "file"; file: ContentFile; createdAt: string; uiKey: string; order: number } | { kind: "folder"; folder: ContentFolder; createdAt: string; uiKey: string; order: number };
type PendingTransfer = { key: string; mode: "move" | "copy"; scopeKey: string; userKey: string; sourceFolderKey?: string; targetFolderKey?: string; folderKeys: string[]; fileKeys: string[]; folders: ContentFolder[]; files: ContentFile[] };

function groupItemsByDate(items: GridItem[]) {
  const groups = new Map<string, GridItem[]>();
  for (const item of [...items].sort((left, right) => right.createdAt.localeCompare(left.createdAt) || left.order - right.order || left.uiKey.localeCompare(right.uiKey))) {
    const label = dateFormatter.format(new Date(item.createdAt));
    const group = groups.get(label);
    if (group) group.push(item);
    else groups.set(label, [item]);
  }
  return [...groups].map(([label, items]) => ({ label, items }));
}

function AudioIsland({ uri, title, onClose }: { uri: string; title: string; onClose: () => void }) {
  const player = useAudioPlayer(uri);
  const status = useAudioPlayerStatus(player);
  useEffect(() => { void setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: "doNotMix", allowsRecording: false, shouldRouteThroughEarpiece: false }); }, []);
  return <AudioPlayback duration={status.duration} error={status.error} onClose={onClose} onSeek={(seconds) => player.seekTo(seconds)} onToggle={() => { if (status.playing) player.pause(); else void player.play(); }} playing={status.playing} position={status.currentTime} title={title} />;
}

export function FilesWorkspace({ initialFileKey, initialFileTitle, initialFolderKey, initialSearchQuery, initialScopeKey, initialFileView, onExitFileView, onBackFileView, generationMode = "chat", fileOnly = false, onCloseFile }: { initialFileKey?: string; initialFileTitle?: string; initialFolderKey?: string; initialSearchQuery?: string; initialScopeKey?: string; initialFileView?: ConversationFileView; onExitFileView?: () => void; onBackFileView?: () => void; generationMode?: "chat" | "image" | "speech" | "video"; fileOnly?: boolean; onCloseFile?: () => void } = {}) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const insets = useSafeAreaInsets();
  const previewBottomInset = Platform.OS === "android" && fileOnly ? insets.bottom : 0;
  const { width } = useWindowDimensions();
  const cardSize = Math.floor((width - spacing.md * 2 - 24) / 4);
  const sessionScopeKey = useAuthStore((state) => typeof state.scope?.key === "string" ? state.scope.key : "");
  const scopeKey = fileOnly && initialScopeKey ? initialScopeKey : sessionScopeKey;
  const userKey = useAuthStore((state) => state.user?.key ?? "");
  const contentContext = useMemo(() => ({ scopeKey, userKey }), [scopeKey, userKey]);
  const fileViewQuery = useConversationFiles(contentContext, initialFileView);
  const sessionUploadQueryKey = ["session-upload-display", userKey, scopeKey] as const;
  const sessionUploadsQuery = useQuery<SessionUploadMap>({ queryKey: sessionUploadQueryKey, queryFn: async () => EMPTY_SESSION_UPLOADS, enabled: false, initialData: EMPTY_SESSION_UPLOADS, gcTime: Infinity });
  const sessionUploads = sessionUploadsQuery.data;
  const configured = isContentContextConfigured(contentContext);
  const tagContextKey = tagFilterContextKey(contentContext);
  const selectedTags = useUiStore((state) => state.selectedTagsByContext[tagContextKey] ?? EMPTY_SELECTED_TAGS);
  const [folderStack, setFolderStack] = useState<ContentFolder[]>([]);
  const [query, setQuery] = useState(initialSearchQuery ?? "");
  const [settledQuery, setSettledQuery] = useState(initialSearchQuery?.trim() ?? "");
  const [sheet, setSheet] = useState<"create" | "filter" | "tags" | "resourceTags" | "history" | "rename" | "delete" | "bulk" | "advanced" | "destination">();
  const [destinationAction, setDestinationAction] = useState<"move" | "copy">();
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [types, setTypes] = useState({ documents: true, images: true, videos: true, audio: true });
  const [selectedFolderKeys, setSelectedFolderKeys] = useState<string[]>([]);
  const [selectedFileKeys, setSelectedFileKeys] = useState<string[]>([]);
  const [nameDraft, setNameDraft] = useState("");
  const [descriptionDraft, setDescriptionDraft] = useState("");
  const [userRefreshing, setUserRefreshing] = useState(false);
  const [loadingMoreKey, setLoadingMoreKey] = useState<string>();
  const [loadMoreErrorKey, setLoadMoreErrorKey] = useState<string>();
  const loadingPages = useRef(new Set<string>());
  const [coreOpen, setCoreOpen] = useState(false);
  const [coreRequest, setCoreRequest] = useState(initialFileView ? 0 : 1);
  const [pendingUploads, setPendingUploads] = useState<PendingUpload[]>([]);
  const [pendingFolders, setPendingFolders] = useState<ContentFolder[]>([]);
  const [pendingTransfers, setPendingTransfers] = useState<PendingTransfer[]>([]);
  const [sessionFolderOrder, setSessionFolderOrder] = useState<Record<string, { createdAt: string; order: number; uiKey: string }>>({});
  const [preview, setPreview] = useState<{ title: string; fileKey?: string; pdfUri?: string; imageUri?: string; text?: string; audioUri?: string; videoUri?: string }>();
  const [previewFailed, setPreviewFailed] = useState(false);
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string>();
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const initialHandled = useRef<string | undefined>(undefined);
  const previewRequest = useRef(0);
  const activePdfUri = useRef<string | undefined>(undefined);
  const pdfFallbackAttempted = useRef(false);
  const previewPdfFile = useRef<File | undefined>(undefined);
  const discardPreviewPdf = useCallback(() => {
    const cached = previewPdfFile.current;
    previewPdfFile.current = undefined;
    try { if (cached?.exists) cached.delete(); } catch { /* The preview cache may already be gone. */ }
  }, []);
  useEffect(() => () => { previewRequest.current += 1; activePdfUri.current = undefined; discardPreviewPdf(); }, [discardPreviewPdf]);
  const bulkMutationLocked = useRef(false);
  const transferLocked = useRef(false);
  const pendingFolderCreates = useRef(new Map<string, Promise<ContentFolder>>());
  const destinationTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const lastFileProcessing = useRef(new Map<string, ContentFile["processing"]>());
  const historyRequest = useRef(0);
  const currentFolder = folderStack.at(-1);
  useEffect(() => () => { if (destinationTimer.current) clearTimeout(destinationTimer.current); }, []);
  useEffect(() => {
    const timeout = setTimeout(() => setSettledQuery(query.trim()), 300);
    return () => clearTimeout(timeout);
  }, [query]);
  const extensions = useMemo(() => {
    const values: FileExtension[] = [];
    if (types.documents) values.push("txt", "md", "docx", "pdf");
    if (types.images) values.push("jpg", "jpeg", "png", "webp", "gif");
    if (types.videos) values.push("mp4", "mov");
    if (types.audio) values.push("mp3");
    return values;
  }, [types]);
  const locationFilters = { favoritesOnly, includeHidden: showHidden };
  const locationOptions = contentLocationQueryOptions(contentContext, currentFolder?.key, locationFilters, { paged: true, extensions });
  const locationIdentity = JSON.stringify(locationOptions.queryKey);
  const locationQuery = useQuery({
    ...locationOptions,
    enabled: configured && !fileOnly && !initialFileView,
    refetchInterval: (query) => query.state.data && query.state.data.folders.length + query.state.data.files.length <= STORAGE_PAGE_SIZE && query.state.data.files.some((file) => file.processing === "pending") ? 2_000 : false,
  });
  useEffect(() => {
    if (!locationQuery.data) return;
    const completed = locationQuery.data.files.some((file) => file.processing === "ready" && lastFileProcessing.current.get(file.key) === "pending");
    for (const file of locationQuery.data.files) lastFileProcessing.current.set(file.key, file.processing);
    if (completed) void queryClient.invalidateQueries({ queryKey: ["file-search", scopeKey] });
  }, [locationQuery.data, queryClient, scopeKey]);
  const searching = Boolean(query.trim()) || selectedTags.length > 0;
  const searchQuery = useQuery({
    queryKey: ["file-search", contentContext.scopeKey, currentFolder?.key ?? null, settledQuery, favoritesOnly, showHidden, selectedTags.map((tag) => tag.key).join(","), extensions.join(",")],
    queryFn: () => searchContent(settledQuery || selectedTags.map((tag) => tag.name).join(" "), currentFolder?.key, { favoritesOnly, includeHidden: showHidden, tagKeys: selectedTags.map((tag) => tag.key), extensions }),
    enabled: configured && !fileOnly && Boolean(settledQuery || selectedTags.length),
  });
  useDebouncedContentSearchHistory({ context: contentContext, enabled: configured, query, settledQuery, search: searchQuery });
  const visiblePendingFolders = pendingFolders.filter((folder) => folder.scopeKey === scopeKey && folder.parentFolderKey === currentFolder?.key && !favoritesOnly);
  const visibleTransfers = pendingTransfers.filter((transfer) => transfer.scopeKey === scopeKey && transfer.userKey === userKey);
  const outgoingTransfers = visibleTransfers.filter((transfer) => transfer.mode === "move" && transfer.sourceFolderKey === currentFolder?.key);
  const incomingTransfers = visibleTransfers.filter((transfer) => transfer.targetFolderKey === currentFolder?.key);
  const copiedFileSources = new Map(visibleTransfers.filter((transfer) => transfer.mode === "copy").flatMap((transfer) => transfer.files.map((file, index) => [file.key, transfer.fileKeys[index]!] as const)));
  const copiedFolderKeys = new Set(visibleTransfers.filter((transfer) => transfer.mode === "copy").flatMap((transfer) => transfer.folders.map(({ key }) => key)));
  const outgoingFolderKeys = new Set(outgoingTransfers.flatMap((transfer) => transfer.folderKeys));
  const outgoingFileKeys = new Set(outgoingTransfers.flatMap((transfer) => transfer.fileKeys));
  const incomingFolders = incomingTransfers.flatMap((transfer) => transfer.folders).filter((folder) => (!favoritesOnly || folder.isFavorite) && (showHidden || !folder.isHidden));
  const incomingFiles = incomingTransfers.flatMap((transfer) => transfer.files).filter((file) => extensions.includes(file.extension) && (!favoritesOnly || file.isFavorite) && (showHidden || !file.isHidden));
  const folders = initialFileView ? [] : [...(locationQuery.data?.folders ?? []).filter((folder) => !outgoingFolderKeys.has(folder.key) && !visiblePendingFolders.some(({ key }) => key === folder.key) && !incomingFolders.some(({ key }) => key === folder.key)), ...visiblePendingFolders, ...incomingFolders].sort((left, right) => left.name.localeCompare(right.name));
  const files = (initialFileView ? fileViewQuery.files : [...(locationQuery.data?.files ?? []).filter((file) => !outgoingFileKeys.has(file.key) && !incomingFiles.some(({ key }) => key === file.key)), ...incomingFiles]).filter((file) => extensions.includes(file.extension));
  const searchResults = useMemo(() => [
    ...(searchQuery.data?.folders ?? []).map((folder) => ({ key: folder.key, kind: "folder" as const, label: folder.name, folder })),
    ...(searchQuery.data?.files ?? []).filter((file) => file.extension && extensions.includes(file.extension)).map((file) => ({ key: file.fileKey, kind: "file" as const, label: file.extension ? displayContentFileName({ name: file.name, extension: file.extension }) : file.name, file })),
  ].sort((left, right) => ("folder" in left ? left.folder.score : left.file.score) < ("folder" in right ? right.folder.score : right.file.score) ? 1 : -1), [searchQuery.data, extensions]);
  const visibleUploads = pendingUploads.filter((file) => !initialFileView && !searching && file.scopeKey === scopeKey && file.folderKey === currentFolder?.key && extensions.includes(file.extension) && !files.some((saved) => sessionUploads[saved.key]?.uiKey === file.key));
  const itemGroups = groupItemsByDate([
    ...visibleUploads.map((file) => ({ kind: "upload" as const, file, createdAt: file.createdAt, uiKey: file.key, order: file.order })),
    ...files.map((file) => ({ kind: "file" as const, file, createdAt: sessionUploads[file.key]?.createdAt ?? file.createdAt, uiKey: sessionUploads[file.key]?.uiKey ?? file.key, order: sessionUploads[file.key]?.order ?? Number.POSITIVE_INFINITY })),
    ...folders.map((folder) => ({ kind: "folder" as const, folder, createdAt: sessionFolderOrder[folder.key]?.createdAt ?? folder.createdAt, uiKey: sessionFolderOrder[folder.key]?.uiKey ?? folder.key, order: sessionFolderOrder[folder.key]?.order ?? Number.POSITIVE_INFINITY })),
  ]);
  const bulkActive = selectedFolderKeys.length + selectedFileKeys.length > 0;
  const selectedFolders = folders.filter((folder) => selectedFolderKeys.includes(folder.key));
  const selectedFiles = files.filter((file) => selectedFileKeys.includes(file.key));
  const tagTargets = useMemo(() => [
    ...selectedFolderKeys.map((key) => ({ type: "folder" as const, key })),
    ...selectedFileKeys.map((key) => ({ type: "file" as const, key })),
  ], [selectedFolderKeys, selectedFileKeys]);
  const allSelectedFavorite = bulkActive && [...selectedFolders, ...selectedFiles].every((item) => item.isFavorite);
  const allSelectedHidden = bulkActive && [...selectedFolders, ...selectedFiles].every((item) => item.isHidden);
  const deleteNoun = selectedFileKeys.length && selectedFolderKeys.length ? "items" : selectedFolderKeys.length ? selectedFolderKeys.length === 1 ? "folder" : "folders" : selectedFileKeys.length === 1 ? "file" : "files";
  const deletableFolders = selectedFolders.filter((folder) => !folder.isFavorite);
  const deletableFiles = selectedFiles.filter((file) => !file.isFavorite);
  const deletableCount = deletableFolders.length + deletableFiles.length;
  const protectedCount = selectedFolderKeys.length + selectedFileKeys.length - deletableCount;
  const filtersActive = favoritesOnly || showHidden || selectedTags.length > 0 || !types.documents || !types.images || !types.videos || !types.audio;

  const refresh = useCallback(async () => {
    setUserRefreshing(true);
    try { if (initialFileView) await fileViewQuery.refresh(); else await locationQuery.refetch(); }
    finally { setUserRefreshing(false); }
  }, [fileViewQuery, initialFileView, locationQuery]);

  const loadMore = (retry = false) => {
    if (initialFileView) { if (!searching) fileViewQuery.loadMore(); return; }
    const previous = queryClient.getQueryData<ContentLocation>(locationOptions.queryKey);
    if (searching || !configured || !previous || !hasMoreContentLocationPages(previous) || loadingPages.current.has(locationIdentity) || (!retry && loadMoreErrorKey === locationIdentity)) return;
    if (retry) setLoadMoreErrorKey(undefined);
    loadingPages.current.add(locationIdentity);
    setLoadingMoreKey(locationIdentity);
    void loadContentLocationPage(contentContext, currentFolder?.key, locationFilters, extensions, previous)
      .then((next) => queryClient.setQueryData<ContentLocation>(locationOptions.queryKey, (current) => current === previous ? next : current))
      .catch(() => { setLoadMoreErrorKey(locationIdentity); showToast({ title: "More files could not be loaded.", duration: 2_500 }); })
      .finally(() => { loadingPages.current.delete(locationIdentity); setLoadingMoreKey((key) => key === locationIdentity ? undefined : key); });
  };

  const prefetchOnScroll = (event: NativeSyntheticEvent<NativeScrollEvent>) => {
    const { contentOffset, contentSize, layoutMeasurement } = event.nativeEvent;
    if (contentOffset.y > 24 && contentSize.height - contentOffset.y - layoutMeasurement.height < layoutMeasurement.height * 2) loadMore();
  };

  const openFile = useCallback(async (file: Pick<ContentFile, "key" | "name" | "extension">, localUri?: string) => {
    const request = ++previewRequest.current;
    setPreviewFailed(false);
    const title = displayContentFileName(file);
    const showPreview = (value: NonNullable<typeof preview>) => {
      if (previewRequest.current !== request) return false;
      discardPreviewPdf();
      activePdfUri.current = value.pdfUri;
      pdfFallbackAttempted.current = false;
      setPreview(value);
      return true;
    };
    try {
      const availableLocalUri = localUri && new File(localUri).exists ? localUri : undefined;
      if (availableLocalUri) {
        if (IMAGE_EXTENSIONS.has(file.extension)) { showPreview({ title, imageUri: availableLocalUri }); return; }
        if (file.extension === "pdf") { showPreview({ title, fileKey: file.key, pdfUri: availableLocalUri }); return; }
        if (file.extension === "mp3") { showPreview({ title, audioUri: availableLocalUri }); return; }
         if (file.extension === "mp4" || file.extension === "mov") { showPreview({ title, videoUri: availableLocalUri }); return; }
      }
      if (availableLocalUri && TEXT_EXTENSIONS.has(file.extension)) {
        showPreview({ title, text: new TextDecoder().decode(await new File(availableLocalUri).arrayBuffer()) });
        return;
      }
      if (availableLocalUri && file.extension === "docx") {
        const mammoth = await import("mammoth");
        const extracted = await mammoth.extractRawText({ arrayBuffer: await new File(availableLocalUri).arrayBuffer() });
        showPreview({ title, text: extracted.value.trim() || "No readable text is available." });
        return;
      }
      const download = await downloadContentFile(file.key, contentContext);
      if (IMAGE_EXTENSIONS.has(file.extension)) { showPreview({ title, imageUri: download.url }); return; }
      if (file.extension === "pdf") { showPreview({ title, fileKey: file.key, pdfUri: download.url }); return; }
      if (TEXT_EXTENSIONS.has(file.extension)) {
        const response = await fetch(download.url);
        showPreview({ title, text: await response.text() });
        return;
      }
      if (file.extension === "docx") {
        const response = await fetch(download.url);
        const bytes = await response.arrayBuffer();
        const mammoth = await import("mammoth");
        const extracted = await mammoth.extractRawText({ arrayBuffer: bytes });
        showPreview({ title, text: extracted.value.trim() || "No readable text is available." });
        return;
      }
      if (file.extension === "mp3") { showPreview({ title, audioUri: download.url }); return; }
       if (file.extension === "mp4" || file.extension === "mov") { showPreview({ title, videoUri: download.url }); return; }
    } catch {
      if (previewRequest.current === request) { discardPreviewPdf(); activePdfUri.current = undefined; setPreview(undefined); setPreviewFailed(true); showToast({ title: "The file could not be opened.", duration: 2_500 }); }
    }
  }, [contentContext, discardPreviewPdf, showToast]);

  const recoverPdfPreview = useCallback(async (sourceUri: string, fileKey?: string) => {
    if (activePdfUri.current !== sourceUri) return;
    if (pdfFallbackAttempted.current || !fileKey) { setPreviewFailed(true); return; }
    pdfFallbackAttempted.current = true;
    const request = previewRequest.current;
    try {
      const signed = await downloadContentFile(fileKey, contentContext);
      const cached = await saveTemporaryUrlFile(`${fileKey}.pdf`, signed.url);
      if (request !== previewRequest.current || activePdfUri.current !== sourceUri) { cached.delete(); return; }
      discardPreviewPdf();
      previewPdfFile.current = cached;
      activePdfUri.current = cached.uri;
      setPreview((current) => current?.pdfUri === sourceUri ? { ...current, pdfUri: cached.uri } : current);
    } catch {
      if (request === previewRequest.current && activePdfUri.current === sourceUri) setPreviewFailed(true);
    }
  }, [contentContext, discardPreviewPdf]);

  const goBack = useCallback(() => {
    if (fileOnly) { onCloseFile?.(); return; }
    previewRequest.current += 1;
    if (preview) { discardPreviewPdf(); activePdfUri.current = undefined; setPreview(undefined); return; }
    if (initialFileView) { onBackFileView?.(); return; }
    if (folderStack.length) { setFolderStack((stack) => stack.slice(0, -1)); return; }
    setCoreRequest((request) => request + 1);
  }, [discardPreviewPdf, fileOnly, folderStack.length, initialFileView, onBackFileView, onCloseFile, preview]);

  useEffect(() => {
    if (Platform.OS !== "android") return;
    const listener = BackHandler.addEventListener("hardwareBackPress", () => {
      if (!fileOnly && (coreOpen || sheet)) return false;
      goBack();
      return true;
    });
    return () => listener.remove();
  }, [coreOpen, fileOnly, goBack, sheet]);

  useEffect(() => {
    const destination = initialFileKey ?? initialFolderKey ?? initialSearchQuery ?? "root";
    if (!configured || initialHandled.current === destination) return;
    initialHandled.current = destination;
    if (initialFolderKey) void findContentFolder(initialFolderKey, contentContext).then((folder) => setFolderStack([folder])).catch(() => undefined);
    if (initialFileKey) {
      void findContentFile(initialFileKey, contentContext).then(openFile).catch(() => {
        setPreviewFailed(true);
        showToast({ title: initialFileTitle ? `${initialFileTitle} could not be opened.` : "The file could not be opened.", duration: 2_500 });
      });
    }
  }, [configured, contentContext, initialFileKey, initialFileTitle, initialFolderKey, initialSearchQuery, openFile, showToast]);

  const pickAndUpload = async (kind: "media" | "other") => {
    let assets: { name: string; mimeType?: string | null; mediaType?: string | null; size?: number; uri: string }[];
    try {
      assets = kind === "media"
        ? await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images", "videos"], allowsMultipleSelection: true, selectionLimit: 20, quality: 1 }).then((result) => result.canceled ? [] : result.assets.map((asset, index) => ({ name: iphoneMediaFilename(asset.fileName, asset.mimeType, asset.type, index), mimeType: asset.mimeType, mediaType: asset.type, size: asset.fileSize, uri: asset.uri })))
        : await DocumentPicker.getDocumentAsync({ multiple: true, copyToCacheDirectory: true, type: ["text/plain", "text/markdown", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document", "audio/mpeg"] }).then((result) => result.canceled ? [] : result.assets);
    } catch {
      showToast({ title: "The file picker could not be opened.", duration: 2_500 });
      return;
    }
    if (!assets.length) return;
    if (assets.length > 20) showToast({ title: "You can upload up to 20 files at a time. Only the first 20 were selected.", duration: 2_500 });
    let prepared: typeof assets;
    try {
      prepared = await Promise.all(assets.slice(0, 20).map(async (asset) => {
        if (kind !== "media" || iphoneMediaFormat(asset.name, asset.mimeType, asset.mediaType) !== "convert-png") return asset;
        const rendered = await ImageManipulator.manipulate(asset.uri).renderAsync();
        const converted = await rendered.saveAsync({ format: SaveFormat.PNG });
        const size = new File(converted.uri).size;
        if (!size) throw new Error("The converted iPhone photo is empty.");
        return { name: convertedPngFilename(asset.name), mimeType: "image/png", size, uri: converted.uri };
      }));
    } catch {
      showToast({ title: "An image could not be prepared for upload.", duration: 2_500 });
      return;
    }
    const accepted = prepared.flatMap((asset) => {
      const name = asset.name ?? "file";
      const extension = name.toLowerCase().split(".").pop();
      if (!extension || !(FILE_EXTENSIONS as readonly string[]).includes(extension)) return [];
      if (kind === "media" ? !(IMAGE_EXTENSIONS.has(extension as FileExtension) || extension === "mp4" || extension === "mov") : IMAGE_EXTENSIONS.has(extension as FileExtension) || extension === "mp4" || extension === "mov") return [];
      return [{ name, extension: extension as FileExtension, type: extension === "mov" ? "video/quicktime" : asset.mimeType ?? "", size: asset.size ?? new File(asset.uri).size, uri: asset.uri }];
    });
    if (accepted.length < Math.min(assets.length, 20)) showToast({ title: kind === "media" ? "Images are saved as PNG. MP4 and MOV videos can be uploaded." : "Only TXT, MD, DOCX, PDF, and MP3 files can be uploaded.", duration: 2_500 });
    if (!accepted.length) return;
    const folderKey = currentFolder?.key;
    const createdAt = new Date().toISOString();
    const optimistic = accepted.map((file, order) => ({ key: createContentRecordKey(), name: file.name, extension: file.extension, uri: file.uri, folderKey, scopeKey, createdAt, order }));
    setPendingUploads((current) => [...optimistic, ...current]);
    try {
      const pendingFolder = folderKey ? pendingFolderCreates.current.get(folderKey) : undefined;
      if (pendingFolder) await pendingFolder;
      const result = await uploadContentFiles(accepted, folderKey, contentContext, createContentMutationKey(), (index, thumbnailUri) => {
        const pendingKey = optimistic[index]?.key;
        if (pendingKey) setPendingUploads((current) => current.map((file) => file.key === pendingKey ? { ...file, thumbnailUri } : file));
      });
      if (result.files.length !== accepted.length) throw new Error("The upload did not return every selected file.");
      const timestamp = new Date().toISOString();
      const completed: ContentFile[] = result.files.map((file, index) => ({ key: file.key, scopeKey, folderKey, name: file.name, extension: file.extension, mimeType: accepted[index]!.type, sizeBytes: accepted[index]!.size, processing: file.processing, hasThumbnail: file.hasThumbnail, isFavorite: false, createdAt: timestamp, updatedAt: timestamp }));
      queryClient.setQueryData<SessionUploadMap>(sessionUploadQueryKey, (current) => ({ ...current, ...Object.fromEntries(completed.map((file, index) => [file.key, { uiKey: optimistic[index]!.key, uri: optimistic[index]!.uri, createdAt, order: index }])) }));
      queryClient.setQueryData<ContentLocation>(locationOptions.queryKey, (current) => current ? { ...current, files: [...completed, ...current.files.filter((file) => !completed.some(({ key }) => key === file.key))] } : current);
      setPendingUploads((current) => current.filter((file) => !optimistic.some(({ key }) => key === file.key)));
      await invalidateContentLocations(queryClient, contentContext, [folderKey]);
      void queryClient.invalidateQueries({ queryKey: ["file-search", scopeKey], refetchType: "none" });
    } catch (error) {
      setPendingUploads((current) => current.filter((file) => !optimistic.some(({ key }) => key === file.key)));
      showToast({ title: error instanceof Error && error.message.startsWith("A preview image could not") ? error.message : "Files could not be uploaded.", duration: 2_500 });
    }
  };

  const clearSelection = () => { setSelectedFolderKeys([]); setSelectedFileKeys([]); };

  const openDestination = (action: "copy" | "move") => {
    if (transferLocked.current) { showToast({ title: "Wait for the current transfer to finish.", duration: 2_500 }); return; }
    if (destinationTimer.current) clearTimeout(destinationTimer.current);
    setDestinationAction(action);
    setSheet(undefined);
    destinationTimer.current = setTimeout(() => { destinationTimer.current = undefined; setSheet("destination"); }, 240);
  };

  const confirmDestination = (folder: ContentFolder | undefined, stack: ContentFolder[]) => {
    const action = destinationAction;
    if (!action || transferLocked.current) return;
    const sourceFolderKey = currentFolder?.key;
    const targetFolderKey = folder?.key;
    if (sourceFolderKey === targetFolderKey) return;
    const sourceFolders = selectedFolderKeys.map((key) => folders.find((item) => item.key === key));
    const sourceFiles = selectedFileKeys.map((key) => files.find((item) => item.key === key));
    if ((!sourceFolders.length && !sourceFiles.length) || sourceFolders.some((item) => !item) || sourceFiles.some((item) => !item)) {
      showToast({ title: "The selection could not be transferred.", duration: 2_500 });
      return;
    }
    transferLocked.current = true;
    const now = new Date().toISOString();
    const transfer: PendingTransfer = {
      key: createContentMutationKey(), mode: action, scopeKey, userKey, sourceFolderKey, targetFolderKey,
      folderKeys: [...selectedFolderKeys], fileKeys: [...selectedFileKeys],
      folders: sourceFolders.map((item) => ({ ...item!, key: action === "copy" ? createContentRecordKey() : item!.key, parentFolderKey: targetFolderKey, createdAt: now, updatedAt: now, ...(action === "copy" ? { isFavorite: false, isHidden: false } : {}) })),
      files: sourceFiles.map((item) => ({ ...item!, key: action === "copy" ? createContentRecordKey() : item!.key, folderKey: targetFolderKey, createdAt: now, updatedAt: now, ...(action === "copy" ? { isFavorite: false, isHidden: false } : {}) })),
    };
    if (action === "copy") transfer.files.forEach((item, index) => {
       if (item.extension !== "mp4" && item.extension !== "mov") return;
      const sourceKey = transfer.fileKeys[index]!;
      const thumbnail = queryClient.getQueryData<string>(["video-thumbnail", sessionUploads[sourceKey]?.uiKey ?? sourceKey]);
      if (thumbnail) queryClient.setQueryData(["video-thumbnail", item.key], thumbnail);
    });
    const previous = queryClient.getQueriesData<ContentLocation>({ queryKey: contentQueryKeys.locations(contentContext) });
    const selectedFolderSet = new Set(transfer.folderKeys);
    const selectedFileSet = new Set(transfer.fileKeys);
    for (const [key, location] of previous) {
      if (!location) continue;
      const locationKey = key[4] ?? null;
      if (locationKey !== (sourceFolderKey ?? null) && locationKey !== (targetFolderKey ?? null)) continue;
      const destination = locationKey === (targetFolderKey ?? null);
      const favoritesOnly = key.at(-2) === true;
      const showHiddenInCache = key.at(-1) === true;
      queryClient.setQueryData<ContentLocation>(key, {
        ...location,
        folders: [...location.folders.filter((item) => action !== "move" || !selectedFolderSet.has(item.key)), ...(destination ? transfer.folders.filter((item) => (!favoritesOnly || item.isFavorite) && (showHiddenInCache || !item.isHidden)) : [])],
        files: [...location.files.filter((item) => action !== "move" || !selectedFileSet.has(item.key)), ...(destination ? transfer.files.filter((item) => (!favoritesOnly || item.isFavorite) && (showHiddenInCache || !item.isHidden)) : [])],
      });
    }
    setPendingTransfers((current) => [...current, transfer]);
    clearSelection();
    setSheet(undefined);
    setDestinationAction(undefined);
    setQuery("");
    useUiStore.getState().setSelectedTags(tagContextKey, []);
    setFavoritesOnly(false);
    setFolderStack(stack);
    const noun = transfer.folderKeys.length && transfer.fileKeys.length ? "Items" : transfer.folderKeys.length ? transfer.folderKeys.length === 1 ? "Folder" : "Folders" : transfer.fileKeys.length === 1 ? "File" : "Files";
    showToast({ title: `${noun} ${action === "move" ? "moved" : "copied"}`, duration: 2_000 });

    void (action === "copy" ? copyContentSelection(transfer, targetFolderKey) : moveContentSelection(transfer, targetFolderKey))
      .then(async (outcome) => {
        if (outcome.failed || outcome.folders.length !== transfer.folders.length || outcome.files.length !== transfer.files.length) throw new Error("Transfer did not complete.");
        for (const [key] of previous) {
          if ((key[4] ?? null) !== (targetFolderKey ?? null)) continue;
          const favoritesOnly = key.at(-2) === true;
          const showHiddenInCache = key.at(-1) === true;
          queryClient.setQueryData<ContentLocation>(key, (location) => location ? {
            ...location,
            folders: [...location.folders.filter((item) => !transfer.folders.some(({ key: optimisticKey }) => optimisticKey === item.key) && !outcome.folders.some(({ key: savedKey }) => savedKey === item.key)), ...outcome.folders.filter((item) => (!favoritesOnly || item.isFavorite) && (showHiddenInCache || !item.isHidden))],
            files: [...location.files.filter((item) => !transfer.files.some(({ key: optimisticKey }) => optimisticKey === item.key) && !outcome.files.some(({ key: savedKey }) => savedKey === item.key)), ...outcome.files.filter((item) => (!favoritesOnly || item.isFavorite) && (showHiddenInCache || !item.isHidden))],
          } : location);
        }
        queryClient.setQueryData<SessionUploadMap>(sessionUploadQueryKey, (current) => ({ ...current, ...Object.fromEntries(outcome.files.map((item, index) => [item.key, { uiKey: transfer.files[index]!.key, uri: sessionUploads[transfer.fileKeys[index]!]?.uri, createdAt: now, order: index }])) }));
        setSessionFolderOrder((current) => ({ ...current, ...Object.fromEntries(outcome.folders.map((item, index) => [item.key, { uiKey: transfer.folders[index]!.key, createdAt: now, order: index }])) }));
        setPendingTransfers((current) => current.filter((item) => item.key !== transfer.key));
        await invalidateContentLocations(queryClient, contentContext, [sourceFolderKey, targetFolderKey]);
        void queryClient.invalidateQueries({ queryKey: ["file-search", scopeKey] });
      })
      .catch(() => {
        for (const [key, location] of previous) queryClient.setQueryData(key, location);
        setPendingTransfers((current) => current.filter((item) => item.key !== transfer.key));
        void Promise.all([sourceFolderKey, targetFolderKey].map((folderKey) => queryClient.invalidateQueries({ queryKey: contentQueryKeys.location(contentContext, folderKey) })));
        showToast({ title: `${noun} could not be ${action === "move" ? "moved" : "copied"}.`, duration: 2_500 });
      })
      .finally(() => { transferLocked.current = false; });
  };

  const submitFolder = () => {
    const name = nameDraft.trim();
    if (!name || !configured) return;
    const description = descriptionDraft.trim();
    const parentFolderKey = currentFolder?.key;
    const key = createContentRecordKey();
    const timestamp = new Date().toISOString();
    const optimistic: ContentFolder = { key, scopeKey, ...(parentFolderKey ? { parentFolderKey } : {}), name, ...(description ? { description } : {}), isFavorite: false, isHidden: false, createdAt: timestamp, updatedAt: timestamp };
    setPendingFolders((current) => [...current, optimistic]);
    addCachedContentFolder(queryClient, contentContext, parentFolderKey, optimistic);
    queryClient.setQueryData<ContentFolder[]>(["folder-tree", userKey, scopeKey], (tree) => tree ? [...tree, optimistic] : tree);
    setNameDraft("");
    setDescriptionDraft("");
    setSheet(undefined);
    showToast({ title: "Folder created", duration: 2_000 });

    const creation = (async () => {
      const pendingParent = parentFolderKey ? pendingFolderCreates.current.get(parentFolderKey) : undefined;
      if (pendingParent) await pendingParent;
      return createContentFolder(name, parentFolderKey, description, `folder-create:${key}`, key);
    })();
    pendingFolderCreates.current.set(key, creation);
    void creation.then((folder) => {
      if (folder.key !== key) throw new Error("The created folder key did not match the pending folder.");
      addCachedContentFolder(queryClient, contentContext, parentFolderKey, folder);
      queryClient.setQueryData<ContentFolder[]>(["folder-tree", userKey, scopeKey], (tree) => tree?.map((entry) => entry.key === key ? folder : entry));
      setFolderStack((stack) => stack.map((entry) => entry.key === key ? folder : entry));
      setPendingFolders((current) => current.filter((entry) => entry.key !== key));
      void invalidateContentLocations(queryClient, contentContext, [parentFolderKey, key]);
      void queryClient.invalidateQueries({ queryKey: ["file-search", scopeKey] });
    }).catch((error: unknown) => {
      removeCachedContentFolder(queryClient, contentContext, key);
      queryClient.setQueryData<ContentFolder[]>(["folder-tree", userKey, scopeKey], (tree) => tree?.filter((entry) => entry.key !== key));
      queryClient.removeQueries({ queryKey: contentQueryKeys.location(contentContext, key) });
      setPendingFolders((current) => current.filter((entry) => entry.key !== key));
      setFolderStack((stack) => { const index = stack.findIndex((entry) => entry.key === key); return index < 0 ? stack : stack.slice(0, index); });
      showToast({ title: error instanceof Error ? error.message : "The folder could not be created.", duration: 2_500 });
    }).finally(() => {
      if (pendingFolderCreates.current.get(key) === creation) pendingFolderCreates.current.delete(key);
    });
  };

  const downloadSelection = () => {
    if (selectedFolderKeys.length || !selectedFileKeys.length) return;
    const fileKeys = [...selectedFileKeys];
    clearSelection();
    setSheet(undefined);
    if (!fileKeys.length) return;
    showToast({ title: "Files downloaded", duration: 2_000 });
    void Promise.all(fileKeys.map(async (key) => {
      const download = await downloadContentFile(key);
      await saveUrlDownload(download.url, download.fileName, download.mimeType);
    })).catch(() => showToast({ title: "Files could not be downloaded.", duration: 2_500 }));
  };

  const openSearchHistory = () => {
    const request = ++historyRequest.current;
    setHistory(queryClient.getQueryData<ContentSearchHistoryItem[]>(userSearchHistoryQueryKey(userKey)) ?? []);
    setHistoryError(undefined);
    setHistoryLoading(true);
    setRemovingHistoryQuery(undefined);
    setSheet("history");
    void queryClient.invalidateQueries({ queryKey: userSearchHistoryQueryKey(userKey), exact: true, refetchType: "none" })
      .then(() => getUserSearchHistory(queryClient, contentContext))
      .then((items) => { if (historyRequest.current === request) setHistory(items); })
      .catch((error) => { if (historyRequest.current === request) setHistoryError(error instanceof Error ? error.message : "Search history could not be loaded."); })
      .finally(() => { if (historyRequest.current === request) setHistoryLoading(false); });
  };

  const removeSearchHistory = async (item: ContentSearchHistoryItem) => {
    const previous = removeCachedUserSearchHistory(queryClient, contentContext, item.normalizedQuery);
    setHistory((current) => current.filter((entry) => entry.normalizedQuery !== item.normalizedQuery));
    setRemovingHistoryQuery(item.normalizedQuery);
    try {
      await deleteContentSearchHistory(item.normalizedQuery);
    } catch {
      queryClient.setQueryData(userSearchHistoryQueryKey(userKey), previous);
      setHistory(previous);
      showToast({ title: "Search could not be removed.", duration: 2_500 });
    } finally {
      setRemovingHistoryQuery(undefined);
    }
  };

  const applyBulk = async (action: "favorite" | "unfavorite" | "hide" | "reveal" | "delete") => {
    if (bulkMutationLocked.current) return;
    bulkMutationLocked.current = true;
    const folderKeys = action === "delete" ? deletableFolders.map(({ key }) => key) : [...selectedFolderKeys];
    const fileKeys = action === "delete" ? deletableFiles.map(({ key }) => key) : [...selectedFileKeys];
    const selectionCount = folderKeys.length + fileKeys.length;
    const selectedCount = selectedFolderKeys.length + selectedFileKeys.length;
    const noun = selectedFolderKeys.length && selectedFileKeys.length ? ["Item", "items"] : selectedFolderKeys.length ? ["Folder", "folders"] : ["File", "files"];
    const previous = queryClient.getQueriesData<ContentLocation>({ queryKey: contentQueryKeys.locations(contentContext) });
    const folderSet = new Set(folderKeys);
    const fileSet = new Set(fileKeys);
    const isFavorite = action === "favorite";
    const isHidden = action === "hide";
    setSheet(undefined);
    if (action !== "delete") {
      const now = new Date().toISOString();
      for (const [key, location] of previous) {
        if (!location) continue;
        const filtered = typeof key.at(-2) === "boolean" && typeof key.at(-1) === "boolean";
        const favoritesFilter = filtered && key.at(-2) === true;
        const hiddenFilter = filtered && key.at(-1) !== true;
        const patch = <T extends ContentFolder | ContentFile>(items: T[], selected: Set<string>) => items.flatMap((item) => {
          if (!selected.has(item.key)) return [item];
          const updated = { ...item, ...(action === "favorite" || action === "unfavorite" ? { isFavorite } : { isHidden }), updatedAt: now };
          return (favoritesFilter && !updated.isFavorite) || (hiddenFilter && updated.isHidden) ? [] : [updated as T];
        });
        queryClient.setQueryData<ContentLocation>(key, { ...location, folders: patch(location.folders, folderSet), files: patch(location.files, fileSet) });
      }
      clearSelection();
      showToast({ title: actionToast(selectedCount, noun[0]!, noun[1]!, { favorite: "favorited", unfavorite: "unfavorited", hide: "hidden", reveal: "revealed" }[action]), duration: 2_000 });
    }
    try {
      if (action === "delete") {
        await Promise.all([...folderKeys.map((key) => deleteContentFolder(key).then(() => removeCachedContentFolder(queryClient, contentContext, key))), ...fileKeys.map((key) => deleteContentFile(key).then(() => removeCachedContentFile(queryClient, contentContext, key)))]);
      } else {
        if (action === "favorite" || action === "unfavorite") {
          await Promise.all([...folderKeys.map((key) => setContentFolderFavorite(key, isFavorite)), ...fileKeys.map((key) => setContentFileFavorite(key, isFavorite))]);
        } else {
          await Promise.all([...folderKeys.map((key) => updateContentFolder(key, { isHidden })), ...fileKeys.map((key) => updateContentFile(key, { isHidden }))]);
        }
      }
      if (action === "delete") clearSelection();
      void queryClient.invalidateQueries({ queryKey: contentQueryKeys.locations(contentContext), refetchType: "none" });
      if (initialFileView) void fileViewQuery.refresh(); else void locationQuery.refetch();
      void queryClient.invalidateQueries({ queryKey: ["file-search", scopeKey] });
      if (action === "delete" && protectedCount) showToast({ title: `${protectedCount} favorite ${protectedCount === 1 ? "item was" : "items were"} kept.`, duration: 2_500 });
    } catch {
      if (action !== "delete") {
        for (const [key, location] of previous) queryClient.setQueryData(key, location);
        setSelectedFolderKeys(folderKeys);
        setSelectedFileKeys(fileKeys);
      }
      void queryClient.invalidateQueries({ queryKey: contentQueryKeys.locations(contentContext), refetchType: "none" });
      if (initialFileView) void fileViewQuery.refresh(); else void locationQuery.refetch();
      showToast({ title: action === "delete" ? "Items could not be deleted." : `${selectionCount === 1 ? noun[0] : noun[1]} could not be ${action === "hide" ? "hidden" : action === "reveal" ? "revealed" : `${action}d`}.`, duration: 2_500 });
    } finally {
      bulkMutationLocked.current = false;
    }
  };

  const initialLoading = initialFileView ? fileViewQuery.loading : locationQuery.isPending && !visibleUploads.length && !visiblePendingFolders.length && !incomingFolders.length && !incomingFiles.length;
  const loading = false;
  const empty = !initialLoading && !(initialFileView && fileViewQuery.error) && !folders.length && !files.length && !visibleUploads.length && !(initialFileView ? fileViewQuery.hasMore : hasMoreContentLocationPages(locationQuery.data));
  const matchingEmpty = empty && (filtersActive || Boolean(initialFileView));
  const core = <CoreComposer accessibilityLabel="Ask Core about your files" expandedPrompts={[...CORE_PLACEHOLDER_PROMPTS]} generationMode={generationMode} leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />} onChangeText={() => undefined} onFocusChange={(focused) => { setCoreOpen(focused); if (focused && initialFileView) onExitFileView?.(); }} onSubmit={() => undefined} openOnMount={!initialFileKey && !initialFileView} openRequest={initialFileView ? 0 : coreRequest} pageIdentity={() => <AgentSwitcher />} prompts={CORE_PLACEHOLDER_PROMPTS} sendIcon={<SendIcon size="sm" />} value="" />;

  const previewPane = preview ? <View style={[styles.previewPane, { paddingBottom: previewBottomInset }]}>
    <View style={[styles.titleRow, styles.previewTitleRow]}>
      <Button accessibilityLabel={fileOnly ? "Back to Core" : "Back"} contentMode="raw" onPress={goBack} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button>
      <Text numberOfLines={1} style={styles.title}>{preview.title}</Text>
    </View>
    {preview.audioUri ? <AudioIsland onClose={goBack} title={preview.title} uri={preview.audioUri} /> : preview.pdfUri ? <FileViewer error={previewFailed ? "The PDF could not be rendered." : undefined} hideHeader onBack={goBack} onMenu={() => undefined} onRenderError={() => { void recoverPdfPreview(preview.pdfUri!, preview.fileKey); }} pdfUri={preview.pdfUri} title={preview.title} /> : preview.imageUri ? <Image contentFit="contain" source={preview.imageUri} style={styles.previewImage} /> : preview.videoUri ? <VideoPreview uri={preview.videoUri} /> : <ScrollView contentContainerStyle={styles.previewText}><Text selectable style={styles.bodyText}>{preview.text}</Text></ScrollView>}
  </View> : null;

  if (fileOnly) return <View style={styles.root}>
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}><AgentSwitcher /><ProfileHeaderRight /></View>
    {previewPane ?? <View style={[styles.previewPane, { paddingBottom: previewBottomInset }]}><View style={[styles.titleRow, styles.previewTitleRow]}><Button accessibilityLabel="Back to Core" contentMode="raw" onPress={goBack} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button><Text numberOfLines={1} style={styles.title}>{initialFileTitle ?? "File"}</Text></View>{previewFailed ? <View style={styles.emptyFill}><Text style={styles.empty}>The file could not be opened.</Text></View> : null}</View>}
  </View>;

  const workspace = <>
    <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
      <AgentSwitcher />
      <ProfileHeaderRight />
    </View>
    {previewPane ??
    <ScrollView contentContainerStyle={[styles.scroll, empty && styles.scrollFill]} keyboardShouldPersistTaps="handled" onScroll={prefetchOnScroll} onScrollBeginDrag={() => loadMore(true)} refreshControl={<PullToRefresh enabled={configured} onRefresh={() => void refresh()} refreshing={userRefreshing} />} scrollEventThrottle={100} showsVerticalScrollIndicator={false} style={styles.scrollView}>
      <View style={styles.titleRow}>
          <Button accessibilityLabel={currentFolder ? "Back to parent folder" : "Back to Core"} contentMode="raw" onPress={goBack} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button>
        <Text numberOfLines={1} style={styles.title}>{currentFolder?.name ?? "Storage"}</Text>
        <Button accessibilityLabel="Create or upload" contentMode="raw" onPress={() => setSheet("create")} size="xs" variant="icon"><PlusIcon size="sm" /></Button>
      </View>
      <View style={styles.searchRow}>
        <View style={styles.search}>
          <SearchIcon size="sm" variant="muted" />
            <TextInput accessibilityLabel="Search files" maxLength={500} onChangeText={(value) => { if (initialFileView && value) onExitFileView?.(); setQuery(value); }} placeholder="Search anything..." style={styles.searchInput} value={query} />
          {query ? <Button accessibilityLabel="Clear search" contentMode="raw" iconOnly onPress={() => setQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}
        </View>
        <Button accessibilityLabel="Filter files" contentMode="raw" onPress={() => { if (initialFileView) onExitFileView?.(); setSheet("filter"); }} size="md" variant="icon"><FilterIcon size="sm" variant={filtersActive ? "accent" : "default"} /></Button>
      </View>
      <TagFilterLane context={contentContext} />
      {bulkActive ? <Tabs style={styles.bulkBar}>
        <View style={styles.bulkSelection}><Button accessibilityLabel="Clear selection" contentMode="raw" onPress={clearSelection} size="xs" variant="icon"><CloseIcon size="sm" /></Button><Text style={styles.bulkLabel}>{selectedFolderKeys.length + selectedFileKeys.length} selected</Text></View>
        <Button accessibilityLabel="Selected file actions" contentMode="raw" onPress={() => setSheet("bulk")} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
      </Tabs> : null}
       {!searching && initialLoading ? <View accessibilityLabel="Loading files" style={styles.grid}>{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} style={[styles.card, styles.gridSkeleton, { width: cardSize, height: cardSize }]} />)}</View> : null}
       {initialFileView && fileViewQuery.error ? <View style={styles.emptyFill}><Text style={styles.empty}>Files could not be loaded.</Text><Button onPress={() => void fileViewQuery.refresh()} size="md" variant="secondary">Retry</Button></View> : null}
       {searching ? query.trim() !== settledQuery || searchQuery.isPending ? <View style={styles.grid}>{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} style={[styles.card, styles.gridSkeleton, { width: cardSize, height: cardSize }]} />)}</View> : searchQuery.isError ? <View style={styles.emptyFill}><Text style={styles.empty}>Search could not be completed.</Text><Button onPress={() => void searchQuery.refetch()} size="md" variant="secondary">Retry</Button></View> : searchResults.length ? <SearchResultsGrid horizontalInset={spacing.md} items={searchResults} onOpen={(item) => { setQuery(""); if ("folder" in item) setFolderStack((stack) => [...stack, item.folder]); else if (item.file.extension) void openFile({ key: item.key, name: item.file.name, extension: item.file.extension }, sessionUploads[item.key]?.uri); else void findContentFile(item.key, contentContext).then((file) => openFile(file, sessionUploads[file.key]?.uri)).catch(() => showToast({ title: "The file could not be opened.", duration: 2_500 })); }} renderCover={(item) => "file" in item ? <FileCover file={{ key: item.file.fileKey, extension: item.file.extension ?? "txt" }} localUri={sessionUploads[item.key]?.uri} /> : <FolderIcon size="lg" />} renderLabel={(item) => "folder" in item ? <Text ellipsizeMode="tail" numberOfLines={1} style={styles.cardLabel}>{item.label}</Text> : <FileCardLabel extension={item.file.extension ?? "txt"} name={item.label} />} /> : <View style={styles.emptyFill}><Text style={styles.empty}>No matching files.</Text></View> : loading ? <View style={styles.grid}>{Array.from({ length: 8 }, (_, index) => <Skeleton key={index} style={[styles.card, styles.gridSkeleton, { width: cardSize, height: cardSize }]} />)}</View> : matchingEmpty ? <View style={styles.emptyFill}><Text style={styles.empty}>No matching files.</Text></View> : empty ? <View style={styles.emptyFill}><Text style={styles.empty}>No files yet.</Text><Button accessibilityLabel="Create or upload" contentMode="raw" onPress={() => setSheet("create")} size="lg" variant="icon"><PlusIcon size="lg" /></Button></View> : <View style={styles.fileSections}>
        {itemGroups.map((group) => <View key={group.label} style={styles.dateGroup}>
         <Text style={styles.dateHeading}>{group.label}</Text>
         <View style={styles.grid}>
          {group.items.map((entry) => {
            if (entry.kind === "folder") {
              const folder = entry.folder;
              const copying = copiedFolderKeys.has(folder.key);
              const selected = !copying && selectedFolderKeys.includes(folder.key);
               return <FolderTile accessibilityLabel={`${copying ? "Copying" : bulkActive ? selected ? "Deselect" : "Select" : "Open"} ${folder.name}`} busy={copying} key={entry.uiKey} label={folder.name} onLongPress={copying ? undefined : () => { if (bulkActive) setSelectedFolderKeys((keys) => keys.includes(folder.key) ? keys.filter((key) => key !== folder.key) : [...keys, folder.key]); else { setSelectedFolderKeys([folder.key]); setSelectedFileKeys([]); } }} onPress={() => { if (copying) return; if (bulkActive) setSelectedFolderKeys((keys) => keys.includes(folder.key) ? keys.filter((key) => key !== folder.key) : [...keys, folder.key]); else { setQuery(""); setFolderStack((stack) => [...stack, folder]); } }} selected={selected} size={cardSize} />;
            }
            const file = entry.file;
           const copiedSourceKey = copiedFileSources.get(file.key);
           const selected = entry.kind === "file" && !copiedSourceKey && selectedFileKeys.includes(file.key);
            return <ContentFileTile
              accessibilityLabel={`${entry.kind === "upload" ? "Open uploading" : copiedSourceKey ? "Open copying" : bulkActive ? selected ? "Deselect" : "Select" : "Open"} ${displayContentFileName(file)}`}
              busy={entry.kind === "upload" || Boolean(copiedSourceKey)}
              coverFileKey={copiedSourceKey}
              coverKey={copiedSourceKey ? sessionUploads[copiedSourceKey]?.uiKey ?? copiedSourceKey : entry.uiKey}
              file={file}
              key={entry.uiKey}
              localUri={entry.kind === "upload" ? entry.file.uri : copiedSourceKey ? sessionUploads[copiedSourceKey]?.uri : sessionUploads[entry.file.key]?.uri}
              thumbnailUri={entry.kind === "upload" ? entry.file.thumbnailUri : undefined}
              onLongPress={entry.kind === "file" && !copiedSourceKey ? () => { if (bulkActive) setSelectedFileKeys((keys) => keys.includes(file.key) ? keys.filter((key) => key !== file.key) : [...keys, file.key]); else { setSelectedFileKeys([file.key]); setSelectedFolderKeys([]); } } : undefined}
              onPress={() => { if (entry.kind === "upload") { if (!bulkActive) void openFile(entry.file, entry.file.uri); } else if (copiedSourceKey) { if (!bulkActive) void openFile({ ...entry.file, key: copiedSourceKey }, sessionUploads[copiedSourceKey]?.uri); } else if (bulkActive) setSelectedFileKeys((keys) => keys.includes(entry.file.key) ? keys.filter((key) => key !== entry.file.key) : [...keys, entry.file.key]); else void openFile(entry.file, sessionUploads[entry.file.key]?.uri); }}
              selected={selected}
              size={cardSize}
            />;
          })}
          </View>
         </View>)}
         {!searching && (initialFileView ? fileViewQuery.loadingMore : loadingMoreKey === locationIdentity) ? <View accessibilityLabel="Loading more files" style={styles.grid}>{Array.from({ length: 4 }, (_, index) => <Skeleton key={index} style={[styles.card, styles.gridSkeleton, { width: cardSize, height: cardSize }]} />)}</View> : null}
         {initialFileView && fileViewQuery.moreError ? <Button onPress={() => fileViewQuery.loadMore()} size="md" variant="secondary">Retry more files</Button> : null}
       </View>}
    </ScrollView>}
  </>;

  return <View style={styles.root}>
    {workspace}
    {core}
    {initialFileView && !coreOpen && !preview ? <View pointerEvents="box-none" style={[styles.fileViewIsland, { bottom: insets.bottom + 92 }]}><Button onPress={() => onExitFileView?.()} size="md" variant="secondary">View all files</Button></View> : null}
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open && sheet === "create") setSheet(undefined); }} open={sheet === "create"} title="">
      <BottomSheetMenu>
          <BottomSheetItem onPress={() => { setNameDraft(""); setDescriptionDraft(""); setSheet("rename"); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Create folder</BottomSheetItem>
        <BottomSheetItem onPress={() => { setSheet(undefined); void pickAndUpload("media"); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Images or videos</BottomSheetItem>
        <BottomSheetItem onPress={() => { setSheet(undefined); void pickAndUpload("other"); }} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Other files</BottomSheetItem>
      </BottomSheetMenu>
    </BottomSheet>
    <BottomSheet hideHeading onOpenChange={(open) => { if (!open && sheet === "filter") setSheet(undefined); }} open={sheet === "filter"} title="">
      <View style={styles.filterContent}>
         <View style={styles.filterRow}><Switch accessibilityLabel="Favorites" checked={favoritesOnly} onCheckedChange={(checked) => { setFavoritesOnly(checked); setSheet(undefined); }} /><Text style={styles.filterLabel}>Favorites</Text></View>
         <View style={styles.filterRow}><Switch accessibilityLabel="Show hidden" checked={showHidden} onCheckedChange={(checked) => { setShowHidden(checked); setSheet(undefined); }} /><Text style={styles.filterLabel}>Show hidden</Text></View>
         {(["documents", "images", "videos", "audio"] as const).map((key) => <View key={key} style={styles.filterRow}><Switch accessibilityLabel={key} checked={types[key]} onCheckedChange={(checked) => { setTypes((current) => ({ ...current, [key]: checked })); setSheet(undefined); }} /><Text style={styles.filterLabel}>{key[0]!.toUpperCase() + key.slice(1)}</Text></View>)}
         <Button onPress={() => setSheet("tags")} size="md" variant="secondary">Tags</Button>
         <Button onPress={openSearchHistory} size="md" variant="secondary">Search history</Button>
      </View>
    </BottomSheet>
     <TagFilterSheet context={contentContext} onClose={() => setSheet(undefined)} open={sheet === "tags"} />
     <ResourceTagsSheet context={contentContext} onApply={clearSelection} onClose={() => setSheet(undefined)} open={sheet === "resourceTags"} targets={tagTargets} />
     <SearchHistorySheet error={historyError} history={history} loading={historyLoading} onClose={() => { historyRequest.current += 1; setSheet(undefined); }} onRemove={(item) => { void removeSearchHistory(item); }} onSelect={(item) => { promoteCachedUserSearchHistory(queryClient, contentContext, item); setQuery(item.query); setSheet(undefined); }} open={sheet === "history"} removingQuery={removingHistoryQuery} />
      <BottomSheet footer={<><Button disabled={!nameDraft.trim() || !configured} onPress={submitFolder} size="md" variant="primary">Create folder</Button><Button onPress={() => setSheet(undefined)} size="md" variant="secondary">Close</Button></>} height="full" onOpenChange={(open) => { if (!open && sheet === "rename") setSheet(undefined); }} open={sheet === "rename"} title="Create folder">
        <View style={styles.namingForm}>
          <Text style={styles.inputLabel}>Folder name</Text>
          <TextInput accessibilityLabel="New folder name" maxLength={255} onChangeText={setNameDraft} placeholder="Folder name" value={nameDraft} />
          <Text style={styles.inputLabel}>Description (Optional)</Text>
          <TextInput accessibilityLabel="New folder description" maxLength={2000} multiline onChangeText={setDescriptionDraft} placeholder="What belongs in this folder?" style={styles.folderDescriptionInput} textAlignVertical="top" value={descriptionDraft} />
        </View>
    </BottomSheet>
    <DestinationFolderSheet
      action={destinationAction ?? "move"}
       blockedFolderKeys={selectedFolderKeys}
       context={contentContext}
       key={currentFolder?.key ?? "root"}
       sourceStack={folderStack}
       sourceFolderKey={currentFolder?.key}
      onClose={() => { setSheet(undefined); setDestinationAction(undefined); }}
      onConfirm={confirmDestination}
      open={sheet === "destination"}
    />
     <BottomSheet hideHeading onOpenChange={(open) => { if (!open && sheet === "bulk") setSheet(undefined); }} open={sheet === "bulk"} title="">
       <BottomSheetMenu>
         <BottomSheetItem onPress={() => void applyBulk(allSelectedFavorite ? "unfavorite" : "favorite")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">{allSelectedFavorite ? "Unfavorite" : "Favorite"}</BottomSheetItem>
         <BottomSheetItem onPress={() => setSheet("resourceTags")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Tags</BottomSheetItem>
          {!selectedFolderKeys.length && selectedFileKeys.length ? <BottomSheetItem onPress={downloadSelection} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Download</BottomSheetItem> : null}
         <BottomSheetItem onPress={() => setSheet("advanced")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Advanced</BottomSheetItem>
       </BottomSheetMenu>
     </BottomSheet>
       <BottomSheet hideHeading onOpenChange={(open) => { if (!open && sheet === "advanced") setSheet("bulk"); }} open={sheet === "advanced"} title="">
         <BottomSheetMenu>
          <BottomSheetItem onPress={() => openDestination("copy")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Copy to folder</BottomSheetItem>
          <BottomSheetItem onPress={() => openDestination("move")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Move to folder</BottomSheetItem>
          <BottomSheetItem onPress={() => void applyBulk(allSelectedHidden ? "reveal" : "hide")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">{allSelectedHidden ? "Reveal" : "Hide"}</BottomSheetItem>
         <BottomSheetItem onPress={() => setSheet("delete")} style={styles.sheetAction} textStyle={styles.sheetActionText} variant="secondary">Delete</BottomSheetItem>
       </BottomSheetMenu>
     </BottomSheet>
      <BottomSheet footer={<><Button disabled={!deletableCount} onPress={() => void applyBulk("delete")} size="md" variant="primary">Delete</Button><Button onPress={() => setSheet("advanced")} size="md" variant="secondary">Close</Button></>} onOpenChange={(open) => { if (!open && sheet === "delete") setSheet("advanced"); }} open={sheet === "delete"} title={`Delete ${selectedFolderKeys.length + selectedFileKeys.length === 1 ? deleteNoun : `${selectedFolderKeys.length + selectedFileKeys.length} ${deleteNoun}`}?`} />
  </View>;
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderBottomColor: palette.hairline, borderBottomWidth: 1 },
  previewPane: { flex: 1 },
  fileViewIsland: { position: "absolute", alignSelf: "center" },
  scrollView: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.md },
  scrollFill: { flexGrow: 1 },
  titleRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  title: { flex: 1, color: palette.silver50, fontFamily: fonts.medium, fontSize: 24 },
  previewTitleRow: { marginTop: spacing.md, paddingHorizontal: spacing.md },
  searchRow: { minHeight: 44, flexDirection: "row", alignItems: "center", gap: 8 },
  search: { minHeight: 44, flex: 1, flexDirection: "row", alignItems: "center", gap: 7, paddingLeft: 12, paddingRight: 8, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1 },
  searchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  fileSections: { gap: spacing.xs },
  dateGroup: { gap: spacing.xs },
  dateHeading: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 11 },
  gridSkeleton: { backgroundColor: palette.hairlineBright },
  card: { borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised, overflow: "hidden" },
  cardLabel: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  emptyFill: { flexGrow: 1, alignItems: "center", justifyContent: "center", gap: spacing.md, width: "100%" },
  empty: { color: palette.silver500, fontFamily: fonts.regular, textAlign: "center" },
  sheetAction: { justifyContent: "center" },
  sheetActionText: { width: "100%", textAlign: "center" },
  previewImage: { flex: 1, width: "100%" },
  previewText: { padding: spacing.md },
  bodyText: { color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26 },
  filterContent: { gap: spacing.sm },
  filterRow: { minHeight: 28, flexDirection: "row", alignItems: "center", gap: spacing.sm },
  filterLabel: { color: palette.text, fontSize: 13 },
  namingForm: { flex: 1, gap: spacing.sm },
  inputLabel: { marginLeft: 2, color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 0.4 },
  folderDescriptionInput: { minHeight: 120 },
  bulkBar: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "space-between", padding: 5, backgroundColor: palette.panel },
  bulkSelection: { flexDirection: "row", alignItems: "center", gap: 8 },
  bulkLabel: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
});
