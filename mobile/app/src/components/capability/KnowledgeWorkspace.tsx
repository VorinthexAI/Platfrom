import { useNavigation } from "expo-router";
import { File, Paths } from "expo-file-system";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeSyntheticEvent, type TextLayoutEventData } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Badge } from "@vorinthex/shared/ui/badge";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { FileViewer } from "@vorinthex/shared/ui/file-viewer";
import { highlightedSegments, searchDocumentPassagesLiteral, type DocumentPassage, type HighlightRange } from "@vorinthex/shared/ui/document-search";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";
import { Spinner } from "@vorinthex/shared/ui/spinner";
import { Slider } from "@vorinthex/shared/ui/slider";
import {
  ArchiveIcon,
  BrainIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  DownloadIcon,
  EditIcon,
  FileIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PlusIcon,
  PauseIcon,
  PlayIcon,
  SearchIcon,
  SendIcon,
  CloseIcon,
} from "@vorinthex/shared/ui/icons-mobile";

import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { DocumentScanModal, type DocumentScanPage } from "@/components/capability/DocumentScanModal";
import { MAX_DOCUMENT_SCAN_BYTES, scanSessionSize } from "@/lib/document-scan-session";
import { normalizeCapturedJpeg } from "@/lib/captured-image";
import { normalizeStructurallyCoveredResources } from "@/lib/content-selection-ancestry";
import { ChromeIcon } from "@/components/ChromeIcon";
import { assistantIconSource } from "@/data/capability-icons";
import {
  archiveContentDocument,
  archiveContentSelection,
  askPersonalAssistant,
  createContentDocument,
  createContentFolder,
  createContentMutationKey,
  copyContentSelection,
  downloadContentDocument,
  findContentDocumentVersion,
  generateContentDocumentAudio,
  getContentContext,
  isContentContextConfigured,
  listContentDocumentVersions,
  moveContentSelection,
  renameContentDocument,
  readContentDocumentSources,
  saveContentDocument,
  scanContentDocument,
  searchContent,
  searchContentMatches,
  setContentDocumentFavorite,
  setContentFolderFavorite,
  setContentSelectionFavorite,
  uploadContentDocument,
  updateContentFolder,
  setContentFolderCover,
  type ContentDocument,
  type ContentDocumentPreview,
  type ContentDocumentSourceImage,
  type ContentDocumentVersion,
  type ContentDocumentAudioVersion,
  type ContentFolder,
  type ContentSearchHistoryItem,
  type ContentSearchDocument,
  type ContentSearchMatch,
  type ContentSearchResponse,
  type ContentSelection,
  type PersonalAssistantResponse,
} from "@/lib/content-client";
import {
  addCachedContentDocument,
  addCachedContentFolder,
  contentQueryKeys,
  getContentDocument,
  getContentDocumentPreview,
  getContentDocumentAudioVersions,
  getContentHistory,
  getContentLocation,
  invalidateContentLocations,
  invalidateContentHistories,
  refreshContentDocument,
  refreshContentDocumentAudioVersions,
  refreshContentHistory,
  refreshContentLocation,
  replaceCachedContentDocument,
  replaceCachedContentDocumentDetail,
  replaceCachedContentFolder,
  replaceCachedContentDocuments,
  replaceCachedContentFolders,
  removeCachedContentDocument,
  removeCachedContentDocumentEverywhere,
  removeCachedContentFolder,
  removeCachedContentDocumentsEverywhere,
  removeCachedContentFoldersEverywhere,
  type ContentLocation,
} from "@/lib/content-query-cache";
import { invalidateAssistantChanges } from "@/lib/workspace-query-cache";
import { saveBase64Download, saveTemporaryBase64File, saveTextDownload } from "@/lib/device-download";
import { fetchGalleryUploadStatus, uploadGalleryImages } from "@/lib/gallery-client";
import { BOOK_AUDIO_MODE } from "@/lib/book-audio";
import { audioTimelineDuration, audioTimelinePosition, formatAudioTime, resolveAudioTimelinePosition } from "@/lib/audio-playback-timeline";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";
import { useAuthStore } from "@/state/auth";

type SaveState = "local" | "dirty" | "saving" | "saved" | "error";
type WorkspaceMode = "auto" | "folders" | "folder" | "editor" | "viewer";
type FolderContentTab = "folders" | "documents" | "files";
type ArchiveSheet = "create" | "folder" | "library" | "documents" | "folders" | "enhance" | "historyChooser" | "versions" | "audioVersions" | "documentActions" | "deleteDocument" | "scanSources" | "destination" | "destinationBrowser" | "rename" | "summary" | "folderActions" | "folderDetails" | "bulkActions" | "bulkDelete";
type DestinationAction = "upload" | "move" | "copy";
type UploadBatchItem = { id: string; file: File; name: string; status: "pending" | "uploading" | "success" | "error"; error?: string };
type NarrationChunk = { durationMs: number; url: string };
type PendingCreate = { name: string; content: string; folderKey?: string; mutationKey: string };
type LocalDraft = {
  title?: unknown;
  content?: unknown;
  documentKey?: unknown;
  updatedAt?: unknown;
  savedTitle?: unknown;
  savedContent?: unknown;
  pendingCreate?: unknown;
};

type NotePassage = DocumentPassage & { start?: number; end?: number };

function notePassages(title: string, content: string): NotePassage[] {
  const passages: NotePassage[] = [{ id: "title", text: title }];
  for (const [index, match] of [...content.matchAll(/\S[\s\S]*?(?=\n{2,}|$)/g)].entries()) passages.push({ id: `body.${index}`, text: match[0], start: match.index, end: match.index + match[0].length });
  return passages;
}

function HighlightedText({ onTextLayout, ranges, text, style }: { onTextLayout?: (event: NativeSyntheticEvent<TextLayoutEventData>) => void; ranges?: HighlightRange[]; text: string; style: object }) {
  return <Text onTextLayout={onTextLayout} selectable style={style}>{highlightedSegments(text, ranges ?? []).map((segment) => <Text key={`${segment.start}-${segment.end}`} style={segment.highlighted ? styles.documentSearchHighlight : undefined}>{segment.text}</Text>)}</Text>;
}

const MAX_MOBILE_UPLOAD_BYTES = 8 * 1024 * 1024;
const UPLOAD_MIME_TYPES = ["text/plain", "text/markdown", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const CORE_PROMPTS = [
  "Summarize what I saved about systems",
  "Rewrite this document more clearly",
  "Translate this document to Spanish",
] as const;
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const MAX_SELECTED_CONTENT_RESOURCES = 100;

function draftFileFor(identity: string) {
  const safeIdentity = identity.replace(/[^A-Za-z0-9_-]/g, "-");
  return new File(Paths.document, `knowledge-draft-${safeIdentity}.json`);
}

function pendingCreateFrom(value: unknown): PendingCreate | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<PendingCreate>;
  if (typeof candidate.name !== "string" || typeof candidate.content !== "string" || typeof candidate.mutationKey !== "string") return undefined;
  if (candidate.folderKey !== undefined && typeof candidate.folderKey !== "string") return undefined;
  return { name: candidate.name, content: candidate.content, folderKey: candidate.folderKey, mutationKey: candidate.mutationKey };
}

function ScannedBadge({ document }: { document: ContentDocument }) {
  return document.sourceImageCount ? <Badge accessibilityLabel={`Scanned from ${document.sourceImageCount} ${document.sourceImageCount === 1 ? "image" : "images"}`} style={styles.scannedBadge}><Text style={styles.scannedBadgeText}>Scanned</Text></Badge> : null;
}

export function KnowledgeWorkspace() {
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const archiveCardSize = Math.floor((width - spacing.md * 2 - 20) / 3);
  const destinationCardSize = Math.floor((width - 42 - 20) / 3);
  const userKey = useAuthStore((state) => state.user?.key ?? "");
  const organizationKey = useAuthStore((state) => typeof state.organization?.key === "string" ? state.organization.key : "");
  const scopeKey = useAuthStore((state) => typeof state.scope?.key === "string" ? state.scope.key : "");
  const agentKey = useAuthStore((state) => state.contentExecution?.agentKey ?? "");
  const reconnectContentContext = useAuthStore((state) => state.reconnectContentContext);
  const hasContentContext = isContentContextConfigured({ organizationKey, scopeKey, agentKey });
  const contentContextKey = hasContentContext ? `${organizationKey}:${scopeKey}:${agentKey}` : "";
  const contentContext = { organizationKey, scopeKey, agentKey };
  const narrationPlayer = useAudioPlayer(null, { updateInterval: 500, keepAudioSessionActive: true });
  const narrationAudio = useAudioPlayerStatus(narrationPlayer);
  const draftIdentity = userKey && organizationKey && scopeKey ? `${userKey}:${organizationKey}:${scopeKey}` : "";
  const localDraftFile = draftFileFor(draftIdentity || "unavailable");
  const [activeSheet, setActiveSheet] = useState<ArchiveSheet>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetError, setSheetError] = useState<string>();
  const [editorFocused, setEditorFocused] = useState(false);
  const [editorEditing, setEditorEditing] = useState(false);
  const [editorTitleHeight, setEditorTitleHeight] = useState(36);
  const [editorContentHeight, setEditorContentHeight] = useState(280);
  const [aiInputFocused, setAiInputFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [title, setTitle] = useState("Untitled document");
  const [content, setContent] = useState("");
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiInstructionError, setAiInstructionError] = useState<string>();
  const [aiResponse, setAiResponse] = useState<PersonalAssistantResponse>();
  const [instructing, setInstructing] = useState(false);
  const [coreOpenRequest, setCoreOpenRequest] = useState(0);
  const [uploading, setUploading] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<string>();
  const [scanFolderKey, setScanFolderKey] = useState<string>();
  const [uploadBatch, setUploadBatch] = useState<UploadBatchItem[]>([]);
  const [uploadFolderKey, setUploadFolderKey] = useState<string>();
  const [versions, setVersions] = useState<ContentDocumentVersion[]>([]);
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [versionActionKey, setVersionActionKey] = useState<string>();
  const [audioVersions, setAudioVersions] = useState<ContentDocumentAudioVersion[]>([]);
  const [loadingAudioVersions, setLoadingAudioVersions] = useState(false);
  const [generatingAudioVersion, setGeneratingAudioVersion] = useState(false);
  const [selectedAudioVersionKey, setSelectedAudioVersionKey] = useState<string>();
  const [saveState, setSaveState] = useState<SaveState>(hasContentContext ? "saved" : "local");
  const [folders, setFolders] = useState<ContentFolder[]>([]);
  const [rootFolders, setRootFolders] = useState<ContentFolder[]>([]);
  const [documents, setDocuments] = useState<ContentDocument[]>([]);
  const [rootDocuments, setRootDocuments] = useState<ContentDocument[]>([]);
  const [folderStack, setFolderStack] = useState<ContentFolder[]>([]);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>("folders");
  const [folderContentTab, setFolderContentTab] = useState<FolderContentTab>("folders");
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [locationLoading, setLocationLoading] = useState(true);
  const [openingDocumentKey, setOpeningDocumentKey] = useState<string>();
  const [results, setResults] = useState<ContentSearchResponse>();
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<ContentSearchDocument>();
  const [selectedDocument, setSelectedDocument] = useState<ContentDocument>();
  const [filePreview, setFilePreview] = useState<ContentDocumentPreview>();
  const [filePreviewError, setFilePreviewError] = useState<string>();
  const [filePreviewUri, setFilePreviewUri] = useState<string>();
  const [fileContent, setFileContent] = useState("");
  const [documentSearchQuery, setDocumentSearchQuery] = useState("");
  const [documentSearchRevision, setDocumentSearchRevision] = useState(0);
  const [documentSearchLayoutRevision, setDocumentSearchLayoutRevision] = useState(0);
  const [narrationState, setNarrationState] = useState<"idle" | "playing" | "paused" | "ready" | "error">("idle");
  const [narrationManifest, setNarrationManifest] = useState<NarrationChunk[]>([]);
  const [narrationActiveIndex, setNarrationActiveIndex] = useState(-1);
  const [narrationTitle, setNarrationTitle] = useState("");
  const [narrationScrubValue, setNarrationScrubValue] = useState<number>();
  const [narrationError, setNarrationError] = useState<string>();
  const [selectedFolder, setSelectedFolder] = useState<ContentFolder>();
  const [documentActionLoading, setDocumentActionLoading] = useState<string>();
  const [sourceImages, setSourceImages] = useState<ContentDocumentSourceImage[]>([]);
  const [sourceImagesLoading, setSourceImagesLoading] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [destinationAction, setDestinationAction] = useState<DestinationAction>();
  const [destinationStack, setDestinationStack] = useState<ContentFolder[]>([]);
  const [destinationFolders, setDestinationFolders] = useState<ContentFolder[]>([]);
  const [destinationUsesDirectSelection, setDestinationUsesDirectSelection] = useState(false);
  const [destinationSourceFolderKeys, setDestinationSourceFolderKeys] = useState<(string | null)[]>([]);
  const [destinationBlockedFolderKeys, setDestinationBlockedFolderKeys] = useState<string[]>([]);
  const [destinationLoading, setDestinationLoading] = useState(false);
  const [selectedFolders, setSelectedFolders] = useState<ContentFolder[]>([]);
  const [selectedDocuments, setSelectedDocuments] = useState<ContentDocument[]>([]);
  const [hydratingFolderKeys, setHydratingFolderKeys] = useState<string[]>([]);
  const [hydratingDocumentKeys, setHydratingDocumentKeys] = useState<string[]>([]);
  const [bulkLoading, setBulkLoading] = useState(false);
  const [temporarySingleSelection, setTemporarySingleSelection] = useState(false);
  const [folderDetailsName, setFolderDetailsName] = useState("");
  const [folderDetailsDescription, setFolderDetailsDescription] = useState("");
  const [folderDetailsFavorite, setFolderDetailsFavorite] = useState(false);
  const [folderDetailsCoverAsset, setFolderDetailsCoverAsset] = useState<ImagePicker.ImagePickerAsset | null>();
  const [folderName, setFolderName] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [saveRetry, setSaveRetry] = useState(0);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [rootSearchQuery, setRootSearchQuery] = useState("");
  const [rootSearchResults, setRootSearchResults] = useState<ContentSearchResponse>();
  const [rootSearching, setRootSearching] = useState(false);
  const [folderSearchResults, setFolderSearchResults] = useState<ContentSearchResponse>();
  const [folderSearching, setFolderSearching] = useState(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [error, setError] = useState<string>();
  const editorSession = useRef(0);
  const revision = useRef(0);
  const dirty = useRef(false);
  const titleRef = useRef(title);
  const contentRef = useRef(content);
  const documentKeyRef = useRef<string | undefined>(undefined);
  const updatedAtRef = useRef<string | undefined>(undefined);
  const savedTitleRef = useRef(title);
  const savedContentRef = useRef(content);
  const saveInFlight = useRef<Promise<void> | null>(null);
  const saveImmediately = useRef(false);
  const documentMetadataMutation = useRef<Promise<void> | null>(null);
  const pendingCreate = useRef<PendingCreate | undefined>(undefined);
  const createVersionOnNextSave = useRef(false);
  const navigationGeneration = useRef(0);
  const destinationGeneration = useRef(0);
  const sheetCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const coreOpenTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeSheetRef = useRef<ArchiveSheet | undefined>(undefined);
  const sheetBackStack = useRef<ArchiveSheet[]>([]);
  const currentFolderKeyRef = useRef<string | undefined>(undefined);
  const loadedContentContextKey = useRef<string | undefined>(undefined);
  const selectionContentContextKey = useRef(contentContextKey);
  const instructionRequest = useRef<AbortController | undefined>(undefined);
  const rootSearchRequest = useRef<AbortController | undefined>(undefined);
  const folderSearchRequest = useRef<AbortController | undefined>(undefined);
  const editorDocumentScroll = useRef<ScrollView | null>(null);
  const editorDocumentViewportHeight = useRef(0);
  const documentPassageOffsets = useRef(new Map<string, { y: number; height: number }>());
  const documentHighlightOffsets = useRef(new Map<string, number>());
  const narrationChunks = useRef<NarrationChunk[]>([]);
  const narrationPlaybackGeneration = useRef(0);
  const narrationChunkIndex = useRef(-1);
  const narrationStateRef = useRef(narrationState);
  const lastFinishedNarrationChunk = useRef(-1);
  const narrationTitleRef = useRef("");
  const pendingNarrationSeek = useRef<{ index: number; seconds: number; play: boolean } | undefined>(undefined);
  const summaryRequest = useRef<AbortController | undefined>(undefined);
  const previewFileRef = useRef<File | undefined>(undefined);
  const instructionGeneration = useRef(0);
  const restoreGeneration = useRef(0);
  const uploadGeneration = useRef(0);
  const uploadBatchRef = useRef<UploadBatchItem[]>([]);
  const documentActionGeneration = useRef(0);
  const folderActionGeneration = useRef(0);
  const folderCoverRequests = useRef(new Map<string, number>());
  const longPressedItem = useRef<string | undefined>(undefined);
  const contentContextKeyRef = useRef(contentContextKey);
  const draftIdentityRef = useRef(draftIdentity);
  const folderStackRef = useRef(folderStack);
  const workspaceModeRef = useRef(workspaceMode);
  contentContextKeyRef.current = contentContextKey;
  draftIdentityRef.current = draftIdentity;
  folderStackRef.current = folderStack;
  workspaceModeRef.current = workspaceMode;
  const currentFolder = folderStack.at(-1);
  const destinationFolder = destinationStack.at(-1);
  const contentSelection: ContentSelection = { folderKeys: selectedFolders.map(({ key }) => key), documentKeys: selectedDocuments.map(({ key }) => key) };
  const selectedCount = selectedFolders.length + selectedDocuments.length;
  const selectionActive = selectedCount > 0;
  const singleFolderDelete = activeSheet === "bulkDelete" && temporarySingleSelection && selectedFolders.length === 1 && selectedDocuments.length === 0;
  const allSelectedFavorite = selectionActive && [...selectedFolders, ...selectedDocuments].every((item) => Boolean(item.isFavorite));
  const selectionMetadataLoading = hydratingFolderKeys.length > 0 || hydratingDocumentKeys.length > 0;
  const activeDocument = documentKeyRef.current
    ? [...documents, ...rootDocuments].find((document) => document.key === documentKeyRef.current)
      ?? (selectedDocument?.key === documentKeyRef.current ? selectedDocument : {
        key: documentKeyRef.current,
        name: title,
        isFavorite: false,
        updatedAt: updatedAtRef.current ?? new Date().toISOString(),
      })
    : undefined;
  const archiveLocationLoading = locationLoading;
  const visibleFolders = rootFolders.filter((folder) => {
    const normalized = libraryQuery.trim().toLowerCase();
    return !normalized || folder.name.toLowerCase().includes(normalized) || folder.description?.toLowerCase().includes(normalized);
  });
  const visibleDocuments = rootDocuments.filter((document) => (
    !libraryQuery.trim() || document.name.toLowerCase().includes(libraryQuery.trim().toLowerCase())
  ));
  const rootNotes = rootDocuments.filter((document) => !document.extension);
  const rootFiles = rootDocuments.filter((document) => Boolean(document.extension));
  const folderNotes = documents.filter((document) => !document.extension);
  const folderFiles = documents.filter((document) => Boolean(document.extension));
  const rootTabDocuments = folderContentTab === "files" ? rootFiles : rootNotes;
  const folderTabDocuments = folderContentTab === "files" ? folderFiles : folderNotes;
  const folderSearchFolders = folderSearchResults?.folders ?? [];
  const folderSearchDocuments = (folderSearchResults?.documents ?? []).filter((document) => folderContentTab === "files" ? Boolean(document.extension) : !document.extension);
  const rootSearchFolders = rootSearchResults?.folders ?? [];
  const rootSearchDocuments = (rootSearchResults?.documents ?? []).filter((document) => folderContentTab === "files" ? Boolean(document.extension) : !document.extension);
  const currentNotePassages = useMemo(() => notePassages(title, content), [content, title]);
  const documentSearchMatches = useMemo(() => editorEditing ? [] : searchDocumentPassagesLiteral(currentNotePassages, documentSearchQuery), [currentNotePassages, documentSearchQuery, editorEditing]);
  const documentSearchMatchesById = useMemo(() => new Map(documentSearchMatches.map((match) => [match.id, match])), [documentSearchMatches]);
  const documentSearchTargetId = documentSearchMatches[0]?.id;
  const visibleUploadBatch = uploadFolderKey === currentFolder?.key
    ? uploadBatch.filter(({ status }) => status === "pending" || status === "uploading")
    : [];
  const destinationTargetKey = destinationFolder?.key ?? null;
  const destinationAtSource = destinationAction !== "upload" && destinationSourceFolderKeys.includes(destinationTargetKey);
  const destinationIsSelectedFolder = destinationStack.some(({ key }) => destinationBlockedFolderKeys.includes(key));
  const destinationTransferDisabled = destinationAction !== "upload" && (destinationLoading || destinationAtSource || destinationIsSelectedFolder) || bulkLoading;
  const showArchiveRoot = !libraryQuery.trim() || "archive".includes(libraryQuery.trim().toLowerCase());
  const narrationDuration = audioTimelineDuration(narrationManifest);
  const narrationElapsed = narrationScrubValue ?? audioTimelinePosition(narrationManifest, narrationActiveIndex, narrationAudio.currentTime);

  const updateNarrationState = (state: typeof narrationState) => {
    narrationStateRef.current = state;
    setNarrationState(state);
  };

  const playNarrationChunk = (index: number) => {
    const chunk = narrationChunks.current[index];
    if (!chunk) return false;
    narrationChunkIndex.current = index;
    setNarrationActiveIndex(index);
    narrationPlayer.replace(chunk.url);
    narrationPlayer.setActiveForLockScreen(true, { title: narrationTitleRef.current, artist: "Vorinthex Archive" }, { showSeekBackward: false, showSeekForward: false });
    narrationPlayer.play();
    updateNarrationState("playing");
    return true;
  };

  const stopNarration = useCallback(() => {
    narrationPlaybackGeneration.current += 1;
    narrationChunks.current = [];
    narrationChunkIndex.current = -1;
    narrationTitleRef.current = "";
    pendingNarrationSeek.current = undefined;
    lastFinishedNarrationChunk.current = -1;
    narrationPlayer.pause();
    narrationPlayer.clearLockScreenControls();
    narrationStateRef.current = "idle";
    setNarrationState("idle");
    setNarrationManifest([]);
    setNarrationActiveIndex(-1);
    setNarrationTitle("");
    setSelectedAudioVersionKey(undefined);
    setNarrationScrubValue(undefined);
    setNarrationError(undefined);
  }, [narrationPlayer]);

  const toggleNarration = () => {
    if (narrationStateRef.current === "playing") {
      narrationPlayer.pause();
      updateNarrationState("paused");
    } else if (narrationStateRef.current === "paused") {
      narrationPlayer.play();
      updateNarrationState("playing");
    } else if (narrationStateRef.current === "ready") {
      const target = resolveAudioTimelinePosition(narrationChunks.current, 0);
      pendingNarrationSeek.current = { ...target, play: true };
      narrationChunkIndex.current = target.index;
      setNarrationActiveIndex(target.index);
      const chunk = narrationChunks.current[target.index]!;
      narrationPlayer.replace(chunk.url);
      updateNarrationState("playing");
    }
  };

  const seekNarration = (seconds: number) => {
    if (narrationChunks.current.length === 0) return;
    const target = resolveAudioTimelinePosition(narrationChunks.current, seconds);
    const shouldPlay = narrationStateRef.current === "playing";
    if (target.index === narrationChunkIndex.current) {
      void narrationPlayer.seekTo(target.seconds);
      if (!shouldPlay) updateNarrationState("paused");
      return;
    }
    pendingNarrationSeek.current = { ...target, play: shouldPlay };
    narrationChunkIndex.current = target.index;
    setNarrationActiveIndex(target.index);
    const chunk = narrationChunks.current[target.index]!;
    narrationPlayer.replace(chunk.url);
    if (!shouldPlay) updateNarrationState("paused");
  };

  useEffect(() => {
    const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
    const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";
    const showSubscription = Keyboard.addListener(showEvent, () => setKeyboardVisible(true));
    const hideSubscription = Keyboard.addListener(hideEvent, () => setKeyboardVisible(false));
    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  useEffect(() => {
    if (!documentSearchTargetId) return;
    const target = documentPassageOffsets.current.get(documentSearchTargetId);
    if (!target) return;
    const passage = currentNotePassages.find(({ id }) => id === documentSearchTargetId);
    const range = documentSearchMatchesById.get(documentSearchTargetId)?.ranges[0];
    const rangeCenter = passage && range ? (range.start + range.end) / 2 / Math.max(1, passage.text.length) : 0.5;
    const highlightOffset = documentHighlightOffsets.current.get(documentSearchTargetId) ?? target.height * rangeCenter;
    const centeredY = target.y + highlightOffset - editorDocumentViewportHeight.current * 0.2;
    const frame = requestAnimationFrame(() => editorDocumentScroll.current?.scrollTo({ animated: true, y: Math.max(0, centeredY) }));
    return () => cancelAnimationFrame(frame);
  }, [currentNotePassages, documentSearchLayoutRevision, documentSearchMatchesById, documentSearchRevision, documentSearchTargetId]);

  useEffect(() => {
    documentHighlightOffsets.current.clear();
  }, [documentSearchQuery]);

  useEffect(() => {
    if (!narrationAudio.isLoaded || !pendingNarrationSeek.current) return;
    const pending = pendingNarrationSeek.current;
    if (pending.index !== narrationChunkIndex.current) return;
    pendingNarrationSeek.current = undefined;
    lastFinishedNarrationChunk.current = -1;
    void narrationPlayer.seekTo(pending.seconds).then(() => {
      if (pending.play) narrationPlayer.play();
    });
  }, [narrationAudio.isLoaded, narrationPlayer]);

  useEffect(() => {
    if (!narrationAudio.didJustFinish) return;
    const current = narrationChunkIndex.current;
    if (current < 0 || lastFinishedNarrationChunk.current === current) return;
    lastFinishedNarrationChunk.current = current;
    if (playNarrationChunk(current + 1)) return;
    narrationPlayer.clearLockScreenControls();
    updateNarrationState("ready");
    // Completion is edge-triggered; queue and generation state live in refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [narrationAudio.didJustFinish]);

  useEffect(() => {
    if (hasContentContext) return;
    void reconnectContentContext().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Archive AI could not connect.");
      setLocationLoading(false);
    });
  }, [hasContentContext, reconnectContentContext]);

  useEffect(() => {
    activeSheetRef.current = activeSheet;
  }, [activeSheet]);

  useEffect(() => {
    currentFolderKeyRef.current = currentFolder?.key;
  }, [currentFolder?.key]);

  const openSheet = (sheet: ArchiveSheet) => {
    if (sheetCloseTimer.current) clearTimeout(sheetCloseTimer.current);
    setSheetError(undefined);
    sheetBackStack.current = [];
    setActiveSheet(sheet);
    setSheetOpen(true);
  };

  const pushSheet = (sheet: ArchiveSheet) => {
    const current = activeSheetRef.current;
    if (current) sheetBackStack.current.push(current);
    setSheetError(undefined);
    setActiveSheet(sheet);
  };

  const goBackSheet = () => {
    const previous = sheetBackStack.current.pop();
    if (!previous) return;
    if (temporarySingleSelection && (activeSheetRef.current === "destinationBrowser" || activeSheetRef.current === "bulkDelete")) {
      clearSelection();
      setTemporarySingleSelection(false);
      setDestinationUsesDirectSelection(false);
    }
    setSheetError(undefined);
    setActiveSheet(previous);
  };

  const closeSheet = (preserveSelection = false) => {
    if (activeSheetRef.current === "destination" || activeSheetRef.current === "destinationBrowser") {
      destinationGeneration.current += 1;
      if (!preserveSelection && destinationUsesDirectSelection) clearSelection();
      setDestinationUsesDirectSelection(false);
      setDestinationStack([]);
      setDestinationFolders([]);
      setDestinationSourceFolderKeys([]);
      setDestinationBlockedFolderKeys([]);
      setDestinationLoading(false);
      setDestinationAction(undefined);
    }
    if (!preserveSelection && temporarySingleSelection) clearSelection();
    setTemporarySingleSelection(false);
    if (activeSheetRef.current === "documentActions" || activeSheetRef.current === "rename") documentActionGeneration.current += 1;
    if (activeSheetRef.current === "folderActions" || activeSheetRef.current === "folderDetails") folderActionGeneration.current += 1;
    if (activeSheetRef.current === "summary") {
      summaryRequest.current?.abort();
      summaryRequest.current = undefined;
      setSummaryLoading(false);
    }
    setSheetOpen(false);
    sheetBackStack.current = [];
    if (sheetCloseTimer.current) clearTimeout(sheetCloseTimer.current);
    sheetCloseTimer.current = setTimeout(() => setActiveSheet(undefined), 240);
  };

  useEffect(() => () => {
    if (sheetCloseTimer.current) clearTimeout(sheetCloseTimer.current);
    if (coreOpenTimer.current) clearTimeout(coreOpenTimer.current);
    instructionRequest.current?.abort();
    previewFileRef.current?.delete();
  }, []);

  useEffect(() => navigation.addListener("beforeRemove", (event) => {
    if (!hasContentContext || (saveState !== "dirty" && saveState !== "saving")) return;
    event.preventDefault();
    setError("Wait for the current document to save before leaving.");
  }), [hasContentContext, navigation, saveState]);

  const loadLocation = async (folderKey?: string, refresh = false) => {
    const location = await (refresh
      ? refreshContentLocation(queryClient, contentContext, folderKey)
      : getContentLocation(queryClient, contentContext, folderKey));
    setFolders(location.folders);
    if (!folderKey) {
      setRootFolders(location.folders);
      setRootDocuments(location.documents);
    }
    setDocuments(location.documents);
  };

  useEffect(() => {
    if (!draftIdentity || !localDraftFile.exists) return;
    const initialRevision = revision.current;
    const expectedDraftIdentity = draftIdentity;
    void (async () => {
      const value = await localDraftFile.text();
      if (revision.current !== initialRevision || draftIdentityRef.current !== expectedDraftIdentity) return;
      const draft = JSON.parse(value) as LocalDraft;
      const draftDocumentKey = typeof draft.documentKey === "string" ? draft.documentKey : undefined;
      if (hasContentContext && draftDocumentKey && !pendingCreateFrom(draft.pendingCreate)) {
        const remote = await getContentDocument(queryClient, contentContext, draftDocumentKey);
        if (revision.current !== initialRevision || draftIdentityRef.current !== expectedDraftIdentity) return;
        if (remote.extension) {
          localDraftFile.delete();
          return;
        }
      }
      if (typeof draft.title === "string") {
        titleRef.current = draft.title;
        setTitle(draft.title);
      }
      if (typeof draft.content === "string") {
        contentRef.current = draft.content;
        setContent(draft.content);
      }
      if (draftDocumentKey || (typeof draft.content === "string" && draft.content.trim()) || (typeof draft.title === "string" && draft.title !== "Untitled document")) {
        workspaceModeRef.current = "editor";
        setWorkspaceMode("editor");
      }
      documentKeyRef.current = draftDocumentKey;
      updatedAtRef.current = typeof draft.updatedAt === "string" ? draft.updatedAt : undefined;
      savedTitleRef.current = typeof draft.savedTitle === "string" ? draft.savedTitle : "Untitled document";
      savedContentRef.current = typeof draft.savedContent === "string" ? draft.savedContent : "";
      pendingCreate.current = pendingCreateFrom(draft.pendingCreate);
      if (typeof draft.content === "string" && draft.content.trim() && (
        pendingCreate.current ||
        !documentKeyRef.current ||
        draft.content !== savedContentRef.current ||
        draft.title !== savedTitleRef.current
      )) {
        dirty.current = true;
        setSaveState("dirty");
      } else if (!draftDocumentKey && typeof draft.title === "string" && draft.title !== savedTitleRef.current) {
        setSaveState("local");
      }
    })().catch(() => {
      if (draftIdentityRef.current === expectedDraftIdentity) setError("The local draft could not be restored.");
    });
  }, [draftIdentity, hasContentContext]);

  useEffect(() => {
    if (selectionContentContextKey.current === contentContextKey) return;
    selectionContentContextKey.current = contentContextKey;
    destinationGeneration.current += 1;
    setSelectedFolders([]);
    setSelectedDocuments([]);
    setHydratingFolderKeys([]);
    setHydratingDocumentKeys([]);
    setDestinationStack([]);
    setDestinationFolders([]);
    setDestinationSourceFolderKeys([]);
    setDestinationAction(undefined);
    setDestinationLoading(false);
    setDestinationUsesDirectSelection(false);
    setTemporarySingleSelection(false);
    setBulkLoading(false);
    longPressedItem.current = undefined;
  }, [contentContextKey]);

  useEffect(() => {
    if (!hasContentContext) {
      if (loadedContentContextKey.current) {
        destinationGeneration.current += 1;
        stopNarration();
        previewFileRef.current?.delete();
        previewFileRef.current = undefined;
        setFileContent("");
        setFilePreview(undefined);
        setFilePreviewUri(undefined);
        setDocumentSearchQuery("");
        setSelectedFolders([]);
        setSelectedDocuments([]);
        setHydratingFolderKeys([]);
        setHydratingDocumentKeys([]);
        setDestinationStack([]);
        setDestinationFolders([]);
        setDestinationSourceFolderKeys([]);
        setDestinationAction(undefined);
        setDestinationLoading(false);
        setDestinationUsesDirectSelection(false);
        setTemporarySingleSelection(false);
        setBulkLoading(false);
        longPressedItem.current = undefined;
        loadedContentContextKey.current = undefined;
      }
      return;
    }
    const requestContextKey = contentContextKey;
    const changedAccount = Boolean(loadedContentContextKey.current && loadedContentContextKey.current !== contentContextKey);
    loadedContentContextKey.current = contentContextKey;
    if (changedAccount) {
      stopNarration();
      previewFileRef.current?.delete();
      previewFileRef.current = undefined;
      navigationGeneration.current += 1;
      destinationGeneration.current += 1;
      documentActionGeneration.current += 1;
      folderActionGeneration.current += 1;
      restoreGeneration.current += 1;
      uploadGeneration.current += 1;
      documentMetadataMutation.current = null;
      instructionGeneration.current += 1;
      instructionRequest.current?.abort();
      instructionRequest.current = undefined;
      setInstructing(false);
      setAiInstruction("");
      setAiInstructionError(undefined);
      setAiResponse(undefined);
      setVersions([]);
      setLoadingVersions(false);
      setVersionActionKey(undefined);
      setUploading(false);
      uploadBatchRef.current = [];
      setUploadBatch([]);
      setUploadFolderKey(undefined);
      editorSession.current += 1;
      revision.current = 0;
      dirty.current = false;
      documentKeyRef.current = undefined;
      updatedAtRef.current = undefined;
      pendingCreate.current = undefined;
      createVersionOnNextSave.current = false;
      titleRef.current = "Untitled document";
      contentRef.current = "";
      savedTitleRef.current = "Untitled document";
      savedContentRef.current = "";
      setTitle("Untitled document");
      setContent("");
      setFolders([]);
      setRootFolders([]);
      setDocuments([]);
      setRootDocuments([]);
      setFolderStack([]);
      workspaceModeRef.current = "folders";
      setWorkspaceMode("folders");
      setHistory([]);
      setQuery("");
      setResults(undefined);
      setSelectedSummary(undefined);
      setSelectedDocument(undefined);
      setFileContent("");
      setFilePreview(undefined);
      setFilePreviewError(undefined);
      setFilePreviewUri(undefined);
      setDocumentSearchQuery("");
      setSelectedFolder(undefined);
      setSelectedFolders([]);
      setSelectedDocuments([]);
      setHydratingFolderKeys([]);
      setHydratingDocumentKeys([]);
      setDestinationStack([]);
      setDestinationFolders([]);
      setDestinationSourceFolderKeys([]);
      setDestinationAction(undefined);
      setDestinationLoading(false);
      setDestinationUsesDirectSelection(false);
      setTemporarySingleSelection(false);
      setBulkLoading(false);
      longPressedItem.current = undefined;
      setSheetOpen(false);
      sheetBackStack.current = [];
      setActiveSheet(undefined);
      setError(undefined);
      setSaveState("saved");
      setLocationLoading(true);
    }
    void (async () => {
      const root = await getContentLocation(queryClient, contentContext);
      const initialFolder = root.folders.find((folder) => folder.name === "My Documents");
      const initial = { root, location: initialFolder ? await getContentLocation(queryClient, contentContext, initialFolder.key) : root, initialFolder };
      const useInitialFolder = workspaceModeRef.current !== "folders" && Boolean(initial.initialFolder);
      const recent = await getContentHistory(queryClient, contentContext, useInitialFolder ? initial.initialFolder?.key : undefined);
      return { initial, recent, useInitialFolder };
    })()
      .then(({ initial, recent, useInitialFolder }) => {
        if (contentContextKeyRef.current !== requestContextKey) return;
        const location = useInitialFolder ? initial.location : initial.root;
        setFolders(location.folders);
        setRootFolders(initial.root.folders);
        setDocuments(location.documents);
        setRootDocuments(initial.root.documents);
        setFolderStack(useInitialFolder && initial.initialFolder ? [initial.initialFolder] : []);
        if (workspaceModeRef.current === "auto") {
          const nextMode = initial.initialFolder ? "folder" : "folders";
          workspaceModeRef.current = nextMode;
          setWorkspaceMode(nextMode);
        }
        setHistory(recent);
        setLocationLoading(false);
      })
      .catch((cause: unknown) => {
        if (contentContextKeyRef.current === requestContextKey) {
          setError(cause instanceof Error ? cause.message : "Knowledge could not connect.");
          setLocationLoading(false);
        }
      });
  }, [contentContextKey, hasContentContext, stopNarration]);

  useEffect(() => {
    if (!hasContentContext || !dirty.current) return;
    const session = editorSession.current;
    const delay = saveImmediately.current ? 0 : 500;
    saveImmediately.current = false;
    const timeout = setTimeout(() => {
      const previous = saveInFlight.current;
      const save = (async () => {
        await previous;
        await documentMetadataMutation.current;
        if (session !== editorSession.current || !dirty.current) return;
        const savingRevision = revision.current;
        const nextTitle = titleRef.current.trim() || "Untitled document";
        const nextContent = contentRef.current;
        setSaveState("saving");
        let activeKey = documentKeyRef.current;
        let activeUpdatedAt = updatedAtRef.current;
        if (!activeKey) {
          if (!nextContent.trim()) {
            dirty.current = false;
            if (nextTitle === savedTitleRef.current) {
              setSaveState("saved");
              if (localDraftFile.exists) localDraftFile.delete();
            } else {
              setSaveState("local");
              persistLocalDraft(titleRef.current, contentRef.current);
            }
            return;
          }
          pendingCreate.current ??= { name: nextTitle, content: nextContent, folderKey: currentFolder?.key, mutationKey: createContentMutationKey() };
          persistLocalDraft(titleRef.current, contentRef.current);
          const pending = pendingCreate.current;
          const created = await createContentDocument(pending.name, pending.content, pending.folderKey, pending.mutationKey);
          if (session !== editorSession.current) return;
          pendingCreate.current = undefined;
          activeKey = created.key;
          activeUpdatedAt = created.updatedAt;
          documentKeyRef.current = created.key;
          updatedAtRef.current = created.updatedAt;
          savedTitleRef.current = pending.name;
          savedContentRef.current = pending.content;
          persistLocalDraft(titleRef.current, contentRef.current);
        }
        if (activeKey && nextContent !== savedContentRef.current) {
          const shouldCreateVersion = createVersionOnNextSave.current;
          const saved = await saveContentDocument(activeKey, nextContent, activeUpdatedAt!, shouldCreateVersion);
          if (session !== editorSession.current) return;
          if (shouldCreateVersion) createVersionOnNextSave.current = false;
          activeUpdatedAt = saved.updatedAt;
          updatedAtRef.current = saved.updatedAt;
          savedContentRef.current = nextContent;
        }
        if (activeKey && nextTitle !== savedTitleRef.current) {
          const renamed = await renameContentDocument(activeKey, nextTitle);
          if (session !== editorSession.current) return;
          activeUpdatedAt = renamed.updatedAt;
          updatedAtRef.current = renamed.updatedAt;
          savedTitleRef.current = nextTitle;
        }
        updatedAtRef.current = activeUpdatedAt;
        savedTitleRef.current = nextTitle;
        savedContentRef.current = nextContent;
        if (titleRef.current.trim().length === 0) {
          titleRef.current = nextTitle;
          setTitle(nextTitle);
        }
        if (savingRevision === revision.current) {
          dirty.current = false;
          setSaveState("saved");
          if (localDraftFile.exists) localDraftFile.delete();
        } else {
          setSaveState("dirty");
        }
        if (activeKey) queryClient.setQueryData(contentQueryKeys.document(contentContext, activeKey), (cached: (ContentDocument & { content: string }) | undefined) => ({
          ...cached,
          key: activeKey,
          name: nextTitle,
          folderKey: currentFolder?.key,
          isFavorite: cached?.isFavorite ?? activeDocument?.isFavorite ?? false,
          updatedAt: activeUpdatedAt!,
          content: nextContent,
        }));
        await loadLocation(currentFolder?.key, true);
      })().catch((cause: unknown) => {
        if (session !== editorSession.current) return;
        setSaveState("error");
        setError(cause instanceof Error ? cause.message : "The document could not be saved.");
      });
      saveInFlight.current = save;
      void save.finally(() => {
        if (saveInFlight.current === save) saveInFlight.current = null;
      });
    }, delay);
    return () => clearTimeout(timeout);
  }, [content, contentContextKey, currentFolder?.key, hasContentContext, saveRetry, title]);

  const markDirty = () => {
    revision.current += 1;
    dirty.current = true;
    setSaveState(hasContentContext ? "dirty" : "local");
    if (saveState === "error") setError(undefined);
  };

  const openEnhanceSheet = () => {
    openSheet("enhance");
  };

  const openCoreConfirmation = (prompt: string) => {
    setAiInstruction(prompt);
    setAiInstructionError(undefined);
    setAiResponse(undefined);
    closeSheet();
    if (coreOpenTimer.current) clearTimeout(coreOpenTimer.current);
    coreOpenTimer.current = setTimeout(() => setCoreOpenRequest((current) => current + 1), 240);
  };

  const confirmEnhancementWithCore = () => {
    openCoreConfirmation("Enhance this document. Correct wording, grammar, punctuation, and spelling mistakes while preserving its meaning, facts, tone, and structure.");
  };

  const confirmTranslationWithCore = () => {
    openCoreConfirmation("Translate this document to English while preserving its meaning and structure.");
  };

  const runNoteInstruction = async () => {
    const instruction = aiInstruction.trim();
    if (!hasContentContext || !instruction || instructing || saveState === "saving") return;
    const original = contentRef.current;
    if (original.length > 15_000) {
      setAiInstructionError("AI changes currently support documents up to 15,000 characters.");
      return;
    }
    const documentKey = documentKeyRef.current;
    const session = editorSession.current;
    const generation = ++instructionGeneration.current;
    const controller = new AbortController();
    instructionRequest.current?.abort();
    instructionRequest.current = controller;
    setInstructing(true);
    setAiInstructionError(undefined);
    setAiResponse(undefined);
    try {
      const result = await askPersonalAssistant(instruction, { documentKey, title: titleRef.current, content: original }, currentFolderKeyRef.current, controller.signal);
      if (controller.signal.aborted || generation !== instructionGeneration.current) return;
      if (session !== editorSession.current || documentKeyRef.current !== documentKey || contentRef.current !== original) {
        setAiInstructionError("The document changed while Core was responding. Try again.");
        return;
      }
      setAiResponse(result);
      await invalidateAssistantChanges(queryClient, contentContext, result.changes);
      setAiInstruction("");
      if (result.type === "note") {
        contentRef.current = result.content;
        if (documentKey) createVersionOnNextSave.current = true;
        setContent(result.content);
        markDirty();
        persistLocalDraft(titleRef.current, result.content);
      } else if (documentKey && result.changes?.some(({ workspace }) => workspace === "archive")) {
        const document = await refreshContentDocument(queryClient, contentContext, documentKey);
        if (controller.signal.aborted || generation !== instructionGeneration.current || session !== editorSession.current || documentKeyRef.current !== documentKey) return;
        applyRemoteDocument(document);
      }
    } catch (cause) {
      if (!controller.signal.aborted) setAiInstructionError(cause instanceof Error ? cause.message : "Core could not respond.");
    } finally {
      if (instructionRequest.current === controller) instructionRequest.current = undefined;
      if (generation === instructionGeneration.current) setInstructing(false);
    }
  };

  const runFileInstruction = async () => {
    const instruction = aiInstruction.trim();
    const document = filePreview ?? selectedDocument;
    if (!hasContentContext || !instruction || instructing || !document?.extension) return;
    const generation = ++instructionGeneration.current;
    const controller = new AbortController();
    instructionRequest.current?.abort();
    instructionRequest.current = controller;
    setInstructing(true);
    setAiInstructionError(undefined);
    setAiResponse(undefined);
    try {
      const result = await askPersonalAssistant(instruction, { documentKey: document.key, title: document.name, content: "" }, document.folderKey, controller.signal);
      if (controller.signal.aborted || generation !== instructionGeneration.current || workspaceModeRef.current !== "viewer") return;
      setAiResponse(result);
      await invalidateAssistantChanges(queryClient, contentContext, result.changes);
      setAiInstruction("");
    } catch (cause) {
      if (!controller.signal.aborted) setAiInstructionError(cause instanceof Error ? cause.message : "Core could not respond.");
    } finally {
      if (instructionRequest.current === controller) instructionRequest.current = undefined;
      if (generation === instructionGeneration.current) setInstructing(false);
    }
  };

  function applyRemoteDocument(document: ContentDocument & { content: string }) {
    revision.current += 1;
    dirty.current = false;
    pendingCreate.current = undefined;
    createVersionOnNextSave.current = false;
    documentKeyRef.current = document.key;
    updatedAtRef.current = document.updatedAt;
    titleRef.current = document.name;
    contentRef.current = document.content;
    savedTitleRef.current = document.name;
    savedContentRef.current = document.content;
    setTitle(document.name);
    setContent(document.content);
    setSaveState("saved");
    setError(undefined);
    if (localDraftFile.exists) localDraftFile.delete();
  }

  const openHistoryChooser = (document: ContentDocument) => {
    setSelectedDocument(document);
    openSheet("historyChooser");
  };

  const openVersionHistory = async () => {
    const documentKey = selectedDocument?.key ?? documentKeyRef.current;
    if (!documentKey) {
      setSheetError("Save the document before opening version history.");
      return;
    }
    if (documentKey === documentKeyRef.current && (dirty.current || saveInFlight.current || saveState !== "saved")) {
      setSheetError("Wait for the document to finish saving before opening version history.");
      return;
    }
    const generation = ++restoreGeneration.current;
    if (sheetOpen) pushSheet("versions");
    else openSheet("versions");
    setVersions([]);
    setLoadingVersions(true);
    try {
      const history = await listContentDocumentVersions(documentKey);
      if (generation === restoreGeneration.current) setVersions(history);
    } catch (cause) {
      if (generation === restoreGeneration.current && activeSheetRef.current === "versions") setSheetError(cause instanceof Error ? cause.message : "Version history could not be loaded.");
    } finally {
      if (generation === restoreGeneration.current) setLoadingVersions(false);
    }
  };

  const playAudioVersion = async (version: ContentDocumentAudioVersion, startSeconds = 0, autoPlay = true, refreshUrl = true) => {
    const document = selectedDocument;
    if (!document) return;
    const generation = ++narrationPlaybackGeneration.current;
    try {
      const history = refreshUrl ? await refreshContentDocumentAudioVersions(queryClient, contentContext, document.key) : audioVersions;
      if (generation !== narrationPlaybackGeneration.current) return;
      if (refreshUrl) setAudioVersions(history);
      const playable = history.find((item) => item.key === version.key) ?? version;
      await setAudioModeAsync(BOOK_AUDIO_MODE);
      if (generation !== narrationPlaybackGeneration.current) return;
      stopNarration();
      narrationTitleRef.current = document.name;
      setNarrationTitle(`${document.name} · Audio ${playable.version}`);
      setSelectedAudioVersionKey(playable.key);
      const chunk: NarrationChunk = { durationMs: playable.durationMs, url: playable.url };
      narrationChunks.current = [chunk];
      narrationChunkIndex.current = 0;
      setNarrationManifest([chunk]);
      setNarrationActiveIndex(0);
      pendingNarrationSeek.current = { index: 0, seconds: Math.min(startSeconds, playable.durationMs / 1_000), play: autoPlay };
      narrationPlayer.replace(playable.url);
      narrationPlayer.setActiveForLockScreen(true, { title: document.name, artist: "Vorinthex Archive" }, { showSeekBackward: false, showSeekForward: false });
      if (autoPlay) narrationPlayer.play();
      updateNarrationState(autoPlay ? "playing" : "paused");
    } catch (cause) {
      if (generation !== narrationPlaybackGeneration.current) return;
      const message = cause instanceof Error ? cause.message : "This audio version could not be played.";
      setNarrationError(message);
      updateNarrationState("error");
    }
  };

  const openAudioVersionHistory = async (targetDocument?: ContentDocument) => {
    const documentKey = targetDocument?.key ?? selectedDocument?.key ?? documentKeyRef.current;
    if (!documentKey) {
      setSheetError("Save the document before opening audio versions.");
      return;
    }
    if (targetDocument) setSelectedDocument(targetDocument);
    const generation = ++restoreGeneration.current;
    if (targetDocument) openSheet("audioVersions");
    else if (sheetOpen) pushSheet("audioVersions");
    else openSheet("audioVersions");
    setAudioVersions([]);
    setLoadingAudioVersions(true);
    try {
      const history = await getContentDocumentAudioVersions(queryClient, contentContext, documentKey);
      if (generation === restoreGeneration.current) setAudioVersions(history);
    } catch (cause) {
      if (generation === restoreGeneration.current && activeSheetRef.current === "audioVersions") setSheetError(cause instanceof Error ? cause.message : "Audio versions could not be loaded.");
    } finally {
      if (generation === restoreGeneration.current) setLoadingAudioVersions(false);
    }
  };

  const generateAudioVersion = async () => {
    const document = selectedDocument;
    if (!document || generatingAudioVersion) return;
    setGeneratingAudioVersion(true);
    setSheetError(undefined);
    try {
      const generated = await generateContentDocumentAudio(document.key);
      const history = await refreshContentDocumentAudioVersions(queryClient, contentContext, document.key);
      setAudioVersions(history);
      const playable = history.find((version) => version.key === generated.key);
      if (playable) await playAudioVersion(playable, 0, true, false);
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "Document audio could not be generated.");
    } finally {
      setGeneratingAudioVersion(false);
    }
  };

  const loadVersionIntoEditor = async (version: ContentDocumentVersion) => {
    if (dirty.current || saveInFlight.current || saveState !== "saved") return;
    const generation = ++restoreGeneration.current;
    setVersionActionKey(version.key);
    setSheetError(undefined);
    try {
      const snapshot = await findContentDocumentVersion(version.key);
      if (generation !== restoreGeneration.current || !snapshot.content) return;
      createVersionOnNextSave.current = true;
      contentRef.current = snapshot.content;
      setContent(snapshot.content);
      markDirty();
      persistLocalDraft(titleRef.current, snapshot.content);
      closeSheet();
    } catch (cause) {
      if (generation === restoreGeneration.current) setSheetError(cause instanceof Error ? cause.message : "The version could not be loaded.");
    } finally {
      if (generation === restoreGeneration.current) setVersionActionKey(undefined);
    }
  };

  const downloadVersion = async (version: ContentDocumentVersion) => {
    const generation = ++restoreGeneration.current;
    setVersionActionKey(version.key);
    setSheetError(undefined);
    try {
      const snapshot = await findContentDocumentVersion(version.key);
      if (generation !== restoreGeneration.current || !snapshot.content) return;
      const baseName = (titleRef.current.trim() || "document").replace(/\.txt$/i, "");
      const location = await saveTextDownload(`${baseName}-version-${version.version}.txt`, snapshot.content);
      if (generation === restoreGeneration.current) {
        closeSheet();
        showToast({ title: "Document downloaded", description: `Saved to ${location}` });
      }
    } catch (cause) {
      if (generation === restoreGeneration.current) setSheetError(cause instanceof Error ? cause.message : "The version could not be downloaded.");
    } finally {
      if (generation === restoreGeneration.current) setVersionActionKey(undefined);
    }
  };

  const persistLocalDraft = (nextTitle: string, nextContent: string) => {
    if (!draftIdentity) return;
    try {
      localDraftFile.write(JSON.stringify({
        title: nextTitle,
        content: nextContent,
        documentKey: documentKeyRef.current,
        updatedAt: updatedAtRef.current,
        savedTitle: savedTitleRef.current,
        savedContent: savedContentRef.current,
        pendingCreate: pendingCreate.current,
      }));
    } catch {
      setError("The local draft could not be saved.");
    }
  };

  const resetEditor = (nextTitle = "Untitled document") => {
    instructionGeneration.current += 1;
    instructionRequest.current?.abort();
    instructionRequest.current = undefined;
    restoreGeneration.current += 1;
    setInstructing(false);
    setAiInstruction("");
    setAiResponse(undefined);
    setAiInstructionError(undefined);
    setVersionActionKey(undefined);
    setVersions([]);
    editorSession.current += 1;
    revision.current = 0;
    dirty.current = false;
    documentKeyRef.current = undefined;
    updatedAtRef.current = undefined;
    pendingCreate.current = undefined;
    createVersionOnNextSave.current = false;
    titleRef.current = nextTitle;
    contentRef.current = "";
    savedTitleRef.current = nextTitle;
    savedContentRef.current = "";
    setEditorTitleHeight(58);
    setEditorContentHeight(280);
    setTitle(nextTitle);
    setContent("");
    setSelectedSummary(undefined);
    setQuery("");
    setResults(undefined);
    setSaveState(hasContentContext ? "saved" : "local");
    persistLocalDraft(nextTitle, "");
  };

  const startNewNote = (nextTitle = "Untitled document") => {
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      const message = "Wait for the current document to save before creating another.";
      if (sheetOpen) setSheetError(message);
      else setError(message);
      return false;
    }
    setError(undefined);
    resetEditor(nextTitle);
    setDocumentSearchQuery("");
    setEditorEditing(true);
    workspaceModeRef.current = "editor";
    setWorkspaceMode("editor");
    if (sheetOpen) closeSheet();
    return true;
  };

  const showDocumentActions = (document: ContentDocument) => {
    if (document.key === documentKeyRef.current && (dirty.current || saveInFlight.current || documentMetadataMutation.current)) {
      setError("Wait for the current document to save before managing it.");
      return;
    }
    documentActionGeneration.current += 1;
    setDocumentActionLoading(undefined);
    setSelectedDocument(document);
    if (sheetOpen) pushSheet("documentActions");
    else openSheet("documentActions");
  };

  const openNote = async (document: ContentDocument, reportError = setError, preserveSearch = false) => {
    if (!hasContentContext) return false;
    if (document.extension) {
      reportError("Files open in the file viewer, not the notes editor.");
      return false;
    }
    if (dirty.current || saveInFlight.current) {
      reportError("Wait for the current document to save before opening another.");
      return false;
    }
    const generation = ++navigationGeneration.current;
    stopNarration();
    setDocumentSearchQuery("");
    instructionGeneration.current += 1;
    instructionRequest.current?.abort();
    instructionRequest.current = undefined;
    restoreGeneration.current += 1;
    setInstructing(false);
    setAiInstructionError(undefined);
    setAiResponse(undefined);
    setVersionActionKey(undefined);
    setOpeningDocumentKey(document.key);
    setEditorEditing(false);
    setEditorTitleHeight(58);
    setEditorContentHeight(280);
    setError(undefined);
    const previousMode = workspaceModeRef.current;
    titleRef.current = document.name;
    setTitle(document.name);
    workspaceModeRef.current = "editor";
    setWorkspaceMode("editor");
    try {
      const opened = await getContentDocument(queryClient, contentContext, document.key);
      if (generation !== navigationGeneration.current) return false;
      if (opened.extension) {
        workspaceModeRef.current = previousMode;
        setWorkspaceMode(previousMode);
        setSelectedDocument(opened);
        if (sheetOpen) pushSheet("documentActions");
        else openSheet("documentActions");
        return false;
      }
      editorSession.current += 1;
      applyRemoteDocument(opened);
      workspaceModeRef.current = "editor";
      setWorkspaceMode("editor");
      setSelectedSummary(undefined);
      if (!preserveSearch) {
        setQuery("");
        setResults(undefined);
      }
      return true;
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : "The document could not be opened.");
      workspaceModeRef.current = previousMode;
      setWorkspaceMode(previousMode);
      return false;
    } finally {
      if (generation === navigationGeneration.current) setOpeningDocumentKey(undefined);
    }
  };

  const openArchiveDocument = async (document: ContentDocument, fromSheet = false, preserveSearch = false) => {
    if (document.extension) {
      const generation = ++navigationGeneration.current;
      stopNarration();
      setSelectedDocument(document);
      setFilePreview(undefined);
      setFilePreviewError(undefined);
      setFilePreviewUri(undefined);
      setFileContent("");
      setOpeningDocumentKey(document.key);
      workspaceModeRef.current = "viewer";
      setWorkspaceMode("viewer");
      if (fromSheet) closeSheet();
      try {
        const [preview, detail] = await Promise.all([
          getContentDocumentPreview(queryClient, contentContext, document.key),
          getContentDocument(queryClient, contentContext, document.key),
        ]);
        if (generation !== navigationGeneration.current) return false;
        setFilePreview(preview);
        setFileContent(detail.content);
        setSelectedDocument(preview);
        if (preview.extension === "pdf") {
          const original = await downloadContentDocument(preview.key, "original");
          if (generation !== navigationGeneration.current) return false;
          previewFileRef.current?.delete();
          const file = await saveTemporaryBase64File(original.fileName, original.content);
          if (generation !== navigationGeneration.current) { file.delete(); return false; }
          previewFileRef.current = file;
          setFilePreviewUri(file.uri);
        }
      } catch (cause) {
        if (generation === navigationGeneration.current) setFilePreviewError(cause instanceof Error ? cause.message : "The file could not be opened.");
        return false;
      } finally {
        if (generation === navigationGeneration.current) setOpeningDocumentKey(undefined);
      }
      return true;
    }
    const opened = await openNote(document, fromSheet ? setSheetError : setError, preserveSearch);
    if (opened) {
      if (fromSheet) closeSheet();
    }
    return opened;
  };

  const listenToSelectedDocument = async () => {
    if (!selectedDocument) return;
    const target = selectedDocument;
    setDocumentActionLoading("listen");
    try {
      if (await openArchiveDocument(target, true)) await openAudioVersionHistory(target);
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The document could not be opened for listening.");
    } finally {
      setDocumentActionLoading(undefined);
    }
  };

  const clearSelection = () => {
    setSelectedFolders([]);
    setSelectedDocuments([]);
    setHydratingFolderKeys([]);
    setHydratingDocumentKeys([]);
  };

  const showSelectionLimit = () => showToast({ title: "Selection limit reached", description: `Select no more than ${MAX_SELECTED_CONTENT_RESOURCES} folders, documents, and files at once.` });

  const toggleFolderSelection = (folder: ContentFolder) => {
    setSelectedFolders((current) => {
      if (current.some(({ key }) => key === folder.key)) return current.filter(({ key }) => key !== folder.key);
      if (current.length + selectedDocuments.length >= MAX_SELECTED_CONTENT_RESOURCES) { showSelectionLimit(); return current; }
      return [...current, folder];
    });
  };

  const toggleDocumentSelection = (document: ContentDocument) => {
    setSelectedDocuments((current) => {
      if (current.some(({ key }) => key === document.key)) return current.filter(({ key }) => key !== document.key);
      if (current.length + selectedFolders.length >= MAX_SELECTED_CONTENT_RESOURCES) { showSelectionLimit(); return current; }
      return [...current, document];
    });
  };

  const markLongPress = (id: string) => {
    longPressedItem.current = id;
    void Haptics.selectionAsync();
  };

  const consumeLongPress = (id: string) => {
    const marker = longPressedItem.current;
    if (marker !== id) return false;
    longPressedItem.current = undefined;
    return true;
  };

  const hydrateSelectedFolder = (folder: ContentFolder) => {
    if (folder.isFavorite !== undefined) return;
    setHydratingFolderKeys((current) => [...current.filter((key) => key !== folder.key), folder.key]);
    void getContentLocation(queryClient, contentContext, folder.parentFolderKey).then((location) => {
      const resolved = location.folders.find(({ key }) => key === folder.key);
      setSelectedFolders((current) => current.map((item) => item.key === folder.key ? resolved ?? { ...item, isFavorite: false } : item));
    }).catch(() => {
      setSelectedFolders((current) => current.map((item) => item.key === folder.key ? { ...item, isFavorite: false } : item));
    }).finally(() => setHydratingFolderKeys((current) => current.filter((key) => key !== folder.key)));
  };

  const handleFolderLongPress = (folder: ContentFolder) => {
    markLongPress(`folder:${folder.key}`);
    const selecting = !selectedFolders.some(({ key }) => key === folder.key);
    toggleFolderSelection(folder);
    if (selecting && selectedCount < MAX_SELECTED_CONTENT_RESOURCES) hydrateSelectedFolder(folder);
  };

  const handleFolderPress = (folder: ContentFolder) => {
    const id = `folder:${folder.key}`;
    if (consumeLongPress(id)) return;
    if (selectionActive) {
      const selecting = !selectedFolders.some(({ key }) => key === folder.key);
      toggleFolderSelection(folder);
      if (selecting && selectedCount < MAX_SELECTED_CONTENT_RESOURCES) hydrateSelectedFolder(folder);
    }
    else void (hasContentContext ? openFolder(folder) : selectFolder(folder));
  };

  const handleDocumentLongPress = (document: ContentDocument) => {
    markLongPress(`document:${document.key}`);
    toggleDocumentSelection(document);
  };

  const handleSearchDocumentLongPress = (document: ContentSearchDocument) => {
    const provisional: ContentDocument = { key: document.documentKey, name: document.name, folderKey: document.folderKey, extension: document.extension, isFavorite: false, updatedAt: "" };
    const selecting = !selectedDocuments.some(({ key }) => key === document.documentKey);
    handleDocumentLongPress(provisional);
    if (!selecting || selectedCount >= MAX_SELECTED_CONTENT_RESOURCES) return;
    setHydratingDocumentKeys((current) => [...current.filter((key) => key !== document.documentKey), document.documentKey]);
    void getContentDocument(queryClient, contentContext, document.documentKey).then((resolved) => {
      setSelectedDocuments((current) => current.map((item) => item.key === resolved.key ? resolved : item));
    }).catch(() => undefined).finally(() => setHydratingDocumentKeys((current) => current.filter((key) => key !== document.documentKey)));
  };

  const handleDocumentPress = (document: ContentDocument) => {
    const id = `document:${document.key}`;
    if (consumeLongPress(id)) return;
    if (selectionActive) toggleDocumentSelection(document);
    else void openArchiveDocument(document);
  };

  const handleSearchDocumentPress = (document: ContentSearchDocument) => {
    const id = `document:${document.documentKey}`;
    if (consumeLongPress(id)) return;
    if (selectionActive) {
      const existing = selectedDocuments.find(({ key }) => key === document.documentKey);
      toggleDocumentSelection(existing ?? { key: document.documentKey, name: document.name, folderKey: document.folderKey, extension: document.extension, isFavorite: false, updatedAt: "" });
      if (!existing && selectedCount < MAX_SELECTED_CONTENT_RESOURCES) {
        setHydratingDocumentKeys((current) => [...current.filter((key) => key !== document.documentKey), document.documentKey]);
        void getContentDocument(queryClient, contentContext, document.documentKey).then((resolved) => {
          setSelectedDocuments((current) => current.map((item) => item.key === resolved.key ? resolved : item));
        }).catch(() => undefined).finally(() => setHydratingDocumentKeys((current) => current.filter((key) => key !== document.documentKey)));
      }
    } else void openSearchDocument(document);
  };

  const beginSingleSelection = (item: ContentFolder | ContentDocument, kind: "folder" | "document") => {
    setSelectedFolders(kind === "folder" ? [item as ContentFolder] : []);
    setSelectedDocuments(kind === "document" ? [item as ContentDocument] : []);
  };

  const resolveStructuralResources = async (selectedFoldersSnapshot: readonly ContentFolder[], selectedDocumentsSnapshot: readonly ContentDocument[]) => {
    if (selectedFoldersSnapshot.length === 0) return { folders: [...selectedFoldersSnapshot], documents: [...selectedDocumentsSnapshot] };
    const requiredFolderKeys = [...new Set([
      ...selectedFoldersSnapshot.map(({ key }) => key),
      ...selectedDocumentsSnapshot.flatMap(({ folderKey }) => folderKey ? [folderKey] : []),
    ])];
    const parentByKey = new Map<string, string | undefined>();
    const expanded = new Set<string | undefined>();
    const queued = new Set<string>();
    const queue: string[] = [];
    const enqueue = (folderKey: string) => {
      if (expanded.has(folderKey) || queued.has(folderKey)) return;
      queued.add(folderKey);
      queue.push(folderKey);
    };
    const addFolder = (folder: ContentFolder, fallbackParentKey?: string, shouldEnqueue = true) => {
      parentByKey.set(folder.key, folder.parentFolderKey ?? fallbackParentKey);
      if (shouldEnqueue) enqueue(folder.key);
    };
    const addLocation = (parentFolderKey: string | undefined, location: ContentLocation) => {
      expanded.add(parentFolderKey);
      location.folders.forEach((folder) => addFolder(folder, parentFolderKey));
    };
    selectedFoldersSnapshot.forEach((folder) => addFolder(folder, undefined, false));
    folderStack.forEach((folder) => addFolder(folder, undefined, false));
    queryClient.getQueriesData<ContentLocation>({ queryKey: contentQueryKeys.locations(contentContext) }).forEach(([queryKey, location]) => {
      if (!location) return;
      const cacheFolderKey = queryKey.at(-1);
      addLocation(typeof cacheFolderKey === "string" ? cacheFolderKey : undefined, location);
    });
    const chainsComplete = () => requiredFolderKeys.every((requiredFolderKey) => {
      let key: string | undefined = requiredFolderKey;
      const visited = new Set<string>();
      while (key) {
        if (visited.has(key) || !parentByKey.has(key)) return false;
        visited.add(key);
        key = parentByKey.get(key);
      }
      return true;
    });
    if (!chainsComplete() && !expanded.has(undefined)) addLocation(undefined, await getContentLocation(queryClient, contentContext));
    while (!chainsComplete()) {
      const folderKey = queue.shift();
      if (!folderKey) throw new Error("Archive could not verify the selected resources' folder ancestry. Refresh Archive and try again.");
      queued.delete(folderKey);
      if (expanded.has(folderKey)) continue;
      addLocation(folderKey, await getContentLocation(queryClient, contentContext, folderKey));
    }
    return normalizeStructurallyCoveredResources(selectedFoldersSnapshot, selectedDocumentsSnapshot, parentByKey);
  };

  const showFolderActions = (folder: ContentFolder) => {
    folderActionGeneration.current += 1;
    setSelectedFolder(folder);
    if (sheetOpen) pushSheet("folderActions");
    else openSheet("folderActions");
  };

  const openFolderDetails = () => {
    if (!selectedFolder) return;
    setFolderDetailsName(selectedFolder.name);
    setFolderDetailsDescription(selectedFolder.description ?? "");
    setFolderDetailsFavorite(Boolean(selectedFolder.isFavorite));
    setFolderDetailsCoverAsset(undefined);
    pushSheet("folderDetails");
  };

  const chooseFolderCover = async () => {
    if (!selectedFolder) return;
    setSheetError(undefined);
    let result: ImagePicker.ImagePickerResult;
    try {
      result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false, quality: 1 });
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The image picker could not be opened.");
      return;
    }
    if (result.canceled) return;
    const asset = result.assets[0];
    if (!asset) return;
    setFolderDetailsCoverAsset(asset);
  };

  const clearFolderCover = () => {
    setFolderDetailsCoverAsset(null);
  };

  const replaceFolder = (updated: ContentFolder, select = true) => {
    const replace = (folder: ContentFolder) => folder.key === updated.key ? updated : folder;
    setFolders((current) => current.map(replace));
    setRootFolders((current) => current.map(replace));
    setFolderStack((current) => current.map(replace));
    setDestinationFolders((current) => current.map(replace));
    setRootSearchResults((current) => current ? { ...current, folders: current.folders.map((folder) => folder.key === updated.key ? { ...folder, ...updated } : folder) } : current);
    setFolderSearchResults((current) => current ? { ...current, folders: current.folders.map((folder) => folder.key === updated.key ? { ...folder, ...updated } : folder) } : current);
    replaceCachedContentFolder(queryClient, contentContext, updated);
    if (select) setSelectedFolder(updated);
  };

  const replaceDocument = (updated: ContentDocument, select = true) => {
    const replace = (document: ContentDocument) => document.key === updated.key ? updated : document;
    setDocuments((current) => current.map(replace));
    setRootDocuments((current) => current.map(replace));
    replaceCachedContentDocument(queryClient, contentContext, updated);
    if (select) setSelectedDocument(updated);
  };

  const trackActiveDocumentMutation = <T,>(documentKey: string, operation: Promise<T>, apply: (value: T) => void) => {
    const resolved = operation.then((value) => { apply(value); return value; });
    if (documentKey !== documentKeyRef.current) return resolved;
    const tracked = resolved.then(() => undefined, () => undefined);
    documentMetadataMutation.current = tracked;
    void tracked.finally(() => {
      if (documentMetadataMutation.current === tracked) documentMetadataMutation.current = null;
    });
    return resolved;
  };

  const submitFolderDetails = async () => {
    const name = folderDetailsName.trim();
    if (!selectedFolder || !name) return;
    const previous = selectedFolder;
    const coverChange = folderDetailsCoverAsset;
    const optimistic = {
      ...previous,
      name,
      description: folderDetailsDescription.trim() || undefined,
      isFavorite: folderDetailsFavorite,
      ...(coverChange !== undefined ? { coverUrl: coverChange?.uri } : {}),
    };
    const coverRequest = coverChange !== undefined ? (folderCoverRequests.current.get(previous.key) ?? 0) + 1 : undefined;
    if (coverRequest !== undefined) folderCoverRequests.current.set(previous.key, coverRequest);
    replaceFolder(optimistic);
    void invalidateContentLocations(queryClient, contentContext, [previous.parentFolderKey]);
    closeSheet();
    if (coverChange !== undefined && currentFolder?.key === previous.key) void goBackFolder();
    void (async () => {
      let updated = await updateContentFolder(previous.key, name, folderDetailsDescription.trim() || null);
      if (folderDetailsFavorite !== Boolean(previous.isFavorite)) updated = await setContentFolderFavorite(previous.key, folderDetailsFavorite);
      if (coverChange === null) updated = await setContentFolderCover(previous.key, null);
      if (coverChange) {
        const output = await normalizeCapturedJpeg(coverChange, { maxSide: 2400, compress: 0.88 });
        const upload = await uploadGalleryImages([{ clientKey: `${Date.now()}-${previous.key}`, filename: `folder-cover-${Date.now()}.jpg`, uri: output.uri, sizeBytes: output.sizeBytes, processingMode: "cover" }]);
        const job = upload.jobs[0];
        if (!job) throw new Error("The folder cover upload could not be started.");
        let status = job.status;
        for (let attempt = 0; status !== "completed" && status !== "failed" && attempt < 40; attempt += 1) {
          await wait(3_000);
          status = (await fetchGalleryUploadStatus([job.key])).jobs[0]?.status ?? status;
        }
        if (status !== "completed") throw new Error("The folder cover could not be processed.");
        if (coverRequest !== folderCoverRequests.current.get(previous.key)) return;
        updated = await setContentFolderCover(previous.key, job.imageKey);
      }
      if (coverRequest !== undefined && coverRequest !== folderCoverRequests.current.get(previous.key)) return;
      replaceFolder(updated, false);
      void invalidateContentLocations(queryClient, contentContext, [previous.parentFolderKey]);
    })().catch(async (cause: unknown) => {
      try {
        const location = await refreshContentLocation(queryClient, contentContext, previous.parentFolderKey);
        replaceFolder(location.folders.find(({ key }) => key === previous.key) ?? previous, false);
      } catch {
        replaceFolder(previous, false);
      }
      showToast({ title: "Folder update failed", description: cause instanceof Error ? cause.message : "The folder could not be updated." });
    });
  };

  const openFolder = async (folder: ContentFolder) => {
    if (!hasContentContext) return;
    if (folderStack.at(-1)?.key === folder.key) {
      setQuery("");
      return;
    }
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      setError("Wait for the current document to save before opening a folder.");
      return;
    }
    const generation = ++navigationGeneration.current;
    const previousFolders = folders;
    const previousDocuments = documents;
    const previousStack = folderStack;
    const previousMode = workspaceModeRef.current;
    setError(undefined);
    const cached = queryClient.getQueryData<{ folders: ContentFolder[]; documents: ContentDocument[] }>(contentQueryKeys.location(contentContext, folder.key));
    setLocationLoading(!cached);
    if (cached) {
      setFolders(cached.folders);
      setDocuments(cached.documents);
    } else {
      setFolders([]);
      setDocuments([]);
    }
    setFolderStack((current) => [...current, folder]);
    setFolderContentTab("folders");
    workspaceModeRef.current = "folder";
    setWorkspaceMode("folder");
    setQuery("");
    setResults(undefined);
    try {
      const [location, recent] = await Promise.all([getContentLocation(queryClient, contentContext, folder.key), getContentHistory(queryClient, contentContext, folder.key)]);
      if (generation !== navigationGeneration.current) return;
      setFolders(location.folders);
      setDocuments(location.documents);
      setHistory(recent);
    } catch (cause) {
      if (generation === navigationGeneration.current) {
        setFolders(previousFolders);
        setDocuments(previousDocuments);
        setFolderStack(previousStack);
        workspaceModeRef.current = previousMode;
        setWorkspaceMode(previousMode);
        setError(cause instanceof Error ? cause.message : "The folder could not be opened.");
      }
    } finally {
      if (generation === navigationGeneration.current) setLocationLoading(false);
    }
  };

  const goBackFolder = async () => {
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      setError("Wait for the current document to save before navigating.");
      return;
    }
    if (!hasContentContext) {
      setFolders(rootFolders);
      setDocuments([]);
      setFolderStack([]);
      workspaceModeRef.current = "folders";
      setWorkspaceMode("folders");
      return;
    }
    const generation = ++navigationGeneration.current;
    const previousFolders = folders;
    const previousDocuments = documents;
    const previousStack = folderStack;
    const previousMode = workspaceModeRef.current;
    const nextStack = folderStack.slice(0, -1);
    setError(undefined);
    const nextFolderKey = nextStack.at(-1)?.key;
    const cached = queryClient.getQueryData<{ folders: ContentFolder[]; documents: ContentDocument[] }>(contentQueryKeys.location(contentContext, nextFolderKey));
    setLocationLoading(!cached);
    if (cached) {
      setFolders(cached.folders);
      setDocuments(cached.documents);
    } else {
      setFolders([]);
      setDocuments([]);
    }
    setFolderStack(nextStack);
    setFolderContentTab("folders");
    const nextMode = nextStack.length > 0 ? "folder" : "folders";
    workspaceModeRef.current = nextMode;
    setWorkspaceMode(nextMode);
    setQuery("");
    setResults(undefined);
    try {
      const [location, recent] = await Promise.all([getContentLocation(queryClient, contentContext, nextFolderKey), getContentHistory(queryClient, contentContext, nextFolderKey)]);
      if (generation !== navigationGeneration.current) return;
      setFolders(location.folders);
      setDocuments(location.documents);
      if (nextMode === "folders") {
        setRootFolders(location.folders);
        setRootDocuments(location.documents);
      }
      setHistory(recent);
    } catch (cause) {
      if (generation === navigationGeneration.current) {
        setFolders(previousFolders);
        setDocuments(previousDocuments);
        setFolderStack(previousStack);
        workspaceModeRef.current = previousMode;
        setWorkspaceMode(previousMode);
        setError(cause instanceof Error ? cause.message : "The folder could not be opened.");
      }
    } finally {
      if (generation === navigationGeneration.current) setLocationLoading(false);
    }
  };

  const leaveEditor = () => {
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      setError("Wait for the current document to save before leaving.");
      return;
    }
    Keyboard.dismiss();
    stopNarration();
    setDocumentSearchQuery("");
    const nextMode = folderStack.length ? "folder" : "folders";
    workspaceModeRef.current = nextMode;
    setWorkspaceMode(nextMode);
  };

  const leaveFileViewer = () => {
    navigationGeneration.current += 1;
    stopNarration();
    previewFileRef.current?.delete();
    previewFileRef.current = undefined;
    setFilePreview(undefined);
    setFilePreviewError(undefined);
    setFilePreviewUri(undefined);
    setFileContent("");
    const nextMode = folderStack.length ? "folder" : "folders";
    workspaceModeRef.current = nextMode;
    setWorkspaceMode(nextMode);
  };

  useEffect(() => {
    if (Platform.OS !== "android") return;
    return BackHandler.addEventListener("hardwareBackPress", () => {
      if (selectionActive) {
        clearSelection();
        return true;
      }
      if (workspaceModeRef.current === "editor") {
        leaveEditor();
        return true;
      }
      if (workspaceModeRef.current === "viewer") {
        leaveFileViewer();
        return true;
      }
      if (workspaceModeRef.current === "folder") {
        void goBackFolder();
        return true;
      }
      return false;
    }).remove;
  }, [folderStack, hasContentContext, selectionActive]);

  const runSearch = async (searchQuery = query) => {
    const normalized = searchQuery.trim();
    if (!normalized || !hasContentContext) return;
    const generation = ++navigationGeneration.current;
    const folderKey = currentFolder?.key;
    setSearching(true);
    setError(undefined);
    try {
      const response = await searchContent(normalized, folderKey, true);
      if (generation !== navigationGeneration.current) return;
      const recent = await refreshContentHistory(queryClient, contentContext, folderKey);
      if (generation !== navigationGeneration.current) return;
      setQuery(response.query);
      setResults(response);
      setHistory(recent);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed.");
    } finally {
      if (generation === navigationGeneration.current) setSearching(false);
    }
  };

  useEffect(() => {
    const normalized = rootSearchQuery.trim();
    rootSearchRequest.current?.abort();
    if (!normalized || !hasContentContext) {
      setRootSearching(false);
      setRootSearchResults(undefined);
      return;
    }
    setRootSearchResults(undefined);
    const controller = new AbortController();
    rootSearchRequest.current = controller;
    const timeout = setTimeout(() => {
      setRootSearching(true);
      setError(undefined);
      void searchContentMatches(normalized, controller.signal).then((matches) => {
        if (!controller.signal.aborted) setRootSearchResults(matches);
      }).catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Search failed.");
      }).finally(() => {
        if (!controller.signal.aborted) setRootSearching(false);
      });
    }, 300);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [hasContentContext, rootSearchQuery]);

  useEffect(() => {
    const normalized = query.trim();
    const folderKey = currentFolder?.key;
    folderSearchRequest.current?.abort();
    if (!normalized || !hasContentContext || !folderKey) {
      setFolderSearching(false);
      setFolderSearchResults(undefined);
      return;
    }
    setFolderSearchResults(undefined);
    const controller = new AbortController();
    folderSearchRequest.current = controller;
    const timeout = setTimeout(() => {
      setFolderSearching(true);
      setError(undefined);
      void searchContentMatches(normalized, controller.signal, folderKey).then((matches) => {
        if (!controller.signal.aborted) setFolderSearchResults(matches);
      }).catch((cause) => {
        if (!controller.signal.aborted) setError(cause instanceof Error ? cause.message : "Search failed.");
      }).finally(() => {
        if (!controller.signal.aborted) setFolderSearching(false);
      });
    }, 300);
    return () => {
      clearTimeout(timeout);
      controller.abort();
    };
  }, [currentFolder?.key, hasContentContext, query]);

  const openSearchDocument = async (document: ContentSearchMatch) => {
    setError(undefined);
    try {
      const opened = await getContentDocument(queryClient, contentContext, document.documentKey);
      await openArchiveDocument(opened, false, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The document could not be opened.");
    }
  };

  const submitFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    if (!hasContentContext) {
      setSheetError("Folders require an authenticated Archive connection.");
      return;
    }
    const parentFolderKey = currentFolder?.key;
    const temporaryKey = `optimistic-${createContentMutationKey()}`;
    const optimistic: ContentFolder = { key: temporaryKey, ...(parentFolderKey ? { parentFolderKey } : {}), name, ...(folderDescription.trim() ? { description: folderDescription.trim() } : {}) };
    const addFolder = (current: ContentFolder[], folder: ContentFolder) => [...current.filter(({ key }) => key !== temporaryKey && key !== folder.key), folder]
      .sort((left, right) => left.name.localeCompare(right.name));
    setFolders((current) => addFolder(current, optimistic));
    if (!parentFolderKey) setRootFolders((current) => addFolder(current, optimistic));
    addCachedContentFolder(queryClient, contentContext, parentFolderKey, optimistic);
    setFolderName("");
    setFolderDescription("");
    closeSheet();
    try {
      const created = await createContentFolder(name, parentFolderKey, optimistic.description);
      removeCachedContentFolder(queryClient, contentContext, parentFolderKey, temporaryKey);
      addCachedContentFolder(queryClient, contentContext, parentFolderKey, created);
      setFolders((current) => addFolder(current.filter(({ key }) => key !== temporaryKey), created));
      if (!parentFolderKey) setRootFolders((current) => addFolder(current.filter(({ key }) => key !== temporaryKey), created));
      void invalidateContentLocations(queryClient, contentContext, [parentFolderKey]);
    } catch (cause) {
      removeCachedContentFolder(queryClient, contentContext, parentFolderKey, temporaryKey);
      setFolders((current) => current.filter(({ key }) => key !== temporaryKey));
      if (!parentFolderKey) setRootFolders((current) => current.filter(({ key }) => key !== temporaryKey));
      showToast({ title: "Folder creation failed", description: cause instanceof Error ? cause.message : "The folder could not be created." });
    }
  };

  const selectRootFolder = async () => {
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      setSheetError("Wait for the current document to save before changing folders.");
      return;
    }
    const generation = ++navigationGeneration.current;
    setLocationLoading(true);
    setSheetError(undefined);
    try {
      if (hasContentContext) {
        const [location, recent] = await Promise.all([getContentLocation(queryClient, contentContext), getContentHistory(queryClient, contentContext)]);
        if (generation !== navigationGeneration.current) return;
        setFolders(location.folders);
        setRootFolders(location.folders);
        setDocuments(location.documents);
        setRootDocuments(location.documents);
        setHistory(recent);
      } else {
        setFolders(rootFolders);
        setDocuments([]);
      }
      setFolderStack([]);
      workspaceModeRef.current = "folder";
      setWorkspaceMode("folder");
      if (hasContentContext) resetEditor();
      closeSheet();
    } catch (cause) {
      if (generation === navigationGeneration.current) setSheetError(cause instanceof Error ? cause.message : "Archive could not change folders.");
    } finally {
      if (generation === navigationGeneration.current) setLocationLoading(false);
    }
  };

  const selectFolder = async (folder: ContentFolder) => {
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      setSheetError("Wait for the current document to save before changing folders.");
      return;
    }
    const generation = ++navigationGeneration.current;
    setLocationLoading(true);
    setSheetError(undefined);
    try {
      if (hasContentContext) {
        const [location, recent] = await Promise.all([getContentLocation(queryClient, contentContext, folder.key), getContentHistory(queryClient, contentContext, folder.key)]);
        if (generation !== navigationGeneration.current) return;
        setFolders(location.folders);
        setDocuments(location.documents);
        setHistory(recent);
      } else {
        setFolders([]);
        setDocuments([]);
      }
      setFolderStack([folder]);
      workspaceModeRef.current = "folder";
      setWorkspaceMode("folder");
      if (hasContentContext) resetEditor();
      closeSheet();
    } catch (cause) {
      if (generation === navigationGeneration.current) setSheetError(cause instanceof Error ? cause.message : "Archive could not change folders.");
    } finally {
      if (generation === navigationGeneration.current) setLocationLoading(false);
    }
  };

  const restoreHistory = (item: ContentSearchHistoryItem) => {
    setQuery(item.query);
    setResults({ query: item.query, cached: true, folders: [], documents: item.documents });
  };

  const openSummaryDocument = async () => {
    if (!selectedSummary) return;
    try {
      const document = await getContentDocument(queryClient, contentContext, selectedSummary.documentKey);
      if (document.extension) {
        closeSheet();
        await openArchiveDocument(document);
        return;
      }
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The file could not be opened.");
      return;
    }
    const opened = await openNote({
      key: selectedSummary.documentKey,
      name: selectedSummary.name,
      folderKey: selectedSummary.folderKey,
      isFavorite: false,
      updatedAt: new Date().toISOString(),
    }, setSheetError);
    if (opened) closeSheet();
  };

  const openNewFolder = () => {
    setFolderName("");
    setFolderDescription("");
    if (sheetOpen) pushSheet("folder");
    else openSheet("folder");
  };

  const openDestinationPicker = async (action: DestinationAction, directSelection?: { folder?: ContentFolder; document?: ContentDocument }) => {
    if (!hasContentContext) {
      setSheetError("This action requires a connected Archive.");
      return;
    }
    const generation = ++destinationGeneration.current;
    if (directSelection?.folder) beginSingleSelection(directSelection.folder, "folder");
    if (directSelection?.document) beginSingleSelection(directSelection.document, "document");
    setDestinationUsesDirectSelection(Boolean(directSelection));
    setTemporarySingleSelection(Boolean(directSelection));
    setDestinationAction(action);
    const sourceFolderKey = action === "upload"
      ? currentFolder?.key
      : directSelection?.folder?.parentFolderKey ?? directSelection?.document?.folderKey ?? currentFolder?.key;
    const sourceStackCandidate = action === "upload" || sourceFolderKey === currentFolder?.key
      ? folderStack
      : sourceFolderKey === folderStack.at(-2)?.key
        ? folderStack.slice(0, -1)
        : [];
    const sourceStack = sourceStackCandidate.every((folder, index) => folder.parentFolderKey === sourceStackCandidate[index - 1]?.key)
      ? sourceStackCandidate
      : [];
    const sourceFolderKeys = action === "upload"
      ? []
      : directSelection?.folder
        ? [directSelection.folder.parentFolderKey ?? null]
        : directSelection?.document
          ? [directSelection.document.folderKey ?? null]
          : [...new Set([...selectedFolders.map(({ parentFolderKey }) => parentFolderKey ?? null), ...selectedDocuments.map(({ folderKey }) => folderKey ?? null), ...(selectedCount ? [] : [currentFolder?.key ?? null])])];
    setDestinationSourceFolderKeys(sourceFolderKeys);
    setDestinationBlockedFolderKeys(action === "upload" ? [] : directSelection?.folder ? [directSelection.folder.key] : selectedFolders.map(({ key }) => key));
    setDestinationStack(sourceStack);
    setDestinationFolders([]);
    if (action === "upload") {
      if (sheetOpen) pushSheet("destination");
      else openSheet("destination");
    } else if (sheetOpen) pushSheet("destinationBrowser");
    else openSheet("destinationBrowser");
    setDestinationLoading(true);
    try {
      let resolvedStack = sourceStack;
      if (sourceFolderKey && resolvedStack.at(-1)?.key !== sourceFolderKey) {
        const queue: { folderKey?: string; stack: ContentFolder[] }[] = [{ stack: [] }];
        const visited = new Set<string | undefined>();
        while (queue.length) {
          const candidate = queue.shift()!;
          if (visited.has(candidate.folderKey)) continue;
          visited.add(candidate.folderKey);
          const location = await getContentLocation(queryClient, contentContext, candidate.folderKey);
          const source = location.folders.find(({ key }) => key === sourceFolderKey);
          if (source) {
            resolvedStack = [...candidate.stack, source];
            break;
          }
          location.folders.forEach((folder) => queue.push({ folderKey: folder.key, stack: [...candidate.stack, folder] }));
        }
      }
      const next = (await getContentLocation(queryClient, contentContext, sourceFolderKey)).folders;
      if (generation === destinationGeneration.current) {
        setDestinationStack(resolvedStack);
        setDestinationFolders(next);
      }
    } catch (cause) {
      if (generation === destinationGeneration.current) setSheetError(cause instanceof Error ? cause.message : "Folders could not be loaded.");
    } finally {
      if (generation === destinationGeneration.current) setDestinationLoading(false);
    }
  };

  const openDestinationBrowser = async () => {
    const generation = ++destinationGeneration.current;
    setDestinationLoading(true);
    setDestinationFolders([]);
    setSheetError(undefined);
    pushSheet("destinationBrowser");
    try {
      const children = (await getContentLocation(queryClient, contentContext, destinationFolder?.key)).folders;
      if (generation === destinationGeneration.current) setDestinationFolders(children);
    } catch (cause) {
      if (generation === destinationGeneration.current) setSheetError(cause instanceof Error ? cause.message : "Folders could not be loaded.");
    } finally {
      if (generation === destinationGeneration.current) setDestinationLoading(false);
    }
  };

  const browseDestination = async (folder?: ContentFolder, back = false) => {
    const generation = ++destinationGeneration.current;
    const nextStack = back ? destinationStack.slice(0, -1) : folder ? [...destinationStack, folder] : [];
    setDestinationLoading(true);
    setDestinationStack(nextStack);
    setDestinationFolders([]);
    setSheetError(undefined);
    try {
      const next = (await getContentLocation(queryClient, contentContext, nextStack.at(-1)?.key)).folders;
      if (generation !== destinationGeneration.current) return;
      setDestinationFolders(next);
    } catch (cause) {
      if (generation === destinationGeneration.current) setSheetError(cause instanceof Error ? cause.message : "The folder could not be opened.");
    } finally {
      if (generation === destinationGeneration.current) setDestinationLoading(false);
    }
  };

  const pickAndUpload = async (folderKey?: string) => {
    const visibleFolderKey = currentFolder?.key;
    const requestContext = getContentContext();
    const requestContextKey = `${requestContext.organizationKey}:${requestContext.scopeKey}:${requestContext.agentKey}`;
    const generation = ++uploadGeneration.current;
    setSheetError(undefined);
    try {
      const picked = await File.pickFileAsync({ multipleFiles: true, mimeTypes: UPLOAD_MIME_TYPES });
      if (picked.canceled) return;
      const batch = picked.result.map((file, index): UploadBatchItem => ({ id: `${file.uri}-${index}`, file, name: file.name, status: "pending" }));
      setUploadFolderKey(folderKey);
      uploadBatchRef.current = batch;
      setUploadBatch(batch);
      setUploading(true);
      setFolderContentTab("files");
      closeSheet();
      let cursor = 0;
      const update = (id: string, change: Partial<UploadBatchItem>) => {
        uploadBatchRef.current = uploadBatchRef.current.map((item) => item.id === id ? { ...item, ...change } : item);
        setUploadBatch(uploadBatchRef.current);
      };
      const worker = async () => {
        while (cursor < batch.length) {
          const item = batch[cursor];
          cursor += 1;
          if (!item) return;
          update(item.id, { status: "uploading" });
          try {
            if (item.file.size > MAX_MOBILE_UPLOAD_BYTES) throw new Error("Mobile uploads must be 8 MB or smaller.");
            const { document } = await uploadContentDocument({ name: item.file.name, type: item.file.type, size: item.file.size, base64: await item.file.base64() }, folderKey, requestContext);
            if (generation !== uploadGeneration.current || contentContextKeyRef.current !== requestContextKey) return;
            addCachedContentDocument(queryClient, requestContext, folderKey, document);
            if (currentFolderKeyRef.current === folderKey) {
              const addDocument = (current: ContentDocument[]) => [...current.filter(({ key }) => key !== document.key), document]
                .sort((left, right) => left.name.localeCompare(right.name));
              setDocuments(addDocument);
              if (!folderKey) setRootDocuments(addDocument);
            }
            update(item.id, { status: "success" });
          } catch (cause) {
            if (generation !== uploadGeneration.current || contentContextKeyRef.current !== requestContextKey) return;
            update(item.id, { status: "error", error: cause instanceof Error ? cause.message : "Upload failed." });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, batch.length) }, () => worker()));
      if (generation !== uploadGeneration.current || contentContextKeyRef.current !== requestContextKey) return;
      const completed = uploadBatchRef.current;
      const successCount = completed.filter(({ status }) => status === "success").length;
      const failureCount = completed.filter(({ status }) => status === "error").length;
      await invalidateContentLocations(queryClient, contentContext, [folderKey]);
      const location = visibleFolderKey === folderKey
        ? await getContentLocation(queryClient, contentContext, visibleFolderKey)
        : undefined;
      if (location && currentFolderKeyRef.current === visibleFolderKey) {
        setFolders(location.folders);
        setDocuments(location.documents);
        if (!visibleFolderKey) {
          setRootFolders(location.folders);
          setRootDocuments(location.documents);
        }
      }
      showToast({
        title: successCount > 0 ? `Uploaded ${successCount} ${successCount === 1 ? "file" : "files"}` : "Files could not be uploaded",
        ...(failureCount > 0 ? { description: `${failureCount} ${failureCount === 1 ? "file" : "files"} failed.` } : {}),
      });
      uploadBatchRef.current = [];
      setUploadBatch([]);
      setUploadFolderKey(undefined);
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "Files could not be selected.");
    } finally {
      if (generation === uploadGeneration.current) setUploading(false);
    }
  };

  const startDocumentScan = () => {
    if (!hasContentContext || uploading || scanBusy) return;
    setScanFolderKey(currentFolder?.key);
    setScanError(undefined);
    closeSheet();
    setTimeout(() => setScanOpen(true), 240);
  };

  const submitDocumentScan = async (pages: DocumentScanPage[]) => {
    const requestContext = getContentContext();
    const requestContextKey = `${requestContext.organizationKey}:${requestContext.scopeKey}:${requestContext.agentKey}`;
    const folderKey = scanFolderKey;
    setScanBusy(true);
    setScanError(undefined);
    try {
      if (scanSessionSize(pages) > MAX_DOCUMENT_SCAN_BYTES) throw new Error("Scanned pages must be 16 MB or smaller in total.");
      const prepared = await Promise.all(pages.map(async (page, index) => ({ name: `scan-page-${index + 1}.jpg`, size: page.sizeBytes, base64: await new File(page.uri).base64() })));
      const { document } = await scanContentDocument(prepared, folderKey, requestContext);
      if (contentContextKeyRef.current !== requestContextKey) return;
      addCachedContentDocument(queryClient, requestContext, folderKey, document);
      if (currentFolderKeyRef.current === folderKey) {
        const addDocument = (current: ContentDocument[]) => [document, ...current.filter(({ key }) => key !== document.key)];
        setDocuments(addDocument);
        if (!folderKey) setRootDocuments(addDocument);
      }
      await invalidateContentLocations(queryClient, requestContext, [folderKey]);
      setFolderContentTab("documents");
      setScanOpen(false);
      showToast({ title: "Document scanned", description: `${pages.length} ${pages.length === 1 ? "page" : "pages"} converted to an editable document.` });
    } catch (cause) {
      setScanError(cause instanceof Error ? cause.message : "The document could not be scanned.");
    } finally {
      setScanBusy(false);
    }
  };

  const selectDestination = async () => {
    if (destinationAction === "upload") {
      destinationGeneration.current += 1;
      await pickAndUpload(destinationFolder?.key);
      return;
    }
    if (!destinationAction || !selectedCount) return;
    const action = destinationAction;
    const first = { folder: destinationFolder, stack: destinationStack };
    const destinationKeys = [destinationFolder?.key];
    const choices = [first];
    const selectedFoldersSnapshot = [...selectedFolders];
    const selectedDocumentsSnapshot = [...selectedDocuments];
    const directFolder = destinationUsesDirectSelection && selectedFoldersSnapshot.length === 1 && selectedDocumentsSnapshot.length === 0
      ? selectedFoldersSnapshot[0]
      : undefined;
    const directDocument = destinationUsesDirectSelection && selectedDocumentsSnapshot.length === 1 && selectedFoldersSnapshot.length === 0
      ? selectedDocumentsSnapshot[0]
      : undefined;
    if (directDocument) {
      const sourceKey = directDocument.folderKey;
      const targetKey = destinationFolder?.key;
      const previousFolders = folders;
      const previousDocuments = documents;
      const previousRootFolders = rootFolders;
      const previousRootDocuments = rootDocuments;
      const previousFolderStack = folderStack;
      const previousWorkspaceMode = workspaceMode;
      const previousRootSearchQuery = rootSearchQuery;
      const previousRootSearchResults = rootSearchResults;
      const previousQuery = query;
      const previousResults = results;
      const previousFolderSearchResults = folderSearchResults;
      const sourceLocation = queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, sourceKey));
      const destinationLocation = queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, targetKey));
      const optimistic = action === "move"
        ? { ...directDocument, folderKey: targetKey }
        : { ...directDocument, key: `optimistic-${createContentMutationKey()}`, folderKey: targetKey, name: `${directDocument.name} (copying)` };
      if (action === "move") removeCachedContentDocument(queryClient, contentContext, sourceKey, directDocument.key);
      addCachedContentDocument(queryClient, contentContext, targetKey, optimistic);
      const optimisticLocation = queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, targetKey)) ?? { folders: [], documents: [optimistic] };
      setFolders(optimisticLocation.folders);
      setDocuments(optimisticLocation.documents);
      if (destinationFolder) {
        setFolderStack(destinationStack);
        workspaceModeRef.current = "folder";
        setWorkspaceMode("folder");
      } else {
        setRootFolders(optimisticLocation.folders);
        setRootDocuments(optimisticLocation.documents);
        setFolderStack([]);
        workspaceModeRef.current = "folders";
        setWorkspaceMode("folders");
      }
      setFolderContentTab(directDocument.extension ? "files" : "documents");
      setRootSearchQuery("");
      setRootSearchResults(undefined);
      setQuery("");
      setResults(undefined);
      setFolderSearchResults(undefined);
      void invalidateContentLocations(queryClient, contentContext, [sourceKey, targetKey]);
      closeSheet();
      const generation = ++documentActionGeneration.current;
      const navigationRequest = navigationGeneration.current;
      const requestContextKey = contentContextKey;
      const isCurrent = () => generation === documentActionGeneration.current
        && navigationRequest === navigationGeneration.current
        && requestContextKey === contentContextKeyRef.current;
      let committed = false;
      void (action === "move"
        ? moveContentSelection({ folderKeys: [], documentKeys: [directDocument.key] }, targetKey)
        : copyContentSelection({ folderKeys: [], documentKeys: [directDocument.key] }, [targetKey])).then(async (outcome) => {
        if (outcome.succeeded === 0) throw new Error(outcome.failures[0]?.message ?? `The ${directDocument.extension ? "file" : "document"} could not be ${action === "move" ? "moved" : "copied"}.`);
        committed = true;
        if (action === "copy") removeCachedContentDocument(queryClient, contentContext, targetKey, optimistic.key);
        const updated = outcome.documents[0];
        if (updated) {
          addCachedContentDocument(queryClient, contentContext, updated.folderKey, updated);
          if (isCurrent() && action === "copy") {
            if (updated.folderKey === targetKey) setDocuments((current) => [...current.filter(({ key }) => key !== optimistic.key && key !== updated.key), updated]);
            if (!updated.folderKey) setRootDocuments((current) => [...current.filter(({ key }) => key !== optimistic.key && key !== updated.key), updated]);
          } else if (isCurrent()) replaceDocument(updated, false);
        }
        await invalidateContentLocations(queryClient, contentContext, [sourceKey, targetKey]);
        await invalidateContentHistories(queryClient, contentContext, [sourceKey, targetKey, undefined]);
        if (isCurrent()) showToast({ title: `${directDocument.extension ? "File" : "Document"} ${action === "move" ? "moved" : "copied"}` });
      }).catch((cause: unknown) => {
        if (committed) {
          if (isCurrent()) showToast({ title: `${directDocument.extension ? "File" : "Document"} ${action === "move" ? "moved" : "copied"}`, description: "The change completed, but Archive could not refresh yet." });
          return;
        }
        if (sourceLocation) queryClient.setQueryData(contentQueryKeys.location(contentContext, sourceKey), sourceLocation);
        else queryClient.removeQueries({ queryKey: contentQueryKeys.location(contentContext, sourceKey), exact: true });
        if (destinationLocation) queryClient.setQueryData(contentQueryKeys.location(contentContext, targetKey), destinationLocation);
        else queryClient.removeQueries({ queryKey: contentQueryKeys.location(contentContext, targetKey), exact: true });
        if (!isCurrent()) return;
        setFolders(previousFolders);
        setDocuments(previousDocuments);
        setRootFolders(previousRootFolders);
        setRootDocuments(previousRootDocuments);
        setFolderStack(previousFolderStack);
        workspaceModeRef.current = previousWorkspaceMode;
        setWorkspaceMode(previousWorkspaceMode);
        setRootSearchQuery(previousRootSearchQuery);
        setRootSearchResults(previousRootSearchResults);
        setQuery(previousQuery);
        setResults(previousResults);
        setFolderSearchResults(previousFolderSearchResults);
        showToast({ title: `${directDocument.extension ? "File" : "Document"} ${action} failed`, description: cause instanceof Error ? cause.message : `The item could not be ${action === "move" ? "moved" : "copied"}.` });
      });
      return;
    }
    if (directFolder) {
      const sourceKey = directFolder.parentFolderKey;
      const previousFolders = folders;
      const previousDocuments = documents;
      const previousRootFolders = rootFolders;
      const previousRootDocuments = rootDocuments;
      const previousFolderStack = folderStack;
      const previousWorkspaceMode = workspaceMode;
      const previousRootSearchQuery = rootSearchQuery;
      const previousRootSearchResults = rootSearchResults;
      const previousQuery = query;
      const previousResults = results;
      const previousFolderSearchResults = folderSearchResults;
      const sourceLocation = queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, sourceKey));
      const destinationLocations = new Map(destinationKeys.map((key) => [key, queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, key))]));
      const placeholders = action === "copy" ? choices.map((choice, index): ContentFolder => ({
        ...directFolder,
        key: `optimistic-${createContentMutationKey()}-${index}`,
        parentFolderKey: choice.folder?.key,
        name: `${directFolder.name} (copying)`,
        isFavorite: false,
      })) : [];
      if (action === "move") {
        const optimistic = { ...directFolder, parentFolderKey: destinationKeys[0] };
        removeCachedContentFolder(queryClient, contentContext, sourceKey, directFolder.key);
        addCachedContentFolder(queryClient, contentContext, destinationKeys[0], optimistic);
        if (!queryClient.getQueryData(contentQueryKeys.location(contentContext, destinationKeys[0]))) queryClient.setQueryData(contentQueryKeys.location(contentContext, destinationKeys[0]), { folders: [optimistic], documents: [] });
      } else {
        placeholders.forEach((placeholder) => addCachedContentFolder(queryClient, contentContext, placeholder.parentFolderKey, placeholder));
        if (!queryClient.getQueryData(contentQueryKeys.location(contentContext, destinationKeys[0]))) queryClient.setQueryData(contentQueryKeys.location(contentContext, destinationKeys[0]), { folders: placeholders, documents: [] });
      }
      const optimisticLocation = queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, first.folder?.key)) ?? { folders: [], documents: [] };
      setFolders(optimisticLocation.folders);
      setDocuments(optimisticLocation.documents);
      if (first.folder) {
        setFolderStack(first.stack);
        workspaceModeRef.current = "folder";
        setWorkspaceMode("folder");
      } else {
        setRootFolders(optimisticLocation.folders);
        setRootDocuments(optimisticLocation.documents);
        setFolderStack([]);
        workspaceModeRef.current = "folders";
        setWorkspaceMode("folders");
      }
      setRootSearchQuery("");
      setRootSearchResults(undefined);
      setQuery("");
      setResults(undefined);
      setFolderSearchResults(undefined);
      void invalidateContentLocations(queryClient, contentContext, [sourceKey, ...destinationKeys]);
      closeSheet();
      const generation = ++folderActionGeneration.current;
      const navigationRequest = navigationGeneration.current;
      const requestContextKey = contentContextKey;
      const isCurrent = () => generation === folderActionGeneration.current
        && navigationRequest === navigationGeneration.current
        && requestContextKey === contentContextKeyRef.current;
      let committed = false;
      void (async () => {
        const outcome = action === "move"
          ? await moveContentSelection({ folderKeys: [directFolder.key], documentKeys: [] }, destinationKeys[0])
          : await copyContentSelection({ folderKeys: [directFolder.key], documentKeys: [] }, destinationKeys);
        if (outcome.succeeded === 0) throw new Error(outcome.failures[0]?.message ?? `The folder could not be ${action === "move" ? "moved" : "copied"}.`);
        committed = true;
        placeholders.forEach((placeholder) => removeCachedContentFolder(queryClient, contentContext, placeholder.parentFolderKey, placeholder.key));
        if (placeholders.length && isCurrent()) {
          const placeholderKeys = new Set(placeholders.map(({ key }) => key));
          setFolders((current) => current.filter(({ key }) => !placeholderKeys.has(key)));
          setRootFolders((current) => current.filter(({ key }) => !placeholderKeys.has(key)));
        }
        if (action === "move") {
          const updated = outcome.folders[0];
          if (updated) {
            removeCachedContentFolder(queryClient, contentContext, sourceKey, directFolder.key);
            addCachedContentFolder(queryClient, contentContext, updated.parentFolderKey, updated);
            if (isCurrent()) replaceFolder(updated, false);
          }
        } else {
          outcome.copiedFolders.forEach(({ folder }) => {
            addCachedContentFolder(queryClient, contentContext, folder.parentFolderKey, folder);
            if (isCurrent() && folder.parentFolderKey === destinationKeys[0]) setFolders((current) => [...current.filter(({ key }) => key !== folder.key), folder]);
            if (isCurrent() && !folder.parentFolderKey) setRootFolders((current) => [...current.filter(({ key }) => key !== folder.key), folder]);
          });
        }
        await invalidateContentLocations(queryClient, contentContext, [sourceKey, ...destinationKeys]);
        await invalidateContentHistories(queryClient, contentContext, [sourceKey, ...destinationKeys, undefined]);
        if (isCurrent()) showToast({
          title: `${outcome.succeeded} ${outcome.succeeded === 1 ? "folder" : "folders"} ${action === "move" ? "moved" : "copied"}`,
          ...(outcome.failed ? { description: `${outcome.failed} operations failed. ${outcome.failures[0]?.message ?? "Try again."}` } : {}),
        });
      })().catch((cause: unknown) => {
        if (committed) {
          if (isCurrent()) showToast({ title: `Folder ${action === "move" ? "moved" : "copied"}`, description: "The change completed, but Archive could not refresh yet." });
          return;
        }
        if (sourceLocation) queryClient.setQueryData(contentQueryKeys.location(contentContext, sourceKey), sourceLocation);
        else queryClient.removeQueries({ queryKey: contentQueryKeys.location(contentContext, sourceKey), exact: true });
        destinationLocations.forEach((location, key) => {
          if (location) queryClient.setQueryData(contentQueryKeys.location(contentContext, key), location);
          else queryClient.removeQueries({ queryKey: contentQueryKeys.location(contentContext, key), exact: true });
        });
        if (!isCurrent()) return;
        setFolders(previousFolders);
        setDocuments(previousDocuments);
        setRootFolders(previousRootFolders);
        setRootDocuments(previousRootDocuments);
        setFolderStack(previousFolderStack);
        workspaceModeRef.current = previousWorkspaceMode;
        setWorkspaceMode(previousWorkspaceMode);
        setRootSearchQuery(previousRootSearchQuery);
        setRootSearchResults(previousRootSearchResults);
        setQuery(previousQuery);
        setResults(previousResults);
        setFolderSearchResults(previousFolderSearchResults);
        showToast({ title: `Folder ${action} failed`, description: cause instanceof Error ? cause.message : `The folder could not be ${action === "move" ? "moved" : "copied"}.` });
      });
      return;
    }
    const targetKey = destinationFolder?.key;
    const previousFolders = folders;
    const previousDocuments = documents;
    const previousRootFolders = rootFolders;
    const previousRootDocuments = rootDocuments;
    const previousFolderStack = folderStack;
    const previousWorkspaceMode = workspaceMode;
    const previousRootSearchQuery = rootSearchQuery;
    const previousRootSearchResults = rootSearchResults;
    const previousQuery = query;
    const previousResults = results;
    const previousFolderSearchResults = folderSearchResults;
    const sourceKeys = [...selectedFoldersSnapshot.map(({ parentFolderKey }) => parentFolderKey), ...selectedDocumentsSnapshot.map(({ folderKey }) => folderKey)];
    const locationSnapshots = new Map([...new Set([...sourceKeys, targetKey])].map((key) => [key, queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, key))]));
    const optimisticFolders = selectedFoldersSnapshot.map((folder, index): ContentFolder => action === "move"
      ? { ...folder, parentFolderKey: targetKey }
      : { ...folder, key: `optimistic-${createContentMutationKey()}-${index}`, parentFolderKey: targetKey, name: `${folder.name} (copying)`, isFavorite: false });
    const optimisticDocuments = selectedDocumentsSnapshot.map((document, index): ContentDocument => action === "move"
      ? { ...document, folderKey: targetKey }
      : { ...document, key: `optimistic-${createContentMutationKey()}-${index}`, folderKey: targetKey, name: `${document.name} (copying)`, isFavorite: false });
    if (action === "move") {
      selectedFoldersSnapshot.forEach((folder) => removeCachedContentFolder(queryClient, contentContext, folder.parentFolderKey, folder.key));
      selectedDocumentsSnapshot.forEach((document) => removeCachedContentDocument(queryClient, contentContext, document.folderKey, document.key));
    }
    optimisticFolders.forEach((folder) => addCachedContentFolder(queryClient, contentContext, targetKey, folder));
    optimisticDocuments.forEach((document) => addCachedContentDocument(queryClient, contentContext, targetKey, document));
    const optimisticLocation = queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, targetKey)) ?? { folders: optimisticFolders, documents: optimisticDocuments };
    setFolders(optimisticLocation.folders);
    setDocuments(optimisticLocation.documents);
    if (destinationFolder) {
      setFolderStack(destinationStack);
      workspaceModeRef.current = "folder";
      setWorkspaceMode("folder");
    } else {
      setRootFolders(optimisticLocation.folders);
      setRootDocuments(optimisticLocation.documents);
      setFolderStack([]);
      workspaceModeRef.current = "folders";
      setWorkspaceMode("folders");
    }
    setRootSearchQuery("");
    setRootSearchResults(undefined);
    setQuery("");
    setResults(undefined);
    setFolderSearchResults(undefined);
    clearSelection();
    closeSheet(true);
    const transferNavigation = navigationGeneration.current;
    const transferContextKey = contentContextKey;
    const transferIsCurrent = () => transferNavigation === navigationGeneration.current && transferContextKey === contentContextKeyRef.current;
    let transferCommitted = false;
    setBulkLoading(true);
    setSheetError(undefined);
    try {
      const { folders: operationFolders, documents: operationDocuments } = await resolveStructuralResources(selectedFoldersSnapshot, selectedDocumentsSnapshot);
      if (transferContextKey !== contentContextKeyRef.current) throw new Error("Archive context changed before the transfer could start.");
      locationSnapshots.forEach((location, key) => {
        if (location) queryClient.setQueryData(contentQueryKeys.location(contentContext, key), location);
        else queryClient.removeQueries({ queryKey: contentQueryKeys.location(contentContext, key), exact: true });
      });
      const normalizedFolders = operationFolders.map((folder, index): ContentFolder => action === "move"
        ? { ...folder, parentFolderKey: targetKey }
        : { ...folder, key: `optimistic-${createContentMutationKey()}-${index}`, parentFolderKey: targetKey, name: `${folder.name} (copying)`, isFavorite: false });
      const normalizedDocuments = operationDocuments.map((document, index): ContentDocument => action === "move"
        ? { ...document, folderKey: targetKey }
        : { ...document, key: `optimistic-${createContentMutationKey()}-${index}`, folderKey: targetKey, name: `${document.name} (copying)`, isFavorite: false });
      if (action === "move") {
        operationFolders.forEach((folder) => removeCachedContentFolder(queryClient, contentContext, folder.parentFolderKey, folder.key));
        operationDocuments.forEach((document) => removeCachedContentDocument(queryClient, contentContext, document.folderKey, document.key));
      }
      normalizedFolders.forEach((folder) => addCachedContentFolder(queryClient, contentContext, targetKey, folder));
      normalizedDocuments.forEach((document) => addCachedContentDocument(queryClient, contentContext, targetKey, document));
      if (transferIsCurrent()) {
        const normalizedLocation = queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, targetKey));
        if (normalizedLocation) {
          setFolders(normalizedLocation.folders);
          setDocuments(normalizedLocation.documents);
          if (!targetKey) {
            setRootFolders(normalizedLocation.folders);
            setRootDocuments(normalizedLocation.documents);
          }
        }
      }
      const sourceFolderKeys = [...operationFolders.map(({ parentFolderKey }) => parentFolderKey), ...operationDocuments.map(({ folderKey }) => folderKey)];
      const operationSelection: ContentSelection = { folderKeys: operationFolders.map(({ key }) => key), documentKeys: operationDocuments.map(({ key }) => key) };
      const outcome = action === "move"
        ? await moveContentSelection(operationSelection, destinationKeys[0])
        : await copyContentSelection(operationSelection, destinationKeys);
      if (outcome.succeeded === 0) throw new Error(outcome.failures[0]?.message ?? `The items could not be ${action === "move" ? "moved" : "copied"}.`);
      transferCommitted = true;
      if (action === "move") {
        replaceCachedContentFolders(queryClient, contentContext, outcome.folders);
        replaceCachedContentDocuments(queryClient, contentContext, outcome.documents);
        outcome.documents.forEach((document) => replaceCachedContentDocumentDetail(queryClient, contentContext, document));
      } else {
        normalizedFolders.forEach((folder) => removeCachedContentFolder(queryClient, contentContext, targetKey, folder.key));
        normalizedDocuments.forEach((document) => removeCachedContentDocument(queryClient, contentContext, targetKey, document.key));
        outcome.copiedFolders.forEach(({ folder }) => addCachedContentFolder(queryClient, contentContext, folder.parentFolderKey, folder));
        outcome.documents.forEach((document) => addCachedContentDocument(queryClient, contentContext, document.folderKey, document));
        if (transferIsCurrent()) {
          const reconciled = queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, targetKey));
          if (reconciled) {
            setFolders(reconciled.folders);
            setDocuments(reconciled.documents);
            if (!targetKey) {
              setRootFolders(reconciled.folders);
              setRootDocuments(reconciled.documents);
            }
          }
        }
      }
      await invalidateContentLocations(queryClient, contentContext, [...sourceFolderKeys, ...destinationKeys]);
      await invalidateContentHistories(queryClient, contentContext, [...sourceFolderKeys, ...destinationKeys, undefined]);
      const location = await getContentLocation(queryClient, contentContext, first.folder?.key);
      if (transferIsCurrent()) {
        setFolders(location.folders);
        setDocuments(location.documents);
        if (!first.folder) {
          setRootFolders(location.folders);
          setRootDocuments(location.documents);
        }
        setRootSearchQuery("");
        setRootSearchResults(undefined);
        setQuery("");
        setResults(undefined);
        setFolderSearchResults(undefined);
      }
      const resourceNames = new Map<string, string>([...operationFolders, ...operationDocuments].map((item) => [item.key, item.name]));
      const destinationNames = new Map(choices.map((choice) => [choice.folder?.key, choice.folder?.name ?? "Archive"]));
      const copyFailureDetails = action === "copy" && outcome.failed
        ? [...new Set(outcome.failures.map((failure) => `${resourceNames.get(failure.key) ?? failure.key} to ${destinationNames.get(failure.destinationFolderKey) ?? "Archive"}`))].join(", ")
        : undefined;
      if (transferIsCurrent()) showToast({
        title: `${outcome.succeeded} ${outcome.succeeded === 1 ? "item" : "items"} ${action === "move" ? "moved" : "copied"}`,
        ...(outcome.failed ? { description: `${outcome.failed} of ${outcome.requested} operations failed${copyFailureDetails ? `: ${copyFailureDetails}` : ""}. ${outcome.failures[0]?.message ?? "Try those items again."}` } : {}),
      });
    } catch (cause) {
      if (transferCommitted) {
        if (transferIsCurrent()) showToast({ title: `${action === "move" ? "Move" : "Copy"} completed`, description: "The change completed, but Archive could not refresh yet." });
        return;
      }
      locationSnapshots.forEach((location, key) => {
        if (location) queryClient.setQueryData(contentQueryKeys.location(contentContext, key), location);
        else queryClient.removeQueries({ queryKey: contentQueryKeys.location(contentContext, key), exact: true });
      });
      if (transferIsCurrent()) {
        setFolders(previousFolders);
        setDocuments(previousDocuments);
        setRootFolders(previousRootFolders);
        setRootDocuments(previousRootDocuments);
        setFolderStack(previousFolderStack);
        workspaceModeRef.current = previousWorkspaceMode;
        setWorkspaceMode(previousWorkspaceMode);
        setRootSearchQuery(previousRootSearchQuery);
        setRootSearchResults(previousRootSearchResults);
        setQuery(previousQuery);
        setResults(previousResults);
        setFolderSearchResults(previousFolderSearchResults);
        showToast({ title: `${action === "move" ? "Move" : "Copy"} failed`, description: cause instanceof Error ? cause.message : `The items could not be ${action === "move" ? "moved" : "copied"}.` });
      }
    } finally {
      setBulkLoading(false);
    }
  };

  const updateSelectionFavorite = async () => {
    const nextFavorite = !allSelectedFavorite;
    setBulkLoading(true);
    setSheetError(undefined);
    try {
      const outcome = await setContentSelectionFavorite(contentSelection, nextFavorite);
      if (outcome.folders.length) {
        replaceCachedContentFolders(queryClient, contentContext, outcome.folders);
        outcome.folders.forEach((folder) => replaceFolder(folder, false));
      }
      if (outcome.documents.length) {
        replaceCachedContentDocuments(queryClient, contentContext, outcome.documents);
        outcome.documents.forEach((document) => replaceDocument(document, false));
      }
      await invalidateContentLocations(queryClient, contentContext, [...selectedFolders.map(({ parentFolderKey }) => parentFolderKey), ...selectedDocuments.map(({ folderKey }) => folderKey)]);
      const failedFolderKeys = new Set(outcome.failures.filter(({ kind }) => kind === "folder").map(({ key }) => key));
      const failedDocumentKeys = new Set(outcome.failures.filter(({ kind }) => kind === "document").map(({ key }) => key));
      setSelectedFolders((current) => current.filter(({ key }) => failedFolderKeys.has(key)));
      setSelectedDocuments((current) => current.filter(({ key }) => failedDocumentKeys.has(key)));
      if (outcome.succeeded) {
        closeSheet(outcome.failed > 0);
      }
      showToast({
        title: outcome.succeeded ? `${outcome.succeeded} ${outcome.succeeded === 1 ? "item" : "items"} ${nextFavorite ? "favorited" : "unfavorited"}` : "Favorites could not be updated",
        ...(outcome.failed ? { description: `${outcome.failed} ${outcome.failed === 1 ? "item" : "items"} failed. ${outcome.failures[0]?.message ?? "Try again."}` } : {}),
      });
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "Favorites could not be updated.");
    } finally {
      setBulkLoading(false);
    }
  };

  const deleteContentSelection = async () => {
    const selectedFoldersSnapshot = [...selectedFolders];
    const selectedDocumentsSnapshot = [...selectedDocuments];
    const directFolder = temporarySingleSelection && selectedFoldersSnapshot.length === 1 && selectedDocumentsSnapshot.length === 0
      ? selectedFoldersSnapshot[0]
      : undefined;
    if (directFolder) {
      const previousFolders = folders;
      const previousDocuments = documents;
      const previousRootFolders = rootFolders;
      const previousRootDocuments = rootDocuments;
      const previousFolderStack = folderStack;
      const previousWorkspaceMode = workspaceMode;
      const previousRootSearchResults = rootSearchResults;
      const previousFolderSearchResults = folderSearchResults;
      const parentKey = directFolder.parentFolderKey;
      const parentLocation = queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, parentKey));
      removeCachedContentFolder(queryClient, contentContext, parentKey, directFolder.key);
      setFolders((current) => current.filter(({ key }) => key !== directFolder.key));
      setRootFolders((current) => current.filter(({ key }) => key !== directFolder.key));
      setRootSearchResults((current) => current ? { ...current, folders: current.folders.filter(({ key }) => key !== directFolder.key) } : current);
      setFolderSearchResults((current) => current ? { ...current, folders: current.folders.filter(({ key }) => key !== directFolder.key) } : current);
      if (currentFolder?.key === directFolder.key) {
        const parentStack = folderStack.slice(0, -1);
        const nextLocation = parentLocation ?? { folders: [], documents: [] };
        setFolders(nextLocation.folders.filter(({ key }) => key !== directFolder.key));
        setDocuments(nextLocation.documents);
        setFolderStack(parentStack);
        if (parentKey) {
          workspaceModeRef.current = "folder";
          setWorkspaceMode("folder");
        } else {
          setRootFolders(nextLocation.folders.filter(({ key }) => key !== directFolder.key));
          setRootDocuments(nextLocation.documents);
          workspaceModeRef.current = "folders";
          setWorkspaceMode("folders");
        }
      }
      void invalidateContentLocations(queryClient, contentContext, [parentKey]);
      closeSheet();
      const generation = ++folderActionGeneration.current;
      const navigationRequest = navigationGeneration.current;
      const requestContextKey = contentContextKey;
      const isCurrent = () => generation === folderActionGeneration.current
        && navigationRequest === navigationGeneration.current
        && requestContextKey === contentContextKeyRef.current;
      if (currentFolder?.key === directFolder.key && !parentLocation) {
        void getContentLocation(queryClient, contentContext, parentKey).then((location) => {
          if (!isCurrent()) return;
          setFolders(location.folders.filter(({ key }) => key !== directFolder.key));
          setDocuments(location.documents);
          if (!parentKey) {
            setRootFolders(location.folders.filter(({ key }) => key !== directFolder.key));
            setRootDocuments(location.documents);
          }
        }).catch(() => undefined);
      }
      let committed = false;
      void archiveContentSelection({ folderKeys: [directFolder.key], documentKeys: [] }).then(async (outcome) => {
        if (outcome.succeeded === 0) throw new Error(outcome.failures[0]?.message ?? "The folder could not be deleted.");
        committed = true;
        removeCachedContentFoldersEverywhere(queryClient, contentContext, [directFolder.key]);
        await invalidateContentLocations(queryClient, contentContext, [parentKey]);
        await invalidateContentHistories(queryClient, contentContext, [parentKey, undefined]);
        showToast({ title: "Folder deleted", description: "Moved to Archive trash." });
      }).catch((cause: unknown) => {
        if (committed) {
          if (isCurrent()) showToast({ title: "Folder deleted", description: "The change completed, but Archive could not refresh yet." });
          return;
        }
        if (!isCurrent()) return;
        addCachedContentFolder(queryClient, contentContext, parentKey, directFolder);
        setFolders(previousFolders);
        setDocuments(previousDocuments);
        setRootFolders(previousRootFolders);
        setRootDocuments(previousRootDocuments);
        setFolderStack(previousFolderStack);
        workspaceModeRef.current = previousWorkspaceMode;
        setWorkspaceMode(previousWorkspaceMode);
        setRootSearchResults(previousRootSearchResults);
        setFolderSearchResults(previousFolderSearchResults);
        showToast({ title: "Folder deletion failed", description: cause instanceof Error ? cause.message : "The folder could not be deleted." });
      });
      return;
    }
    setBulkLoading(true);
    setSheetError(undefined);
    try {
      const { folders: operationFolders, documents: operationDocuments } = await resolveStructuralResources(selectedFoldersSnapshot, selectedDocumentsSnapshot);
      const operationSelection: ContentSelection = { folderKeys: operationFolders.map(({ key }) => key), documentKeys: operationDocuments.map(({ key }) => key) };
      setSelectedFolders(operationFolders);
      setSelectedDocuments(operationDocuments);
      const outcome = await archiveContentSelection(operationSelection);
      const failedFolders = new Set(outcome.failures.filter(({ kind }) => kind === "folder").map(({ key }) => key));
      const failedDocuments = new Set(outcome.failures.filter(({ kind }) => kind === "document").map(({ key }) => key));
      const archivedFolderKeys = operationFolders.map(({ key }) => key).filter((key) => !failedFolders.has(key));
      const archivedDocumentKeys = operationDocuments.map(({ key }) => key).filter((key) => !failedDocuments.has(key));
      removeCachedContentFoldersEverywhere(queryClient, contentContext, archivedFolderKeys);
      removeCachedContentDocumentsEverywhere(queryClient, contentContext, archivedDocumentKeys);
      setFolders((current) => current.filter(({ key }) => !archivedFolderKeys.includes(key)));
      setRootFolders((current) => current.filter(({ key }) => !archivedFolderKeys.includes(key)));
      setDocuments((current) => current.filter(({ key }) => !archivedDocumentKeys.includes(key)));
      setRootDocuments((current) => current.filter(({ key }) => !archivedDocumentKeys.includes(key)));
      await queryClient.invalidateQueries({ queryKey: contentQueryKeys.locations(contentContext), refetchType: "none" });
      await invalidateContentHistories(queryClient, contentContext, [currentFolder?.key, undefined]);
      setSelectedFolders(operationFolders.filter(({ key }) => failedFolders.has(key)));
      setSelectedDocuments(operationDocuments.filter(({ key }) => failedDocuments.has(key)));
      if (outcome.succeeded) {
        closeSheet(outcome.failed > 0);
      }
      showToast({
        title: outcome.succeeded ? `${outcome.succeeded} ${outcome.succeeded === 1 ? "item" : "items"} deleted` : "Items could not be deleted",
        description: outcome.failed ? `${outcome.failed} ${outcome.failed === 1 ? "item" : "items"} failed. ${outcome.failures[0]?.message ?? "Try again."}` : "Moved to Archive trash.",
      });
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The selected items could not be deleted.");
    } finally {
      setBulkLoading(false);
    }
  };

  const toggleFavorite = async () => {
    if (!selectedDocument) return;
    const previous = selectedDocument;
    const optimistic = { ...previous, isFavorite: !previous.isFavorite };
    replaceDocument(optimistic);
    closeSheet();
    const generation = ++documentActionGeneration.current;
    try {
      const updated = await trackActiveDocumentMutation(previous.key, setContentDocumentFavorite(previous.key, optimistic.isFavorite), (result) => {
        if (result.key === documentKeyRef.current) updatedAtRef.current = result.updatedAt;
      });
      if (generation !== documentActionGeneration.current) return;
      replaceDocument(updated);
      void invalidateContentLocations(queryClient, contentContext, [updated.folderKey]);
    } catch (cause) {
      if (generation !== documentActionGeneration.current) return;
      replaceDocument(previous);
      showToast({ title: "Favorite update failed", description: cause instanceof Error ? cause.message : "The favorite could not be updated." });
    }
  };

  const confirmSelectedFolderDelete = () => {
    if (!selectedFolder) return;
    beginSingleSelection(selectedFolder, "folder");
    setTemporarySingleSelection(true);
    pushSheet("bulkDelete");
  };

  const downloadOriginal = async () => {
    if (!selectedDocument) return;
    const generation = ++documentActionGeneration.current;
    setDocumentActionLoading("download");
    setSheetError(undefined);
    try {
      const download = await downloadContentDocument(selectedDocument.key, selectedDocument.extension ? "original" : "txt");
      const location = await saveBase64Download(download.fileName, download.mimeType, download.content);
      if (generation === documentActionGeneration.current && activeSheetRef.current === "documentActions") {
        setDocumentActionLoading(undefined);
        closeSheet();
        showToast({ title: selectedDocument.extension ? "File downloaded" : "Document downloaded", description: `Saved to ${location}` });
      }
    } catch (cause) {
      if (generation === documentActionGeneration.current) setSheetError(cause instanceof Error ? cause.message : "The original file could not be downloaded.");
    } finally {
      if (generation === documentActionGeneration.current) setDocumentActionLoading(undefined);
    }
  };

  const openScanSources = async (document = selectedDocument) => {
    if (!document?.sourceImageCount) return;
    setSelectedDocument(document);
    setSourceImages([]);
    setSourceImagesLoading(true);
    setSheetError(undefined);
    if (sheetOpen) pushSheet("scanSources");
    else openSheet("scanSources");
    try {
      setSourceImages(await readContentDocumentSources(document.key));
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The scanned pages could not be opened.");
    } finally {
      setSourceImagesLoading(false);
    }
  };

  const deleteSelectedDocument = async () => {
    if (!selectedDocument) return;
    const target = selectedDocument;
    setDocumentActionLoading("delete");
    setSheetError(undefined);
    try {
      await archiveContentDocument(target.key);
      removeCachedContentDocumentEverywhere(queryClient, contentContext, target.key);
      setDocuments((current) => current.filter(({ key }) => key !== target.key));
      setRootDocuments((current) => current.filter(({ key }) => key !== target.key));
      closeSheet();
      if (target.key === documentKeyRef.current) {
        resetEditor();
        workspaceModeRef.current = currentFolder ? "folder" : "folders";
        setWorkspaceMode(workspaceModeRef.current);
      } else if (workspaceModeRef.current === "viewer" && selectedDocument?.key === target.key) {
        leaveFileViewer();
      }
      setSelectedDocument(undefined);
      void invalidateContentLocations(queryClient, contentContext, [target.folderKey]);
      void invalidateContentHistories(queryClient, contentContext, [target.folderKey, undefined]);
      showToast({ title: target.extension ? "File deleted" : "Document deleted", description: "Moved to Archive trash." });
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The item could not be deleted.");
    } finally {
      setDocumentActionLoading(undefined);
    }
  };

  const submitRename = async () => {
    const name = renameName.trim();
    if (!selectedDocument || !name) return;
    const previous = selectedDocument;
    const optimistic = { ...previous, name };
    const editorTitleAtStart = titleRef.current;
    replaceDocument(optimistic);
    if (previous.key === documentKeyRef.current && titleRef.current === editorTitleAtStart) {
      titleRef.current = name;
      savedTitleRef.current = name;
      setTitle(name);
    }
    closeSheet();
    const generation = ++documentActionGeneration.current;
    try {
      const updated = await trackActiveDocumentMutation(previous.key, renameContentDocument(previous.key, name), (result) => {
        if (result.key === documentKeyRef.current) updatedAtRef.current = result.updatedAt;
      });
      if (generation !== documentActionGeneration.current) return;
      replaceDocument(updated);
      if (updated.key === documentKeyRef.current) {
        if (titleRef.current === name) {
          titleRef.current = updated.name;
          savedTitleRef.current = updated.name;
          setTitle(updated.name);
        }
      }
      void invalidateContentLocations(queryClient, contentContext, [updated.folderKey]);
    } catch (cause) {
      if (generation !== documentActionGeneration.current) return;
      replaceDocument(previous);
      if (previous.key === documentKeyRef.current && titleRef.current === name) {
        titleRef.current = editorTitleAtStart;
        savedTitleRef.current = editorTitleAtStart;
        setTitle(editorTitleAtStart);
      }
      showToast({ title: "Rename failed", description: cause instanceof Error ? cause.message : "The document could not be renamed." });
    }
  };

  const finishEditing = () => {
    Keyboard.dismiss();
    setEditorFocused(false);
    if (dirty.current) {
      saveImmediately.current = true;
      setSaveRetry((current) => current + 1);
    }
    setEditorEditing(false);
  };

  function mutationFooter() {
    const close = (disabled: boolean) => <Button disabled={disabled} onPress={() => closeSheet()} size="lg" variant="secondary">Close</Button>;
    if (activeSheet === "audioVersions") return <>
      <Button disabled={generatingAudioVersion || loadingAudioVersions} loading={generatingAudioVersion} onPress={() => void generateAudioVersion()} size="lg" variant="primary">Generate audio</Button>
      {close(generatingAudioVersion)}
    </>;
    if (activeSheet === "folderDetails") return <>
      <Button disabled={!folderDetailsName.trim()} onPress={() => void submitFolderDetails()} size="lg" variant="primary">Save</Button>
    </>;
    if (activeSheet === "rename") return <>
      <Button disabled={!renameName.trim()} onPress={() => void submitRename()} size="lg" variant="primary">Rename</Button>
      {close(false)}
    </>;
    if (activeSheet === "deleteDocument") return <>
      <Button disabled={Boolean(documentActionLoading)} loading={documentActionLoading === "delete"} onPress={() => void deleteSelectedDocument()} size="lg" variant="danger">Delete</Button>
      {close(Boolean(documentActionLoading))}
    </>;
    if (activeSheet === "bulkDelete") return <>
      {singleFolderDelete ? null : <><Button disabled={bulkLoading} loading={bulkLoading} onPress={() => void deleteContentSelection()} size="lg" variant="primary">Delete</Button>{close(bulkLoading)}</>}
    </>;
    if (activeSheet === "destinationBrowser") return <>
      {destinationAction !== "upload" && (destinationAtSource || destinationIsSelectedFolder) ? null : <Button disabled={destinationTransferDisabled} onPress={() => { if (destinationAction === "upload") goBackSheet(); else void selectDestination(); }} size="lg" style={destinationTransferDisabled ? styles.disabledPrimaryAction : undefined} variant="primary">{destinationAction === "upload" ? "Choose folder" : destinationAction === "move" ? "Move here" : "Copy here"}</Button>}
      {close(bulkLoading)}
    </>;
    if (activeSheet === "destination" && destinationAction === "upload") return <>
      <Button disabled={destinationLoading} loading={destinationLoading} onPress={() => void selectDestination()} size="lg" variant="primary">Choose files for this folder</Button>
      {close(destinationLoading)}
    </>;
    if (activeSheet === "folder") return <>
      <Button disabled={!folderName.trim()} onPress={() => void submitFolder()} size="lg" variant="primary">Create folder</Button>
      {close(false)}
    </>;
    return null;
  }

  const controlSelectedAudioVersion = () => {
    if (narrationStateRef.current === "playing") {
      toggleNarration();
      return;
    }
    const version = audioVersions.find((item) => item.key === selectedAudioVersionKey);
    if (version) void playAudioVersion(version, narrationStateRef.current === "ready" ? 0 : narrationElapsed);
    else toggleNarration();
  };

  const scrubSelectedAudioVersion = (seconds: number) => {
    const version = audioVersions.find((item) => item.key === selectedAudioVersionKey);
    if (!version) {
      seekNarration(seconds);
      return;
    }
    const wasPlaying = narrationStateRef.current === "playing";
    if (wasPlaying) {
      narrationPlayer.pause();
      updateNarrationState("paused");
    }
    void playAudioVersion(version, seconds, wasPlaying);
  };

  const narrationAccessory = narrationState !== "idle" ? (
    <View style={styles.narrationPlayer}>
      <View style={styles.narrationHeading}>
        <View style={styles.narrationTitleBlock}>
          <Text numberOfLines={1} style={styles.narrationTitle}>{narrationTitle || "Document audio"}</Text>
          <Text style={styles.narrationStatus}>AUDIO VERSION</Text>
        </View>
        <Button accessibilityLabel="Close audio player" contentMode="raw" onPress={stopNarration} size="xs" variant="icon"><CloseIcon size="sm" /></Button>
      </View>
      <View style={styles.narrationControls}>
        <Button accessibilityLabel={narrationState === "playing" ? "Pause listening" : "Play audio"} contentMode="raw" disabled={narrationManifest.length === 0} loading={narrationManifest.length === 0 && narrationState !== "error"} onPress={controlSelectedAudioVersion} size="sm" variant="icon">{narrationState === "playing" ? <PauseIcon size="sm" /> : <PlayIcon size="sm" />}</Button>
        <Text style={styles.narrationTime}>{formatAudioTime(narrationElapsed)}</Text>
        <Slider accessibilityLabel="Audio progress" disabled={narrationDuration <= 0} max={Math.max(1, narrationDuration)} onSlidingComplete={(value) => { setNarrationScrubValue(undefined); scrubSelectedAudioVersion(value); }} onValueChange={setNarrationScrubValue} style={styles.narrationSlider} value={Math.min(narrationElapsed, narrationDuration)} />
        <Text style={styles.narrationTime}>{formatAudioTime(narrationDuration)}</Text>
      </View>
      {narrationError ? <Text accessibilityRole="alert" numberOfLines={2} style={styles.narrationError}>{narrationError}</Text> : null}
    </View>
  ) : undefined;
  const selectedAudioVersionIndex = audioVersions.findIndex((version) => version.key === selectedAudioVersionKey);
  const selectedAudioVersion = selectedAudioVersionIndex >= 0 ? audioVersions[selectedAudioVersionIndex] : undefined;
  const bulkToolbar = selectionActive ? <View style={styles.bulkToolbar}>
    <Button accessibilityLabel="Clear selection" contentMode="raw" onPress={clearSelection} size="xs" style={styles.bulkToolbarAction} variant="ghost"><CloseIcon size="sm" /><Text style={styles.bulkSelectionText}>{selectedCount} selected</Text></Button>
    <Button accessibilityLabel="Selected item actions" contentMode="raw" disabled={selectionMetadataLoading} loading={selectionMetadataLoading} onPress={() => openSheet("bulkActions")} size="xs" style={styles.bulkToolbarIcon} variant="icon"><MoreHorizontalIcon size="sm" /></Button>
  </View> : null;

  return (
    <KeyboardAvoidingView behavior={aiInputFocused ? "height" : undefined} style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <WorkspaceAppSwitcher active="archive" />
      </View>
      {workspaceMode === "viewer" ? <FileViewer
        error={filePreviewError}
        blocks={filePreview?.blocks}
        loading={Boolean(!filePreviewError && (!filePreview || filePreview.extension === "pdf" && !filePreviewUri))}
        onBack={leaveFileViewer}
        onHistory={selectedDocument ? () => openHistoryChooser(selectedDocument) : undefined}
        onMenu={() => { if (selectedDocument) showDocumentActions(selectedDocument); }}
        onRenderError={setFilePreviewError}
        pdfUri={filePreviewUri}
        title={selectedDocument?.name ?? "File"}
      /> : <>
      <ScrollView
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        contentContainerStyle={[styles.scroll, workspaceMode === "editor" && styles.editorScroll, { paddingBottom: workspaceMode === "editor"
          ? aiInputFocused && keyboardVisible ? 72 : insets.bottom + 78 + spacing.md
          : insets.bottom + 112 }]}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={workspaceMode !== "editor"}
        style={styles.scrollView}
      >
        {workspaceMode === "auto" || workspaceMode === "folders" ? (
          <View style={styles.archiveRoot}>
            {error ? <Text accessibilityRole="alert" style={styles.notice}>{error}</Text> : null}
            <View style={styles.rootActions}>
              <View style={styles.rootSearch}>
                <SearchIcon size="sm" variant="muted" />
                <TextInput accessibilityLabel="Search all Archive folders, documents, and files" onChangeText={setRootSearchQuery} placeholder="Search..." style={styles.rootSearchInput} value={rootSearchQuery} />
                {rootSearchQuery.trim() ? <Button accessibilityLabel="Clear Archive search" contentMode="raw" onPress={() => setRootSearchQuery("")} size="xs" variant="icon"><CloseIcon size="sm" /></Button> : null}
              </View>
              <Button accessibilityLabel="Create in Archive" contentMode="raw" disabled={locationLoading} onPress={() => openSheet("create")} size="md" style={styles.rootCreateButton} variant="icon"><PlusIcon size="sm" /></Button>
            </View>
            {bulkToolbar}
            <View style={styles.rootContent}>
              <Tabs accessibilityRole="tablist" style={styles.folderTabs}>
                <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "folders" }} onPress={() => setFolderContentTab("folders")} size="xs" style={styles.folderTab} variant={folderContentTab === "folders" ? "secondary" : "ghost"}>Folders</Button>
                <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "documents" }} onPress={() => setFolderContentTab("documents")} size="xs" style={styles.folderTab} variant={folderContentTab === "documents" ? "secondary" : "ghost"}>Documents</Button>
                <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "files" }} onPress={() => setFolderContentTab("files")} size="xs" style={styles.folderTab} variant={folderContentTab === "files" ? "secondary" : "ghost"}>Files</Button>
              </Tabs>
              {rootSearchQuery.trim() ? rootSearching || !rootSearchResults ? <View accessibilityLabel="Loading search results" accessibilityRole="progressbar" style={styles.rootDocuments}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={[styles.documentSkeleton, styles.skeletonCard]} />)}</View> : folderContentTab === "folders" ? <View accessibilityLiveRegion="polite" style={styles.rootFolderGrid}>
                {rootSearchFolders.map((folder) => { const selected = selectedFolders.some(({ key }) => key === folder.key); return <View key={folder.key} style={[styles.rootFolderCard, selected && styles.selectedItem, { width: archiveCardSize, height: archiveCardSize }]}><Button accessibilityState={{ selected }} contentMode="raw" onLongPress={() => handleFolderLongPress(folder)} onPress={() => handleFolderPress(folder)} size="xl" style={styles.rootFolderMain} variant="ghost"><FolderIcon size="lg" /><Text numberOfLines={1} style={styles.archiveCardLabel}>{folder.name}</Text></Button></View>; })}
                {rootSearchFolders.length === 0 ? <Text style={styles.empty}>No folders matched this search.</Text> : null}
              </View> : <View accessibilityLiveRegion="polite" style={styles.rootDocuments}>
                {rootSearchDocuments.map((document) => { const selected = selectedDocuments.some(({ key }) => key === document.documentKey); return <Button accessibilityState={{ selected }} contentMode="raw" key={document.documentKey} onLongPress={() => handleSearchDocumentLongPress(document)} onPress={() => handleSearchDocumentPress(document)} size="sm" style={[styles.documentButton, selected && styles.selectedItem]} variant="secondary"><FileIcon size="sm" /><Text numberOfLines={1} style={styles.documentButtonLabel}>{document.name}</Text></Button>; })}
                {rootSearchDocuments.length === 0 ? <Text style={styles.empty}>No {folderContentTab === "files" ? "files" : "documents"} matched this search.</Text> : null}
              </View> : archiveLocationLoading ? folderContentTab === "folders" ? <View accessibilityLabel="Loading folders" accessibilityRole="progressbar" style={[styles.rootFolderGrid, styles.loadingGrid]}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={[styles.rootFolderCard, styles.skeletonCard, { width: archiveCardSize, height: archiveCardSize }]} />)}</View> : <View accessibilityLabel={`Loading ${folderContentTab}`} accessibilityRole="progressbar" style={styles.rootDocuments}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={[styles.documentSkeleton, styles.skeletonCard]} />)}</View> : folderContentTab === "folders" ? (
                <View style={styles.rootFolderGrid}>
                  {rootFolders.length ? rootFolders.map((folder) => {
                    const selected = selectedFolders.some(({ key }) => key === folder.key);
                    return <View key={folder.key} style={[styles.rootFolderCard, selected && styles.selectedItem, folder.key.startsWith("optimistic-") && styles.optimisticCard, { width: archiveCardSize, height: archiveCardSize }]}>
                      {folder.coverUrl ? <Image contentFit="cover" source={folder.coverUrl} style={styles.folderCover} /> : null}
                      <Button accessibilityState={{ selected }} contentMode="raw" disabled={folder.key.startsWith("optimistic-")} onLongPress={() => handleFolderLongPress(folder)} onPress={() => handleFolderPress(folder)} size="xl" style={[styles.rootFolderMain, folder.coverUrl && styles.coveredFolderMain]} variant="ghost">{folder.coverUrl ? null : <FolderIcon size="lg" />}<Text numberOfLines={1} style={[styles.archiveCardLabel, folder.coverUrl && styles.coveredFolderLabel]}>{folder.name}</Text></Button>
                    </View>;
                  }) : !error ? <View style={styles.folderEmptyState}><Text style={styles.empty}>No folders here yet.</Text><Button accessibilityLabel="Create folder" contentMode="raw" onPress={openNewFolder} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button></View> : null}
                </View>
              ) : (
                <View style={styles.rootDocuments}>
                  {rootTabDocuments.length ? rootTabDocuments.map((document) => (
                    <Button accessibilityState={{ selected: selectedDocuments.some(({ key }) => key === document.key) }} contentMode="raw" key={document.key} onLongPress={() => handleDocumentLongPress(document)} onPress={() => handleDocumentPress(document)} size="sm" style={[styles.documentButton, selectedDocuments.some(({ key }) => key === document.key) && styles.selectedItem]} variant="secondary">
                      <FileIcon size="sm" />
                      <Text numberOfLines={1} style={styles.documentButtonLabel}>{document.name}</Text>
                      <ScannedBadge document={document} />
                    </Button>
                  )) : visibleUploadBatch.length === 0 && !error ? <View style={styles.folderEmptyState}><Text style={styles.empty}>{folderContentTab === "files" ? "No files here yet." : "No documents here yet."}</Text><Button accessibilityLabel={folderContentTab === "files" ? "Upload files" : "Create document"} contentMode="raw" onPress={() => { if (folderContentTab === "files") void openDestinationPicker("upload"); else startNewNote(); }} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button></View> : null}
                  {folderContentTab === "files" ? visibleUploadBatch.map((item) => <View accessibilityLabel={`Uploading ${item.name}`} accessibilityRole="progressbar" key={item.id} style={[styles.documentSkeleton, styles.skeletonCard]} />) : null}
                </View>
              )}
            </View>
          </View>
        ) : workspaceMode === "folder" ? (
          <View style={styles.archiveFolder}>
            <View style={styles.folderTitleRow}>
              <Button accessibilityLabel={selectionActive ? "Clear selection" : `Back to ${folderStack.at(-2)?.name ?? "folders"}`} contentMode="raw" onPress={() => { if (selectionActive) clearSelection(); else void goBackFolder(); }} size="xs" variant="icon">{selectionActive ? <CloseIcon size="sm" /> : <ChevronLeftIcon size="sm" />}</Button>
              <Text numberOfLines={1} style={styles.folderTitle}>{currentFolder?.name ?? "Archive"}</Text>
              <View style={styles.folderTitleActions}>
                {currentFolder ? <Button accessibilityLabel={`Manage ${currentFolder.name}`} contentMode="raw" onPress={() => showFolderActions(currentFolder)} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button> : null}
                <Button accessibilityLabel={`Create in ${currentFolder?.name ?? "Archive"}`} contentMode="raw" onPress={() => openSheet("create")} size="xs" variant="icon"><PlusIcon size="sm" /></Button>
              </View>
            </View>
            {error ? <Text accessibilityRole="alert" style={styles.notice}>{error}</Text> : null}
            <View style={[styles.rootSearch, styles.folderScopedSearch]}>
              <SearchIcon size="sm" variant="muted" />
              <TextInput accessibilityLabel={`Search ${currentFolder?.name ?? "folder"}`} onChangeText={setQuery} placeholder="Search..." style={styles.rootSearchInput} value={query} />
              {query.trim() ? <Button accessibilityLabel="Clear folder search" contentMode="raw" onPress={() => setQuery("")} size="xs" variant="icon"><CloseIcon size="sm" /></Button> : null}
            </View>
            {bulkToolbar}
            <Tabs accessibilityRole="tablist" style={styles.folderTabs}>
              <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "folders" }} onPress={() => setFolderContentTab("folders")} size="xs" style={styles.folderTab} variant={folderContentTab === "folders" ? "secondary" : "ghost"}>Folders</Button>
              <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "documents" }} onPress={() => setFolderContentTab("documents")} size="xs" style={styles.folderTab} variant={folderContentTab === "documents" ? "secondary" : "ghost"}>Documents</Button>
              <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "files" }} onPress={() => setFolderContentTab("files")} size="xs" style={styles.folderTab} variant={folderContentTab === "files" ? "secondary" : "ghost"}>Files</Button>
            </Tabs>
            {query.trim() ? folderSearching || !folderSearchResults ? <View accessibilityLabel="Loading search results" accessibilityRole="progressbar" style={[styles.folderDocuments, styles.folderTabContent]}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={[styles.documentSkeleton, styles.skeletonCard]} />)}</View> : folderContentTab === "folders" ? (
              <View accessibilityLiveRegion="polite" style={[styles.rootFolderGrid, styles.folderTabContent]}>
                {folderSearchFolders.map((folder) => { const selected = selectedFolders.some(({ key }) => key === folder.key); return <View key={folder.key} style={[styles.rootFolderCard, selected && styles.selectedItem, { width: archiveCardSize, height: archiveCardSize }]}>
                  {folder.coverUrl ? <Image contentFit="cover" source={folder.coverUrl} style={styles.folderCover} /> : null}
                  <Button accessibilityState={{ selected }} contentMode="raw" onLongPress={() => handleFolderLongPress(folder)} onPress={() => handleFolderPress(folder)} size="xl" style={[styles.rootFolderMain, folder.coverUrl && styles.coveredFolderMain]} variant="ghost">{folder.coverUrl ? null : <FolderIcon size="lg" />}<Text numberOfLines={1} style={[styles.archiveCardLabel, folder.coverUrl && styles.coveredFolderLabel]}>{folder.name}</Text></Button>
                </View>; })}
                {folderSearchFolders.length === 0 ? <Text style={styles.empty}>No folders matched this search.</Text> : null}
              </View>
            ) : <View accessibilityLiveRegion="polite" style={[styles.folderDocuments, styles.folderTabContent]}>
              {folderSearchDocuments.map((document) => { const selected = selectedDocuments.some(({ key }) => key === document.documentKey); return <Button accessibilityState={{ selected }} contentMode="raw" key={document.documentKey} onLongPress={() => handleSearchDocumentLongPress(document)} onPress={() => handleSearchDocumentPress(document)} size="sm" style={[styles.documentButton, selected && styles.selectedItem]} variant="secondary">
                <FileIcon size="sm" />
                <Text numberOfLines={1} style={styles.documentButtonLabel}>{document.name}</Text>
              </Button>; })}
              {folderSearchDocuments.length === 0 ? <Text style={styles.empty}>No {folderContentTab === "files" ? "files" : "documents"} matched this search.</Text> : null}
            </View> : archiveLocationLoading ? folderContentTab === "folders" ? <View accessibilityLabel="Loading folders" accessibilityRole="progressbar" style={[styles.rootFolderGrid, styles.folderTabContent]}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={[styles.rootFolderCard, styles.skeletonCard, { width: archiveCardSize, height: archiveCardSize }]} />)}</View> : <View accessibilityLabel={`Loading ${folderContentTab}`} accessibilityRole="progressbar" style={[styles.folderDocuments, styles.folderTabContent]}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={[styles.documentSkeleton, styles.skeletonCard]} />)}</View> : folderContentTab === "folders" ? (
              <View style={[styles.rootFolderGrid, styles.folderTabContent, archiveLocationLoading && styles.loadingGrid]}>
                {folders.length ? folders.map((folder) => { const selected = selectedFolders.some(({ key }) => key === folder.key); return (
                  <View key={folder.key} style={[styles.rootFolderCard, selected && styles.selectedItem, folder.key.startsWith("optimistic-") && styles.optimisticCard, { width: archiveCardSize, height: archiveCardSize }]}>
                    {folder.coverUrl ? <Image contentFit="cover" source={folder.coverUrl} style={styles.folderCover} /> : null}
                    <Button accessibilityState={{ selected }} contentMode="raw" disabled={folder.key.startsWith("optimistic-")} onLongPress={() => handleFolderLongPress(folder)} onPress={() => handleFolderPress(folder)} size="xl" style={[styles.rootFolderMain, folder.coverUrl && styles.coveredFolderMain]} variant="ghost">{folder.coverUrl ? null : <FolderIcon size="lg" />}<Text numberOfLines={1} style={[styles.archiveCardLabel, folder.coverUrl && styles.coveredFolderLabel]}>{folder.name}</Text></Button>
                  </View>
                ); }) : <View style={styles.folderEmptyState}><Text style={styles.empty}>No folders here yet.</Text><Button accessibilityLabel="Create folder" contentMode="raw" onPress={openNewFolder} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button></View>}
              </View>
            ) : (
              <View style={[styles.folderDocuments, styles.folderTabContent]}>
                {folderTabDocuments.length ? folderTabDocuments.map((document) => (
                  <Button accessibilityState={{ selected: selectedDocuments.some(({ key }) => key === document.key) }} contentMode="raw" key={document.key} onLongPress={() => handleDocumentLongPress(document)} onPress={() => handleDocumentPress(document)} size="sm" style={[styles.documentButton, selectedDocuments.some(({ key }) => key === document.key) && styles.selectedItem]} variant="secondary">
                    <FileIcon size="sm" />
                    <Text numberOfLines={1} style={styles.documentButtonLabel}>{document.name}</Text>
                    <ScannedBadge document={document} />
                  </Button>
                )) : visibleUploadBatch.length === 0 ? <View style={styles.folderEmptyState}><Text style={styles.empty}>{folderContentTab === "files" ? "No files here yet." : "No documents here yet."}</Text><Button accessibilityLabel={folderContentTab === "files" ? "Upload files" : "Create document"} contentMode="raw" onPress={() => { if (folderContentTab === "files") void openDestinationPicker("upload"); else startNewNote(); }} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button></View> : null}
                {folderContentTab === "files" ? visibleUploadBatch.map((item) => <View accessibilityLabel={`Uploading ${item.name}`} accessibilityRole="progressbar" key={item.id} style={[styles.documentSkeleton, styles.skeletonCard]} />) : null}
              </View>
            )}
          </View>
        ) : (
        <View style={styles.editorScene}>
          <View style={styles.editorHeader}>
            <Button accessibilityLabel={`Back to ${currentFolder?.name ?? "folders"}`} contentMode="raw" onPress={leaveEditor} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button>
            <View style={styles.editorHeaderActions}>
              {editorEditing
                ? <Button accessibilityLabel="Save and lock document" accessibilityState={{ selected: true }} contentMode="raw" onPress={finishEditing} size="sm" variant="primary"><CheckIcon size="sm" variant="inverse" /></Button>
                : <Button accessibilityLabel="Edit document" contentMode="raw" onPress={() => { stopNarration(); setDocumentSearchQuery(""); setEditorEditing(true); }} size="sm" variant="icon"><EditIcon size="sm" /></Button>}
              <Button accessibilityLabel="AI document actions" contentMode="raw" disabled={!content.trim()} onPress={openEnhanceSheet} size="sm" variant="icon"><BrainIcon size="sm" /></Button>
              <Button accessibilityLabel="Document and audio versions" contentMode="raw" disabled={!activeDocument || saveState !== "saved"} onPress={() => { if (activeDocument) openHistoryChooser(activeDocument); }} size="sm" variant="icon"><ClockIcon size="sm" /></Button>
              <Button accessibilityLabel="Manage document" contentMode="raw" disabled={!activeDocument || saveState !== "saved"} onPress={() => { if (activeDocument) showDocumentActions(activeDocument); }} size="sm" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
            </View>
          </View>
          <View style={[styles.rootSearch, styles.documentSearch]}>
            <SearchIcon size="sm" variant="muted" />
            <TextInput accessibilityLabel="Search in document" editable={!editorEditing} maxLength={200} onChangeText={setDocumentSearchQuery} onSubmitEditing={() => setDocumentSearchRevision((current) => current + 1)} placeholder="Search in document..." returnKeyType="search" style={styles.rootSearchInput} value={documentSearchQuery} />
            {documentSearchQuery.trim() ? <Button accessibilityLabel="Clear document search" contentMode="raw" onPress={() => setDocumentSearchQuery("")} size="xs" variant="icon"><CloseIcon size="sm" /></Button> : null}
          </View>
          {narrationError ? <Text accessibilityRole="alert" style={styles.documentSearchStatus}>{narrationError}</Text> : null}
          <View style={[styles.noteSheet, (editorFocused || aiInputFocused) && styles.noteSheetFocused]}>
          {openingDocumentKey ? <View accessibilityLabel={`Loading ${title}`} accessibilityRole="progressbar" style={styles.editorSkeleton}>
            <View style={styles.editorTitleSkeleton} />
            <View style={styles.editorBodySkeleton} />
          </View> : <>
          {error ? <Text accessibilityRole="alert" style={styles.notice}>{error}</Text> : null}
          {saveState === "error" ? (
            <View style={styles.saveErrorRow}>
              <Text style={styles.saveErrorText}>This draft is stored on this device but has not synced.</Text>
              <Button onPress={() => setSaveRetry((current) => current + 1)} size="xs" variant="secondary">Retry save</Button>
            </View>
          ) : null}

          <ScrollView contentContainerStyle={styles.editorReadDocument} keyboardShouldPersistTaps="handled" nestedScrollEnabled onLayout={(event) => { editorDocumentViewportHeight.current = event.nativeEvent.layout.height; }} ref={editorDocumentScroll} showsVerticalScrollIndicator={false} style={styles.editorReadScroll}>
            {editorEditing ? <>
              <TextInput
                accessibilityLabel="Document title"
                maxLength={255}
                multiline
                onChangeText={(value) => { titleRef.current = value; setTitle(value); markDirty(); persistLocalDraft(value, contentRef.current); }}
                onContentSizeChange={(event) => setEditorTitleHeight(Math.max(36, Math.ceil(event.nativeEvent.contentSize.height)))}
                scrollEnabled={false}
                style={[styles.titleInput, { height: editorTitleHeight }]}
                textAlignVertical="top"
                value={title}
              />
              <View style={[styles.editorFrame, (editorFocused || aiInputFocused) && styles.editorFrameFocused]}>
                <TextInput
                  accessibilityLabel="Document content"
                  multiline
                  scrollEnabled={false}
                  onBlur={() => setEditorFocused(false)}
                  onChangeText={(value) => {
                    if (documentKeyRef.current && value.length === 0) {
                       setError("Saved documents must contain at least one character.");
                      return;
                    }
                    contentRef.current = value;
                    setContent(value);
                    markDirty();
                    persistLocalDraft(titleRef.current, value);
                  }}
                  onContentSizeChange={(event) => setEditorContentHeight(Math.max(280, Math.ceil(event.nativeEvent.contentSize.height)))}
                  placeholder="Start writing from here..."
                  onFocus={() => setEditorFocused(true)}
                  style={[styles.editor, (editorFocused || aiInputFocused) && styles.editorFocused, { height: editorContentHeight }]}
                  textAlignVertical="top"
                  value={content}
                />
              </View>
              {!content && (folders.length > 0 || documents.length > 0) ? (
                <View style={styles.locationPreview}>
                  <Text style={styles.eyebrow}>IN THIS LOCATION</Text>
                  {folders.slice(0, 3).map((folder) => (
                    <View key={folder.key} style={styles.locationRow}>
                      <Button icon={<FolderIcon size="sm" />} onPress={() => void (hasContentContext ? openFolder(folder) : selectFolder(folder))} size="sm" style={styles.locationItem} variant="ghost">{folder.name}</Button>
                      <Button accessibilityLabel={`Manage ${folder.name}`} contentMode="raw" onPress={() => showFolderActions(folder)} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
                    </View>
                  ))}
                  {documents.slice(0, 3).map((document) => <Button key={document.key} onPress={() => void openArchiveDocument(document)} size="sm" variant="ghost" icon={<FileIcon size="sm" />}>{document.name}</Button>)}
                </View>
              ) : null}
            </> : <>
              {currentNotePassages.map((passage, index) => <View key={passage.id} onLayout={(event) => documentPassageOffsets.current.set(passage.id, { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height })}>
                <HighlightedText onTextLayout={documentSearchMatchesById.has(passage.id) ? (event) => {
                  const range = documentSearchMatchesById.get(passage.id)?.ranges[0];
                  if (!range) return;
                  const center = (range.start + range.end) / 2;
                  let offset = 0;
                  for (const line of event.nativeEvent.lines) {
                    const next = offset + line.text.length;
                    if (center <= next) {
                      const measured = line.y + line.height / 2;
                      if (Math.abs((documentHighlightOffsets.current.get(passage.id) ?? -1) - measured) > 1) {
                        documentHighlightOffsets.current.set(passage.id, measured);
                        setDocumentSearchLayoutRevision((current) => current + 1);
                      }
                      break;
                    }
                    offset = next;
                  }
                } : undefined} ranges={documentSearchMatchesById.get(passage.id)?.ranges} style={index === 0 ? styles.editorReadTitle : styles.editorReadText} text={passage.text} />
              </View>)}
            </>}
          </ScrollView>
          </>}
          </View>
        </View>
        )}
      </ScrollView>

      <CoreComposer
        accessory={narrationAccessory}
        accessibilityHint="Ask a question, search your Archive, or describe how to change the open document"
        accessibilityLabel="Ask Core about your Archive"
        disabled={!hasContentContext || instructing || saveState === "saving"}
        editable={!instructing}
        leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />}
        leadingAccessibilityLabel="Open document actions"
        leadingDisabled={!hasContentContext || !content.trim() || instructing}
        loading={instructing}
        maxLength={8_000}
        message={<>
          {aiInstructionError ? <Text accessibilityRole="alert" style={styles.aiComposerError}>{aiInstructionError}</Text> : null}
          {aiResponse ? (
            <View style={styles.aiResponse}>
              <Text numberOfLines={4} style={styles.aiResponseText}>{aiResponse.message}</Text>
              {aiResponse.sources.length > 0 ? <Text numberOfLines={1} style={styles.aiResponseSources}>Sources: {aiResponse.sources.map(({ name }) => name).join(", ")}</Text> : null}
            </View>
          ) : null}
        </>}
        onChangeText={(value) => { setAiInstruction(value); if (aiInstructionError) setAiInstructionError(undefined); }}
        onFocusChange={(focused) => {
          setAiInputFocused(focused);
          if (!focused) {
            setAiResponse(undefined);
            setAiInstructionError(undefined);
          }
        }}
        onLeadingPress={openEnhanceSheet}
        onSubmit={() => void runNoteInstruction()}
        openRequest={coreOpenRequest}
        prompts={CORE_PROMPTS}
        sendIcon={<SendIcon size="sm" />}
        value={aiInstruction}
      />
      </>}

      {workspaceMode === "viewer" ? <CoreComposer
        accessory={narrationAccessory}
        accessibilityHint="Ask a question about the open file"
        accessibilityLabel="Ask Core about this file"
        disabled={!hasContentContext || instructing || !filePreview}
        editable={!instructing}
        leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />}
        loading={instructing}
        maxLength={8_000}
        message={<>
          {aiInstructionError ? <Text accessibilityRole="alert" style={styles.aiComposerError}>{aiInstructionError}</Text> : null}
          {aiResponse ? (
            <View style={styles.aiResponse}>
              <Text numberOfLines={4} style={styles.aiResponseText}>{aiResponse.message}</Text>
              {aiResponse.sources.length > 0 ? <Text numberOfLines={1} style={styles.aiResponseSources}>Sources: {aiResponse.sources.map(({ name }) => name).join(", ")}</Text> : null}
            </View>
          ) : null}
        </>}
        onChangeText={(value) => { setAiInstruction(value); if (aiInstructionError) setAiInstructionError(undefined); }}
        onFocusChange={(focused) => {
          setAiInputFocused(focused);
          if (!focused) {
            setAiResponse(undefined);
            setAiInstructionError(undefined);
          }
        }}
        onSubmit={() => void runFileInstruction()}
        prompts={CORE_PROMPTS}
        sendIcon={<SendIcon size="sm" />}
        value={aiInstruction}
      /> : null}

      <BottomSheet
        description={activeSheet === "create" ? "Choose what to add to the current folder." : activeSheet === "versions" ? "Choose a version of this document to open or download." : activeSheet === "audioVersions" ? "Generated audio has its own history, independent from document versions." : activeSheet === "summary" ? "Review the match, then open its source document." : activeSheet === "deleteDocument" ? `Delete ${selectedDocument?.extension ? "file" : "document"} from Archive? It will move to trash.` : activeSheet === "bulkDelete" && !singleFolderDelete ? `Delete ${selectedCount} selected ${selectedCount === 1 ? "item" : "items"} from Archive? Selected folders include everything inside them.` : undefined}
        dismissible={!versionActionKey && !generatingAudioVersion && !destinationLoading && !documentActionLoading && !bulkLoading}
        footer={mutationFooter()}
        hideHeading={activeSheet === "create" || activeSheet === "documentActions" || activeSheet === "enhance" || activeSheet === "historyChooser" || activeSheet === "bulkActions" || singleFolderDelete}
        mutation={activeSheet === "documents" || activeSheet === "folder" || activeSheet === "folders" || activeSheet === "versions" || activeSheet === "audioVersions" || activeSheet === "rename" || activeSheet === "destinationBrowser" || activeSheet === "folderDetails" || activeSheet === "bulkDelete" && !singleFolderDelete}
        onOpenChange={(open) => { if (!open) closeSheet(); }}
        open={sheetOpen}
        tall={activeSheet === "library" || activeSheet === "documents" || activeSheet === "folders" || activeSheet === "scanSources" || activeSheet === "versions" || activeSheet === "audioVersions" || activeSheet === "folderDetails"}
        title={activeSheet === "enhance" ? "AI actions" : activeSheet === "historyChooser" ? "Document history" : activeSheet === "versions" ? "Document versions" : activeSheet === "audioVersions" ? "Audio versions" : activeSheet === "scanSources" ? "Scanned pages" : activeSheet === "deleteDocument" ? `Delete ${selectedDocument?.extension ? "file" : "document"}` : activeSheet === "bulkDelete" ? "Delete selected items" : activeSheet === "folder" ? "Create folder" : activeSheet === "documents" ? "Documents and files" : activeSheet === "folders" ? "Folders" : activeSheet === "destinationBrowser" ? destinationAction === "upload" ? destinationFolder?.name ?? "Archive" : destinationAction === "move" ? "Move to folder" : "Copy to folders" : activeSheet === "library" ? "Browse Archive" : activeSheet === "documentActions" ? selectedDocument?.name ?? "Document actions" : activeSheet === "destination" ? destinationAction === "upload" ? "Upload files" : "Choose destination" : activeSheet === "rename" ? selectedDocument?.extension ? "Rename file" : "Rename document" : activeSheet === "summary" ? selectedSummary?.name ?? "Document summary" : activeSheet === "folderActions" ? selectedFolder?.name ?? "Folder actions" : activeSheet === "folderDetails" ? "Edit folder" : "New in Archive"}
      >
        {sheetError ? <Text accessibilityRole="alert" style={styles.notice}>{sheetError}</Text> : null}
        {singleFolderDelete ? <View style={styles.compactSheetActions}>
          <Button disabled={bulkLoading} loading={bulkLoading} onPress={() => void deleteContentSelection()} size="lg" variant="primary">Delete</Button>
          <Button disabled={bulkLoading} onPress={() => closeSheet()} size="lg" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "create" ? (
          <>
            <BottomSheetItem onPress={() => { void startNewNote(); }} variant="secondary">New document</BottomSheetItem>
            <BottomSheetItem onPress={openNewFolder} variant="secondary">New folder</BottomSheetItem>
            <BottomSheetItem disabled={uploading} loading={uploading} onPress={() => void openDestinationPicker("upload")} variant="secondary">Upload files</BottomSheetItem>
            <BottomSheetItem disabled={uploading || scanBusy} onPress={startDocumentScan} variant="secondary">Scan documents</BottomSheetItem>
          </>
        ) : null}
        {activeSheet === "bulkActions" ? <View style={styles.bulkActionList}>
          <Button disabled={bulkLoading} loading={bulkLoading} onPress={() => void updateSelectionFavorite()} size="lg" variant="secondary">{allSelectedFavorite ? "Unfavorite" : "Favorite"}</Button>
          <Button disabled={bulkLoading} onPress={() => void openDestinationPicker("move")} size="lg" variant="secondary">Move to folder</Button>
          <Button disabled={bulkLoading} onPress={() => void openDestinationPicker("copy")} size="lg" variant="secondary">Copy to folders</Button>
          <Button disabled={bulkLoading} onPress={() => pushSheet("bulkDelete")} size="lg" variant="secondary">Delete</Button>
        </View> : null}
        {activeSheet === "historyChooser" ? (
          <View style={styles.historyChoices}>
            <BottomSheetItem onPress={() => void openVersionHistory()}>Document versions</BottomSheetItem>
            <BottomSheetItem onPress={() => void openAudioVersionHistory()}>Audio versions</BottomSheetItem>
          </View>
        ) : null}
        {activeSheet === "documentActions" && selectedDocument ? (
          <>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} loading={documentActionLoading === "listen"} onPress={() => void listenToSelectedDocument()}>Listen</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => void toggleFavorite()}>{selectedDocument.isFavorite ? "Remove from favorites" : "Add to favorites"}</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} loading={documentActionLoading === "download"} onPress={() => void downloadOriginal()}>{selectedDocument.extension ? "Download original" : "Download as text"}</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => { setRenameName(selectedDocument.name); pushSheet("rename"); }}>Rename</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => void openDestinationPicker("move", { document: selectedDocument })}>Move to folder</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => void openDestinationPicker("copy", { document: selectedDocument })}>Copy to folders</BottomSheetItem>
            {selectedDocument.sourceImageCount ? <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => void openScanSources()}>View scanned pages</BottomSheetItem> : null}
            <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => pushSheet("deleteDocument")}>Delete {selectedDocument.extension ? "file" : "document"}</BottomSheetItem>
          </>
        ) : null}
        {activeSheet === "scanSources" ? (
          <ScrollView contentContainerStyle={styles.sourceGrid} showsVerticalScrollIndicator={false}>
            {sourceImagesLoading ? <View accessibilityLabel="Loading scanned pages" accessibilityRole="progressbar" style={styles.sourceLoading}><Spinner size="large" /></View> : null}
            {sourceImages.map((source) => <View key={source.page} style={styles.sourceCard}><Image contentFit="cover" source={source.url} style={styles.sourceImage} /><Text style={styles.sourceLabel}>Page {source.page}</Text></View>)}
          </ScrollView>
        ) : null}
        {activeSheet === "folderActions" && selectedFolder ? (
          <>
            <BottomSheetItem onPress={openFolderDetails}>Edit</BottomSheetItem>
            <BottomSheetItem onPress={() => void openDestinationPicker("move", { folder: selectedFolder })}>Move folder</BottomSheetItem>
            <BottomSheetItem onPress={() => void openDestinationPicker("copy", { folder: selectedFolder })}>Copy folder</BottomSheetItem>
            <BottomSheetItem onPress={confirmSelectedFolderDelete}>Delete folder</BottomSheetItem>
          </>
        ) : null}
        {activeSheet === "folderDetails" && selectedFolder ? (
          <ScrollView contentContainerStyle={styles.folderDetailsForm} showsVerticalScrollIndicator={false}>
            <TextInput accessibilityLabel="Folder name" maxLength={255} onChangeText={setFolderDetailsName} placeholder="Folder name" value={folderDetailsName} />
            <TextInput accessibilityLabel="Folder description" maxLength={2000} multiline onChangeText={setFolderDetailsDescription} placeholder="What belongs in this folder?" style={styles.folderDescriptionInput} textAlignVertical="top" value={folderDetailsDescription} />
            <View style={styles.folderDetailsCoverPreview}>
              {(folderDetailsCoverAsset === undefined ? selectedFolder.coverUrl : folderDetailsCoverAsset?.uri)
                ? <Image contentFit="cover" source={folderDetailsCoverAsset === undefined ? selectedFolder.coverUrl : folderDetailsCoverAsset?.uri} style={styles.folderCover} />
                : <FolderIcon size="lg" />}
            </View>
            <View style={styles.folderDetailsActions}>
              <Button onPress={() => void chooseFolderCover()} size="md" style={styles.folderDetailsAction} variant="secondary">{(folderDetailsCoverAsset === undefined ? selectedFolder.coverUrl : folderDetailsCoverAsset?.uri) ? "Change cover" : "Set cover"}</Button>
              {(folderDetailsCoverAsset === undefined ? selectedFolder.coverUrl : folderDetailsCoverAsset?.uri) ? <Button onPress={clearFolderCover} size="md" style={styles.folderDetailsAction} variant="secondary">Remove cover</Button> : null}
            </View>
            <Button onPress={() => setFolderDetailsFavorite((current) => !current)} size="lg" variant={folderDetailsFavorite ? "primary" : "secondary"}>{folderDetailsFavorite ? "Remove from favorites" : "Add to favorites"}</Button>
          </ScrollView>
        ) : null}
        {activeSheet === "rename" ? (
          <View style={styles.namingForm}>
            <Text style={styles.inputLabel}>Document name</Text>
            <TextInput accessibilityLabel="Document name" autoFocus maxLength={255} onChangeText={setRenameName} onSubmitEditing={() => void submitRename()} placeholder="Document name" returnKeyType="done" value={renameName} />
          </View>
        ) : null}
        {activeSheet === "summary" && selectedSummary ? (
          <View style={styles.summaryPanel}>
            <View style={styles.enhanceIdentity}>
              <FileIcon size="lg" variant="accent" />
              <View style={styles.enhanceCopy}><Text style={styles.rowTitle}>{selectedSummary.name}</Text><Text style={styles.meta}>SEARCH SUMMARY</Text></View>
            </View>
            {summaryLoading ? <Text style={styles.empty}>Creating summary...</Text> : selectedSummary.summary ? <Text style={styles.summaryText}>{selectedSummary.summary}</Text> : null}
            <Button disabled={summaryLoading || openingDocumentKey !== undefined} onPress={() => void openSummaryDocument()} size="lg" variant="primary">Open document</Button>
          </View>
        ) : null}
        {activeSheet === "destination" ? (
          <View style={styles.destinationPanel}>
            <BottomSheetItem disabled={destinationLoading} loading={destinationLoading} onPress={() => void openDestinationBrowser()}>Choose folder</BottomSheetItem>
          </View>
        ) : null}
        {activeSheet === "destinationBrowser" ? (
          <View style={styles.destinationBrowser}>
            <View style={styles.destinationLocationLane}>
              {destinationStack.length > 0 ? <Button accessibilityLabel={`Back to ${destinationStack.at(-2)?.name ?? "Archive"}`} contentMode="raw" onPress={() => void browseDestination(undefined, true)} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button> : null}
              <Text numberOfLines={1} style={styles.destinationLocationTitle}>{destinationFolder?.name ?? "Archive"}</Text>
            </View>
            <ScrollView contentContainerStyle={styles.destinationFolderGrid} keyboardShouldPersistTaps="handled" style={styles.folderList}>
              {destinationLoading ? Array.from({ length: 3 }, (_, index) => <View accessibilityLabel="Loading folders" accessibilityRole="progressbar" key={index} style={[styles.rootFolderCard, styles.skeletonCard, { width: destinationCardSize, height: destinationCardSize }]} />) : null}
              {destinationFolders.filter((folder) => !destinationBlockedFolderKeys.includes(folder.key)).map((folder) => {
                return <View key={folder.key} style={[styles.rootFolderCard, { width: destinationCardSize, height: destinationCardSize }]}>
                  {folder.coverUrl ? <Image contentFit="cover" source={folder.coverUrl} style={styles.folderCover} /> : null}
                  <Button accessibilityLabel={`Open ${folder.name}`} contentMode="raw" onPress={() => void browseDestination(folder)} size="xl" style={[styles.rootFolderMain, folder.coverUrl && styles.coveredFolderMain]} variant="ghost">{folder.coverUrl ? null : <FolderIcon size="lg" />}<Text numberOfLines={1} style={[styles.archiveCardLabel, folder.coverUrl && styles.coveredFolderLabel]}>{folder.name}</Text></Button>
                </View>;
              })}
            </ScrollView>
          </View>
        ) : null}
        {activeSheet === "enhance" ? (
          <View style={styles.enhancePanel}>
            <Button onPress={confirmEnhancementWithCore} size="lg" variant="secondary">Enhance document</Button>
            <Button disabled={!documentKeyRef.current || saveState !== "saved"} onPress={confirmTranslationWithCore} size="lg" variant="secondary">Translate document</Button>
          </View>
        ) : null}
        {activeSheet === "versions" ? (
          <View style={styles.versionPanel}>
            {loadingVersions ? <Text style={styles.empty}>Loading version history...</Text> : null}
            {!loadingVersions && versions.length === 0 ? <Text style={styles.empty}>No previous versions yet.</Text> : null}
            {versions.map((version) => (
              <View key={version.key} style={styles.versionRow}>
                <Button contentMode="raw" disabled={Boolean(versionActionKey)} loading={versionActionKey === version.key} onPress={() => void loadVersionIntoEditor(version)} size="lg" style={styles.versionMain} variant="secondary"><ClockIcon size="md" variant="accent" /><View style={styles.resultText}><Text style={styles.rowTitle}>{version.label ?? `Version ${version.version}`}</Text><Text style={styles.rowSubtitle}>{new Date(version.createdAt).toLocaleString()}</Text></View></Button>
                <Button accessibilityLabel={`Download ${version.label ?? `version ${version.version}`} as TXT`} contentMode="raw" disabled={Boolean(versionActionKey)} onPress={() => void downloadVersion(version)} size="lg" variant="icon"><DownloadIcon size="md" /></Button>
              </View>
            ))}
          </View>
        ) : null}
        {activeSheet === "audioVersions" ? (
          <View style={styles.audioVersionPanel}>
            {selectedAudioVersion ? (
              <View style={styles.audioVersionPlayer}>
                <View style={styles.audioVersionNowPlaying}>
                  <View style={styles.resultText}><Text style={styles.rowTitle}>Audio version {selectedAudioVersion.version}</Text><Text style={styles.rowSubtitle}>{selectedAudioVersion.current ? "Current document content" : "Earlier document content"} · {new Date(selectedAudioVersion.createdAt).toLocaleString()}</Text></View>
                  <Button accessibilityLabel={narrationState === "playing" ? "Pause audio version" : "Play audio version"} contentMode="raw" onPress={controlSelectedAudioVersion} size="md" variant="icon">{narrationState === "playing" ? <PauseIcon size="md" /> : <PlayIcon size="md" />}</Button>
                </View>
                <View style={styles.narrationControls}>
                  <Text style={styles.narrationTime}>{formatAudioTime(narrationElapsed)}</Text>
                  <Slider accessibilityLabel="Audio version progress" max={Math.max(1, narrationDuration)} onSlidingComplete={(value) => { setNarrationScrubValue(undefined); scrubSelectedAudioVersion(value); }} onValueChange={setNarrationScrubValue} style={styles.narrationSlider} value={Math.min(narrationElapsed, narrationDuration)} />
                  <Text style={styles.narrationTime}>{formatAudioTime(narrationDuration)}</Text>
                </View>
                <View style={styles.audioVersionNavigation}>
                  <Button accessibilityLabel="Play older audio version" contentMode="raw" disabled={selectedAudioVersionIndex >= audioVersions.length - 1} onPress={() => void playAudioVersion(audioVersions[selectedAudioVersionIndex + 1]!)} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button>
                  <Text style={styles.audioVersionPosition}>{selectedAudioVersionIndex + 1} of {audioVersions.length}</Text>
                  <Button accessibilityLabel="Play newer audio version" contentMode="raw" disabled={selectedAudioVersionIndex <= 0} onPress={() => void playAudioVersion(audioVersions[selectedAudioVersionIndex - 1]!)} size="sm" variant="icon"><ChevronRightIcon size="sm" /></Button>
                </View>
              </View>
            ) : null}
            {!loadingAudioVersions && audioVersions.length === 0 ? <Text style={styles.empty}>No audio versions yet. Generate one whenever you want a new recording of this document.</Text> : null}
            <ScrollView accessibilityLabel={loadingAudioVersions ? "Loading audio versions" : undefined} accessibilityRole={loadingAudioVersions ? "progressbar" : undefined} contentContainerStyle={styles.audioVersionList} showsVerticalScrollIndicator={false}>
              {loadingAudioVersions ? Array.from({ length: 3 }, (_, index) => (
                <View key={index} style={styles.audioVersionSkeletonRow}>
                  <View style={styles.audioVersionSkeletonIcon} />
                  <View style={styles.audioVersionSkeletonCopy}><View style={styles.audioVersionSkeletonTitle} /><View style={styles.audioVersionSkeletonSubtitle} /></View>
                </View>
              )) : audioVersions.map((version) => (
                <Button contentMode="raw" key={version.key} onPress={() => selectedAudioVersionKey === version.key ? controlSelectedAudioVersion() : void playAudioVersion(version)} size="lg" style={styles.versionMain} variant="secondary">
                  {selectedAudioVersionKey === version.key && narrationState === "playing" ? <PauseIcon size="md" /> : <PlayIcon size="md" />}
                  <View style={styles.resultText}><Text style={styles.rowTitle}>Audio version {version.version}{version.current ? " · Current" : ""}</Text><Text style={styles.rowSubtitle}>{formatAudioTime(version.durationMs / 1_000)} · {new Date(version.createdAt).toLocaleString()}</Text></View>
                </Button>
              ))}
            </ScrollView>
          </View>
        ) : null}
        {activeSheet === "folder" ? (
          <View style={styles.namingForm}>
            <Text style={styles.inputLabel}>Folder name</Text>
            <TextInput accessibilityLabel="New folder name" autoFocus maxLength={255} onChangeText={setFolderName} placeholder="Folder name" value={folderName} />
            <Text style={styles.inputLabel}>Description</Text>
            <TextInput accessibilityLabel="New folder description" maxLength={2000} multiline onChangeText={setFolderDescription} placeholder="What belongs in this folder?" style={styles.folderDescriptionInput} textAlignVertical="top" value={folderDescription} />
          </View>
        ) : null}
        {activeSheet === "library" ? (
          <View style={styles.libraryChoices}>
            <Button icon={<FileIcon size="lg" />} onPress={() => { setLibraryQuery(""); pushSheet("documents"); }} size="lg" style={styles.libraryChoice} variant="secondary">Documents</Button>
            <Button icon={<FolderIcon size="lg" />} onPress={() => { setLibraryQuery(""); pushSheet("folders"); }} size="lg" style={styles.libraryChoice} variant="secondary">Folders</Button>
          </View>
        ) : null}
        {activeSheet === "folders" ? (
          <>
            <View style={styles.folderSearch}>
              <SearchIcon size="sm" variant="muted" />
              <TextInput accessibilityLabel="Search Archive folders" autoFocus onChangeText={setLibraryQuery} placeholder="Search..." style={styles.folderSearchInput} value={libraryQuery} />
            </View>
            <ScrollView contentContainerStyle={styles.folderGrid} keyboardShouldPersistTaps="handled" style={styles.folderList}>
              {showArchiveRoot ? <Button icon={<ArchiveIcon size="md" />} onPress={() => void selectRootFolder()} size="lg" style={styles.folderTile} variant="secondary">Archive</Button> : null}
              {visibleFolders.map((folder) => (
                <View key={folder.key} style={styles.managedTile}>
                  <Button icon={<FolderIcon size="md" />} onPress={() => void selectFolder(folder)} size="lg" style={styles.managedTileMain} variant="secondary">{folder.name}</Button>
                  <Button accessibilityLabel={`Manage ${folder.name}`} contentMode="raw" onPress={() => showFolderActions(folder)} size="xs" style={styles.managedTileAction} variant="icon"><MoreHorizontalIcon size="sm" /></Button>
                </View>
              ))}
              {!showArchiveRoot && visibleFolders.length === 0 ? <Text style={styles.empty}>No folders match this search.</Text> : null}
            </ScrollView>
          </>
        ) : null}
        {activeSheet === "documents" ? (
          <>
            <View style={styles.folderSearch}>
              <SearchIcon size="sm" variant="muted" />
              <TextInput accessibilityLabel="Search Archive documents and files" autoFocus onChangeText={setLibraryQuery} placeholder="Search..." style={styles.folderSearchInput} value={libraryQuery} />
            </View>
            <ScrollView contentContainerStyle={styles.folderGrid} keyboardShouldPersistTaps="handled" style={styles.folderList}>
              {visibleDocuments.map((document) => (
                <Button contentMode="raw" key={document.key} onPress={() => void openArchiveDocument(document, true)} size="lg" style={styles.folderTile} variant="secondary">
                  <FileIcon size="md" /><Text numberOfLines={1} style={styles.folderTileLabel}>{document.name}</Text><ScannedBadge document={document} />
                </Button>
              ))}
              {visibleDocuments.length === 0 ? <Text style={styles.empty}>No documents or files match this search.</Text> : null}
            </ScrollView>
          </>
        ) : null}
      </BottomSheet>
      {scanOpen ? <DocumentScanModal busy={scanBusy} error={scanError} onClose={() => { setScanOpen(false); setScanError(undefined); }} onSubmit={(pages) => void submitDocumentScan(pages)} /> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md, justifyContent: "center", borderBottomColor: palette.hairline, borderBottomWidth: 1 },
  eyebrow: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 9, letterSpacing: tracking.micro },
  scrollView: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  archiveRoot: { flexGrow: 1 },
  archiveFolder: { flexGrow: 1, gap: spacing.md },
  editorScroll: { flex: 1, minHeight: 0 },
  editorScene: { flex: 1, minHeight: 0, width: "100%", gap: spacing.sm },
  editorHeader: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  editorHeaderActions: { flexDirection: "row", alignItems: "center", gap: 8 },
  rootActions: { minHeight: 52, flexDirection: "row", alignItems: "center", gap: 8, marginBottom: spacing.md },
  bulkToolbar: { minHeight: 44, marginBottom: spacing.md, paddingHorizontal: 2, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderTopColor: palette.hairline, borderBottomColor: palette.hairline, borderTopWidth: StyleSheet.hairlineWidth, borderBottomWidth: StyleSheet.hairlineWidth },
  bulkToolbarAction: { minHeight: 44 },
  bulkToolbarIcon: { height: 44, width: 44 },
  bulkSelectionText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  rootCreateButton: { height: 44, width: 44 },
  rootSearch: { minHeight: 44, flex: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised },
  documentSearch: { flex: 0, width: "100%" },
  documentSearchStatus: { minHeight: 16, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, textAlign: "right" },
  documentSearchHighlight: { color: palette.silver50, backgroundColor: "rgba(206, 170, 92, 0.36)" },
  folderScopedSearch: { flex: 0, width: "100%" },
  rootSearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" },
  rootSearchResults: { gap: 7 },
  rootContent: { gap: spacing.lg },
  rootDocuments: { gap: 7 },
  rootFolderGrid: { alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10 },
  loadingGrid: { flex: 1 },
  rootFolderCard: { position: "relative", borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised, overflow: "hidden" },
  selectedItem: { borderColor: palette.silver50, shadowColor: palette.silver50, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.62, shadowRadius: 5, elevation: 4 },
  optimisticCard: { opacity: 0.7 },
  rootFolderMain: { height: "100%", width: "100%", flexDirection: "column", justifyContent: "center", gap: 10, paddingHorizontal: 8 },
  folderCover: StyleSheet.absoluteFill,
  coveredFolderMain: { justifyContent: "flex-end", paddingBottom: 10, backgroundColor: "rgba(0, 0, 0, 0.16)" },
  archiveCardLabel: { width: "100%", color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  coveredFolderLabel: { paddingHorizontal: 5, paddingVertical: 4, borderRadius: radii.sm, backgroundColor: "rgba(0, 0, 0, 0.68)", color: "#FFFFFF" },
  skeletonCard: { backgroundColor: palette.hairlineBright, opacity: 0.72 },
  documentSkeleton: { width: "100%", minHeight: 38, borderRadius: 999 },
  workspacePanel: { flexGrow: 1, gap: spacing.md, padding: spacing.md, borderRadius: radii.xl, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised },
  folderTitleRow: { minHeight: 48, flexDirection: "row", alignItems: "center", gap: 8 },
  folderTitle: { flex: 1, color: palette.silver50, fontFamily: fonts.medium, fontSize: 24 },
  folderTitleActions: { flexDirection: "row", alignItems: "center", gap: 4 },
  folderTabs: { flexDirection: "row", gap: 4, padding: 3, borderWidth: 1, backgroundColor: palette.panel },
  folderTab: { flex: 1 },
  folderDocuments: { gap: 7 },
  folderTabContent: { flexGrow: 1 },
  folderEmptyState: { flex: 1, minHeight: 360, alignItems: "center", justifyContent: "center", gap: 14 },
  emptyPlusButton: { height: 44, width: 44 },
  documentButton: { width: "100%", minHeight: 38, justifyContent: "flex-start", paddingHorizontal: 14 },
  documentButtonLabel: { flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "left" },
  scannedBadge: { marginRight: -6, paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, backgroundColor: palette.panel },
  scannedBadgeText: { color: palette.muted, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 0.4 },
  sectionLabel: { marginTop: spacing.sm, color: palette.silver500, fontFamily: fonts.medium, fontSize: 9, letterSpacing: tracking.micro },
  documentRow: { justifyContent: "flex-start" },
  folderEmpty: { flexGrow: 1, minHeight: 220, alignItems: "center", justifyContent: "center" },
  emptyAction: { minHeight: 34, paddingHorizontal: spacing.sm },
  emptyActionText: { color: palette.muted, letterSpacing: 0.4, textTransform: "none" },
  noteSheet: { flex: 1, minHeight: 0, width: "100%", padding: spacing.md, borderRadius: radii.xl, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised, overflow: "hidden" },
  editorSkeleton: { flex: 1, gap: spacing.lg },
  editorTitleSkeleton: { width: "72%", height: 52, borderRadius: radii.md, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  editorBodySkeleton: { flex: 1, minHeight: 280, borderRadius: radii.md, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  noteSheetFocused: { flex: 1, minHeight: 0 },
  metaRow: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteActions: { flexDirection: "row", gap: 8 },
  folderContext: { flexDirection: "row", alignItems: "center", gap: 6 },
  folderContextBack: { flex: 1, justifyContent: "flex-start" },
  meta: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1.5 },
  notice: { marginBottom: 12, padding: 10, borderRadius: radii.sm, color: palette.silver300, backgroundColor: "rgba(120, 76, 40, 0.24)", fontFamily: fonts.regular, fontSize: 12 },
  saveErrorRow: { marginBottom: 10, padding: 10, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radii.sm, borderColor: palette.hairline, borderWidth: 1 },
  saveErrorText: { flex: 1, color: palette.silver300, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  titleInput: { minHeight: 36, width: "100%", paddingHorizontal: 0, paddingVertical: 0, borderWidth: 0, backgroundColor: "transparent", color: palette.silver50, fontFamily: fonts.medium, fontSize: 28, lineHeight: 36, textAlign: "left", writingDirection: "ltr" },
  editorFrame: { minHeight: 280, width: "100%", position: "relative", overflow: "hidden" },
  editorFrameFocused: { minHeight: 280 },
  editor: { minHeight: 280, width: "100%", paddingHorizontal: 0, paddingVertical: 0, borderWidth: 0, backgroundColor: "transparent", color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26, textAlign: "left", writingDirection: "ltr" },
  editorReadScroll: { flex: 1, minHeight: 0, width: "100%" },
  editorReadDocument: { flexGrow: 1, width: "100%", gap: spacing.md, paddingBottom: spacing.xl },
  editorReadTitle: { width: "100%", color: palette.silver50, fontFamily: fonts.medium, fontSize: 28, lineHeight: 36, textAlign: "left", writingDirection: "ltr" },
  editorReadText: { width: "100%", color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26, textAlign: "left", writingDirection: "ltr" },
  editorFocused: { minHeight: 280 },
  aiComposerError: { paddingHorizontal: 8, color: "#D98B8B", fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  aiResponse: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, gap: 3, borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panel },
  aiResponseText: { color: palette.text, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  aiResponseSources: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  narrationPlayer: { marginHorizontal: 4, marginBottom: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs, borderRadius: radii.lg, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised },
  narrationHeading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  narrationTitleBlock: { flex: 1, gap: 2 },
  narrationTitle: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 13 },
  narrationStatus: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 8, letterSpacing: 1.3 },
  narrationControls: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  narrationSlider: { flex: 1 },
  narrationTime: { minWidth: 32, color: palette.silver300, fontFamily: fonts.regular, fontSize: 10, textAlign: "center" },
  narrationError: { color: "#D98B8B", fontFamily: fonts.regular, fontSize: 10, lineHeight: 14 },
  enhancePanel: { gap: 18 },
  enhanceIdentity: { padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panel },
  enhanceCopy: { flex: 1, gap: 4 },
  versionPanel: { gap: 10 },
  versionRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  versionMain: { flex: 1, justifyContent: "flex-start", paddingHorizontal: 14 },
  historyChoices: { gap: spacing.sm },
  audioVersionPanel: { flex: 1, minHeight: 0, gap: spacing.md },
  audioVersionPlayer: { padding: spacing.md, gap: spacing.sm, borderRadius: radii.lg, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised },
  audioVersionNowPlaying: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  audioVersionNavigation: { flexDirection: "row", alignItems: "center", justifyContent: "center", gap: spacing.md },
  audioVersionPosition: { minWidth: 56, color: palette.silver300, fontFamily: fonts.medium, fontSize: 11, textAlign: "center" },
  audioVersionList: { gap: spacing.xs, paddingBottom: spacing.xl },
  audioVersionSkeletonRow: { minHeight: 52, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.lg, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised, opacity: 0.72 },
  audioVersionSkeletonIcon: { height: 24, width: 24, borderRadius: 12, backgroundColor: palette.hairlineBright },
  audioVersionSkeletonCopy: { flex: 1, gap: 6 },
  audioVersionSkeletonTitle: { height: 12, width: "42%", borderRadius: radii.sm, backgroundColor: palette.hairlineBright },
  audioVersionSkeletonSubtitle: { height: 9, width: "68%", borderRadius: radii.sm, backgroundColor: palette.hairlineBright },
  summaryPanel: { gap: 16 },
  summaryText: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 24 },
  destinationPanel: { flex: 1, gap: 12 },
  bulkActionList: { width: "100%", gap: spacing.sm },
  compactSheetActions: { width: "100%", gap: spacing.sm, padding: 2 },
  disabledPrimaryAction: { opacity: 0.8 },
  destinationBrowser: { flex: 1, minHeight: 0, gap: spacing.sm },
  destinationLocationLane: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  destinationLocationTitle: { flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14 },
  destinationFolders: { gap: 8, paddingVertical: 4 },
  destinationFolderGrid: { alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10, paddingVertical: 4 },
  uploadDestinationButton: { justifyContent: "flex-start", paddingHorizontal: 14 },
  locationPreview: { gap: 4, marginTop: 10 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  locationItem: { flex: 1, justifyContent: "flex-start" },
  match: { gap: 7, marginBottom: 10, padding: 12, borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panel },
  results: { gap: 8 },
  resultsHeader: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 6 },
  resultsTitle: { marginTop: 6, color: palette.silver50, fontFamily: fonts.medium, fontSize: 24 },
  resultRow: { flexDirection: "row", alignItems: "center", gap: 12, justifyContent: "flex-start", padding: 12 },
  resultText: { flex: 1, gap: 3 },
  rowTitle: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 14 },
  rowSubtitle: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
  empty: { paddingVertical: 24, color: palette.silver500, fontFamily: fonts.regular, textAlign: "center" },
  namingForm: { flex: 1, gap: 12 },
  folderDetailsForm: { gap: 12, paddingBottom: spacing.md },
  folderDetailsCoverPreview: { height: 180, width: "100%", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden", borderRadius: radii.lg, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised },
  folderDetailsActions: { flexDirection: "row", gap: spacing.sm },
  folderDetailsAction: { flex: 1 },
  inputLabel: { marginLeft: 2, color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 0.4 },
  folderDescriptionInput: { minHeight: 120 },
  libraryChoices: { gap: 10 },
  libraryChoice: { minHeight: 72, width: "100%", gap: 10 },
  folderSearch: { minHeight: 48, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised },
  folderSearchInput: { flex: 1, minHeight: 40, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" },
  folderGrid: { paddingTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  folderList: { flex: 1 },
  folderTile: { minHeight: 86, flexBasis: "48%", flexDirection: "column", gap: 8, paddingHorizontal: 10 },
  folderTileLabel: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12, textAlign: "center" },
  sourceGrid: { flexDirection: "row", flexWrap: "wrap", gap: 8, paddingBottom: spacing.xl },
  sourceCard: { flexBasis: "31%", aspectRatio: 0.72, borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, overflow: "hidden", backgroundColor: palette.panelRaised },
  sourceImage: { height: "100%", width: "100%" },
  sourceLabel: { bottom: 0, left: 0, paddingHorizontal: 6, paddingVertical: 3, position: "absolute", color: palette.text, backgroundColor: "rgba(3,5,7,0.76)", fontFamily: fonts.medium, fontSize: 9 },
  sourceLoading: { flexBasis: "100%", minHeight: 180, alignItems: "center", justifyContent: "center" },
  managedTile: { minHeight: 86, flexBasis: "31%", position: "relative" },
  managedTileMain: { minHeight: 86, width: "100%", flexDirection: "column", gap: 8, paddingHorizontal: 10 },
  managedTileAction: { position: "absolute", right: 4, top: 4 },
});
