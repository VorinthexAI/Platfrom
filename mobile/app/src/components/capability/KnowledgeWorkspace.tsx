import { useNavigation, useRouter } from "expo-router";
import { File } from "expo-file-system";
import * as DocumentPicker from "expo-document-picker";
import * as ImagePicker from "expo-image-picker";
import * as Haptics from "expo-haptics";
import { Image } from "expo-image";
import { setAudioModeAsync, useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ComponentRef, type ReactNode } from "react";
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions, type NativeSyntheticEvent, type TextLayoutEventData } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { BottomSheet, BottomSheetItem, BottomSheetMenu } from "@vorinthex/shared/ui/bottom-sheet";
import { Badge } from "@vorinthex/shared/ui/badge";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { FileViewer } from "@vorinthex/shared/ui/file-viewer";
import { LoadingText } from "@vorinthex/shared/ui/loading-text";
import { PullToRefresh } from "@vorinthex/shared/ui/pull-to-refresh";
import { highlightedSegments, searchDocumentPassagesLiteral, type DocumentPassage, type HighlightRange } from "@vorinthex/shared/ui/document-search";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";
import { Spinner } from "@vorinthex/shared/ui/spinner";
import { Skeleton } from "@vorinthex/shared/ui/skeleton";
import { Slider } from "@vorinthex/shared/ui/slider";
import { Switch } from "@vorinthex/shared/ui/switch";
import {
  ArchiveIcon,
  BrainIcon,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ClockIcon,
  EditIcon,
  FilterIcon,
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
import { normalizeCapturedPng } from "@/lib/captured-image";
import { normalizeStructurallyCoveredResources, partitionFavoriteContentSelection } from "@/lib/content-selection-ancestry";
import { ChromeIcon } from "@/components/ChromeIcon";
import { SearchHistorySheet } from "@/components/SearchHistorySheet";
import { assistantIconSource, contentPresentationIconSource } from "@/data/capability-icons";
import {
  hardDeleteContentSelection,
  askPersonalAssistant,
  clearContentDocumentAudioPlayback,
  createContentDocument,
  createContentDocumentVersion,
  createContentFolder,
  createContentMutationKey,
  createContentRecordKey,
  deleteContentSearchHistory,
  copyContentSelection,
  downloadContentDocument,
  enhanceContentDocument,
  findContentNeighbors,
  findContentDocumentSummary,
  findContentDocumentVersion,
  getContentContext,
  generateContentDocumentAudio,
  isContentContextConfigured,
  listContentDocumentVersions,
  moveContentSelection,
  renameContentDocument,
  restoreContentDocumentVersion,
  readContentDocumentSources,
  saveContentDocument,
  scanContentDocument,
  searchContentMatches,
  setContentDocumentFavorite,
  setContentFolderFavorite,
  setContentSelectionFavorite,
  uploadContentDocument,
  updateContentFolder,
  updateContentDocumentAudioPlayback,
  setContentFolderCover,
  summarizeContentDocument,
  translateContentDocument,
  type ContentDocument,
  type ContentDocumentSourceImage,
  type ContentDocumentVersion,
  type ContentDocumentAudioVersion,
  type ContentDocumentSummary,
  type ContentFolder,
  type ContentNeighbors,
  type ContentSearchHistoryItem,
  type ContentSearchDocument,
  type ContentSearchMatch,
  type ContentSearchResponse,
  type ContentSelection,
  type PersonalAssistantResponse,
} from "@/lib/content-client";
import {
  addCachedContentDocument,
  addCachedContentDocumentAudioVersion,
  addCachedContentDocumentSummary,
  addCachedContentFolder,
  clearCachedContentDocumentAudioPlayback,
  contentFolderChildren,
  contentFolderDescendantKeys,
  contentFolderStack,
  contentQueryKeys,
  getContentDocument,
  getContentDocumentAudioVersions,
  getCachedContentDocumentTopics,
  getContentDocumentSummaries,
  getContentFolderTree,
  getContentLocation,
  invalidateContentLocations,
  invalidateContentDocumentTopics,
  refreshContentDocument,
  refreshContentDocumentAudioVersions,
  refreshContentDocumentSummaries,
  refreshContentLocation,
  replaceCachedContentDocument,
  replaceCachedContentDocumentDetail,
  replaceCachedContentFolder,
  replaceCachedContentDocuments,
  replaceCachedContentFolders,
  removeCachedContentFolderLocation,
  removeCachedContentDocument,
  removeCachedContentDocumentEverywhere,
  removeCachedContentFolder,
  removeCachedContentDocumentsEverywhere,
  removeCachedContentFoldersEverywhere,
  seedCachedContentFolderLocation,
  type ContentLocation,
  updateCachedContentDocumentAudioPlayback,
  patchContentUserHiddens,
  populatedContentTab,
  type FolderContentTab,
} from "@/lib/content-query-cache";
import { getUserSearchHistory, promoteCachedUserSearchHistory, removeCachedUserSearchHistory, userSearchHistoryQueryKey } from "@/lib/user-search-history-cache";
import { compassQueryKeys, invalidateAssistantChanges } from "@/lib/workspace-query-cache";
import { saveBase64Download, saveTemporaryBase64File } from "@/lib/device-download";
import { fetchGalleryUploadStatus, uploadGalleryImages } from "@/lib/gallery-client";
import { BOOK_AUDIO_MODE } from "@/lib/book-audio";
import { audioTimelineDuration, audioTimelinePosition, formatAudioTime, resolveAudioTimelinePosition } from "@/lib/audio-playback-timeline";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";
import { useAuthStore } from "@/state/auth";
import { languageForCountryCode } from "@/lib/auth-helpers";
import { pauseOwnedPlayer } from "@/lib/audio-player-lifecycle";
import { filterByHiddenView, hideUserSource, isUserHidden, listUserHiddens, revealUserSource, type HiddenViewFilters, type UserHiddenRecord, type UserHiddenSource } from "@/lib/user-hidden-client";

type SaveState = "local" | "dirty" | "saving" | "saved" | "error";
type WorkspaceMode = "auto" | "folders" | "folder" | "editor" | "viewer";
type ArchiveSheet = "create" | "folder" | "library" | "documents" | "folders" | "searchHistory" | "filter" | "similar" | "enhance" | "transform" | "summarize" | "summaryVersions" | "summaryReader" | "historyChooser" | "documentVersions" | "versions" | "audioVersions" | "documentActions" | "documentDetails" | "deleteDocument" | "scanSources" | "destination" | "destinationBrowser" | "folderActions" | "folderDetails" | "bulkActions" | "bulkDelete";
type DocumentTransformation = "enhance" | "translate";
type DestinationAction = "upload" | "move" | "copy";
type UploadBatchItem = { id: string; mutationKey: string; file: File; name: string; mimeType: string; status: "pending" | "uploading" | "success" | "error"; error?: string };
type ProcessingScanItem = { id: string; folderKey?: string; name: string };
type NarrationChunk = { durationMs: number; url: string };
type PendingCreate = { name: string; content: string; folderKey?: string; mutationKey: string };

type NotePassage = DocumentPassage & { start?: number; end?: number };

function contentFolderPath(tree: readonly ContentFolder[], folderKey: string) {
  const byKey = new Map(tree.map((folder) => [folder.key, folder]));
  const stack: ContentFolder[] = [];
  const visited = new Set<string>();
  let cursor = byKey.get(folderKey);
  while (cursor && !visited.has(cursor.key)) {
    visited.add(cursor.key);
    stack.unshift(cursor);
    cursor = cursor.parentFolderKey ? byKey.get(cursor.parentFolderKey) : undefined;
  }
  return stack;
}

function notePassages(content: string): NotePassage[] {
  const passages: NotePassage[] = [];
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
const CONTENT_CONFLICT = "CONTENT_CONFLICT";

function folderPresentation(folder: ContentFolder) { return folder.parentFolderKey ? undefined : folder.presentation; }
function folderHasCover(folder: ContentFolder) { return Boolean(folderPresentation(folder) || folder.coverUrl); }
function FolderCover({ folder }: { folder: ContentFolder }) {
  const presentation = folderPresentation(folder);
  if (presentation) return <Image accessibilityLabel={`${folder.name} app folder`} contentFit="contain" source={contentPresentationIconSource[presentation]} style={styles.managedFolderLogo} />;
  return folder.coverUrl ? <Image contentFit="cover" source={folder.coverUrl} style={styles.folderCover} /> : null;
}

function isFavoriteContentConflict(value: unknown): value is { code: typeof CONTENT_CONFLICT; action: "update" } {
  return typeof value === "object" && value !== null && "code" in value && value.code === CONTENT_CONFLICT && "action" in value && value.action === "update";
}

function documentDisplayName(document: Pick<ContentDocument, "name" | "extension">): string {
  if (!document.extension || document.name.toLowerCase().endsWith(`.${document.extension.toLowerCase()}`)) return document.name;
  return `${document.name}.${document.extension}`;
}

function capitalizeLabel(value: string) {
  return value ? `${value.charAt(0).toLocaleUpperCase()}${value.slice(1)}` : value;
}

function generatedVersionType(version: ContentDocumentVersion): ContentDocumentVersion["type"] {
  if (version.type) return version.type;
  if (/enhanc/i.test(version.label ?? "")) return "enhancement";
  if (/translat/i.test(version.label ?? "")) return "translation";
  return undefined;
}

function plainSummaryText(value: string) {
  return value
    .replace(/<(?:analysis|thinking|reasoning)>[\s\S]*?<\/(?:analysis|thinking|reasoning)>/gi, "")
    .replace(/^```(?:markdown|text)?\s*\n?/i, "")
    .replace(/\n?```$/i, "")
    .replace(/```(?:markdown|text)?\s*([\s\S]*?)```/gi, "$1")
    .replace(/\[([^\]]+)]\([^)]+\)/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/__([^_]+)__/g, "$1")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/^[ \t]*(?:[-*•]|\d+[.)])[ \t]+/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function SummaryText({ value }: { value: string }) {
  const withoutReasoning = value.replace(/<(?:analysis|thinking|reasoning)>[\s\S]*?<\/(?:analysis|thinking|reasoning)>/gi, "").trim();
  const candidates = [...withoutReasoning.matchAll(/```(?:json)?\s*([\s\S]*?)```/gi)].map((match) => match[1]!.trim());
  const firstBrace = withoutReasoning.indexOf("{");
  const lastBrace = withoutReasoning.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(withoutReasoning.slice(firstBrace, lastBrace + 1));
  let sections: { heading?: string; body: string }[] | undefined;
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate) as { sections?: unknown };
      if (!Array.isArray(parsed.sections)) continue;
      const structured = parsed.sections.flatMap((section) => {
        if (!section || typeof section !== "object") return [];
        const { heading, body } = section as { heading?: unknown; body?: unknown };
        if (typeof heading !== "string" || typeof body !== "string" || !heading.trim() || !body.trim()) return [];
        return [{ heading: plainSummaryText(heading), body: plainSummaryText(body) }];
      });
      if (structured.length > 0) {
        sections = structured;
        break;
      }
    } catch {
      // Older summaries may be plain text rather than structured JSON.
    }
  }
  const text = plainSummaryText(withoutReasoning);
  sections ??= text.split(/\n{2,}/).filter(Boolean).map((block) => {
    const lines = block.split("\n").filter(Boolean);
    return lines.length > 1 ? { heading: lines[0], body: lines.slice(1).join("\n").trim() } : { body: lines[0] ?? "" };
  });
  if (sections.length === 0) return null;
  return <View style={styles.summarySections}>{sections.map(({ heading, body }, index) => <View key={`${heading}-${index}`} style={styles.summarySection}>
    {heading ? <Text style={styles.summarySectionTitle}>{heading}</Text> : null}
    {body ? <Text selectable style={styles.summaryText}>{body}</Text> : null}
  </View>)}</View>;
}

function ArchiveContentViewport({ children, editor, onRefresh, refreshEnabled = true, refreshing }: { children: ReactNode; editor: boolean; onRefresh: () => void | Promise<void>; refreshEnabled?: boolean; refreshing: boolean }) {
  if (editor) return <View style={[styles.scroll, styles.editorViewportContent]}>{children}</View>;
  return <ScrollView
    alwaysBounceVertical
    contentContainerStyle={styles.scroll}
    keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
    keyboardShouldPersistTaps="handled"
    refreshControl={<PullToRefresh enabled={refreshEnabled} onRefresh={onRefresh} refreshing={refreshing} />}
    showsVerticalScrollIndicator={false}
    style={styles.scrollView}
  >{children}</ScrollView>;
}

function ScannedBadge({ document }: { document: ContentDocument }) {
  return document.sourceImageCount ? <Badge accessibilityLabel={`Scanned from ${document.sourceImageCount} ${document.sourceImageCount === 1 ? "image" : "images"}`} style={styles.scannedBadge}><Text style={styles.scannedBadgeText}>Scanned</Text></Badge> : null;
}

function ProcessingDocumentButton({ name }: { name: string }) {
  return <Skeleton accessibilityLabel={`Processing ${name}`} accessibilityRole="progressbar" style={styles.documentSkeleton} />;
}

export function KnowledgeWorkspace({ initialDocumentKey, initialFolderKey, returnSignalConnectorKey, returnSignalMessageKey, returnSignalThreadKey, returnTripKey, returnTripName }: { initialDocumentKey?: string; initialFolderKey?: string; returnSignalConnectorKey?: string; returnSignalMessageKey?: string; returnSignalThreadKey?: string; returnTripKey?: string; returnTripName?: string } = {}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const notify = (title: string) => showToast({ title, duration: 2_000 });
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const archiveCardSize = Math.floor((width - spacing.md * 2 - 20) / 3);
  const destinationCardSize = Math.floor((width - 42 - 20) / 3);
  const organizationKey = useAuthStore((state) => typeof state.organization?.key === "string" ? state.organization.key : "");
  const scopeKey = useAuthStore((state) => typeof state.scope?.key === "string" ? state.scope.key : "");
  const user = useAuthStore((state) => state.user);
  const reconnectContentContext = useAuthStore((state) => state.reconnectContentContext);
  const hasContentContext = isContentContextConfigured({ organizationKey, scopeKey });
  const contentContextKey = hasContentContext ? `${organizationKey}:${scopeKey}` : "";
  const contentContext = { organizationKey, scopeKey, userKey: user?.key ?? "" };
  const cachedInitialDocument = initialDocumentKey ? queryClient.getQueryData<ContentDocument>(contentQueryKeys.document(contentContext, initialDocumentKey)) : undefined;
  const cachedTargetFolderKey = cachedInitialDocument?.folderKey ?? initialFolderKey;
  const cachedInitialTree = cachedTargetFolderKey ? queryClient.getQueryData<ContentFolder[]>(contentQueryKeys.folderTree(contentContext)) : undefined;
  const cachedInitialStack = cachedTargetFolderKey && cachedInitialTree ? contentFolderPath(cachedInitialTree, cachedTargetFolderKey) : [];
  const cachedInitialFolder = cachedInitialStack.at(-1);
  const cachedInitialLocation = cachedInitialFolder ? queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, cachedInitialFolder.key)) : undefined;
  const userHiddensQuery = useQuery({ queryKey: contentQueryKeys.userHiddens(contentContext), queryFn: listUserHiddens, enabled: hasContentContext, staleTime: 0 });
  const narrationPlayer = useAudioPlayer(null, { updateInterval: 500, keepAudioSessionActive: true });
  const narrationAudio = useAudioPlayerStatus(narrationPlayer);
  const narrationPlayerActive = useRef(true);
  const [activeSheet, setActiveSheet] = useState<ArchiveSheet>();
  const [viewFilters, setViewFilters] = useState<HiddenViewFilters>({ favoritesOnly: false, showHidden: false });
  const [userHiddens, setUserHiddens] = useState<UserHiddenRecord[]>([]);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetError, setSheetError] = useState<string>();
  const [sheetLoadError, setSheetLoadError] = useState<string>();
  const [editorFocused, setEditorFocused] = useState(false);
  const [editorEditing, setEditorEditing] = useState(false);
  const [editorContentHeight, setEditorContentHeight] = useState(280);
  const [aiInputFocused, setAiInputFocused] = useState(false);
  const [title, setTitle] = useState("Untitled document");
  const [content, setContent] = useState("");
  const [aiInstruction, setAiInstruction] = useState("");
  const [aiInstructionError, setAiInstructionError] = useState<string>();
  const [aiResponse, setAiResponse] = useState<PersonalAssistantResponse>();
  const [instructing, setInstructing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [scanOpen, setScanOpen] = useState(false);
  const [scanBusy, setScanBusy] = useState(false);
  const [scanError, setScanError] = useState<string>();
  const [scanFolderKey, setScanFolderKey] = useState<string>();
  const [processingScan, setProcessingScan] = useState<ProcessingScanItem>();
  const [uploadBatch, setUploadBatch] = useState<UploadBatchItem[]>([]);
  const [uploadFolderKey, setUploadFolderKey] = useState<string>();
  const [versions, setVersions] = useState<ContentDocumentVersion[]>([]);
  const [documentTransformation, setDocumentTransformation] = useState<DocumentTransformation>("enhance");
  const [documentTransformationPrompt, setDocumentTransformationPrompt] = useState("");
  const [translationTargetLanguage, setTranslationTargetLanguage] = useState("English");
  const [pendingDocumentVersionLabel, setPendingDocumentVersionLabel] = useState<string>();
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [audioVersions, setAudioVersions] = useState<ContentDocumentAudioVersion[]>([]);
  const [loadingAudioVersions, setLoadingAudioVersions] = useState(false);
  const [generatingDocumentAudio, setGeneratingDocumentAudio] = useState(false);
  const [selectedAudioVersionKey, setSelectedAudioVersionKey] = useState<string>();
  const [saveState, setSaveState] = useState<SaveState>(hasContentContext ? "saved" : "local");
  const [folders, setFolders] = useState<ContentFolder[]>(cachedInitialLocation?.folders ?? (cachedInitialFolder && cachedInitialTree ? contentFolderChildren(cachedInitialTree, cachedInitialFolder.key) : []));
  const [rootFolders, setRootFolders] = useState<ContentFolder[]>([]);
  const [documents, setDocuments] = useState<ContentDocument[]>(cachedInitialLocation?.documents ?? []);
  const [rootDocuments, setRootDocuments] = useState<ContentDocument[]>([]);
  const [folderStack, setFolderStack] = useState<ContentFolder[]>(cachedInitialStack);
  const [workspaceMode, setWorkspaceMode] = useState<WorkspaceMode>(cachedInitialFolder ? "folder" : "folders");
  const [folderContentTab, setFolderContentTab] = useState<FolderContentTab>("folders");
  const [similarContentTab, setSimilarContentTab] = useState<FolderContentTab>("folders");
  const [similarResults, setSimilarResults] = useState<ContentNeighbors>();
  const [similarLoading, setSimilarLoading] = useState(false);
  const [query, setQuery] = useState("");
  const [locationLoading, setLocationLoading] = useState(!cachedInitialLocation);
  const [openingDocumentKey, setOpeningDocumentKey] = useState<string>();
  const initialDocumentOpened = useRef<string | undefined>(undefined);
  const [results, setResults] = useState<ContentSearchResponse>();
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [removingHistoryQuery, setRemovingHistoryQuery] = useState<string>();
  const [selectedSummary, setSelectedSummary] = useState<ContentDocumentSummary>();
  const [selectedDocument, setSelectedDocument] = useState<ContentDocument>();
  const [filePreviewError, setFilePreviewError] = useState<string>();
  const [filePreviewUri, setFilePreviewUri] = useState<string>();
  const [documentSearchQuery, setDocumentSearchQuery] = useState("");
  const [documentSearchRevision, setDocumentSearchRevision] = useState(0);
  const [documentSearchLayoutRevision, setDocumentSearchLayoutRevision] = useState(0);
  const [narrationState, setNarrationState] = useState<"idle" | "playing" | "paused" | "ready" | "error">("idle");
  const [narrationManifest, setNarrationManifest] = useState<NarrationChunk[]>([]);
  const [narrationActiveIndex, setNarrationActiveIndex] = useState(-1);
  const [narrationTitle, setNarrationTitle] = useState("");
  const [narrationStatus, setNarrationStatus] = useState("AUDIO VERSION");
  const [narrationScrubValue, setNarrationScrubValue] = useState<number>();
  const [narrationError, setNarrationError] = useState<string>();
  const [selectedFolder, setSelectedFolder] = useState<ContentFolder>();
  const [documentActionLoading, setDocumentActionLoading] = useState<string>();
  const [sourceImages, setSourceImages] = useState<ContentDocumentSourceImage[]>([]);
  const [sourceImagesLoading, setSourceImagesLoading] = useState(false);
  const [documentDetailsName, setDocumentDetailsName] = useState("");
  const [documentDetailsFavorite, setDocumentDetailsFavorite] = useState(false);
  const [destinationAction, setDestinationAction] = useState<DestinationAction>();
  const [destinationStack, setDestinationStack] = useState<ContentFolder[]>([]);
  const [destinationFolders, setDestinationFolders] = useState<ContentFolder[]>([]);
  const [destinationUsesDirectSelection, setDestinationUsesDirectSelection] = useState(false);
  const [destinationInitialFolderKey, setDestinationInitialFolderKey] = useState<string | null>();
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
  const [librarySearchResults, setLibrarySearchResults] = useState<ContentSearchResponse>();
  const [librarySearching, setLibrarySearching] = useState(false);
  const [rootSearchQuery, setRootSearchQuery] = useState("");
  const [rootSearchResults, setRootSearchResults] = useState<ContentSearchResponse>();
  const [rootSearching, setRootSearching] = useState(false);
  const [rootSearchRevision, setRootSearchRevision] = useState(0);
  const [rootSearchFocusable, setRootSearchFocusable] = useState(true);
  const [userRefreshing, setUserRefreshing] = useState(false);
  const [folderSearchResults, setFolderSearchResults] = useState<ContentSearchResponse>();
  const [folderSearching, setFolderSearching] = useState(false);
  const [folderSearchRevision, setFolderSearchRevision] = useState(0);
  const [summaryTopics, setSummaryTopics] = useState<string[]>([]);
  const [loadingSummaryTopics, setLoadingSummaryTopics] = useState(false);
  const [summaries, setSummaries] = useState<ContentDocumentSummary[]>([]);
  const [loadingSummaries, setLoadingSummaries] = useState(false);
  const [generatingSummary, setGeneratingSummary] = useState(false);
  const [summaryReaderTopic, setSummaryReaderTopic] = useState<string>();
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
  const pendingFolderCreates = useRef(new Map<string, Promise<ContentFolder>>());
  const createVersionOnNextSave = useRef(false);
  const navigationGeneration = useRef(0);
  const destinationGeneration = useRef(0);
  const sheetCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeSheetRef = useRef<ArchiveSheet | undefined>(undefined);
  const sheetBackStack = useRef<ArchiveSheet[]>([]);
  const currentFolderKeyRef = useRef<string | undefined>(undefined);
  const selectedDocumentKeyRef = useRef<string | undefined>(undefined);
  const loadedContentContextKey = useRef<string | undefined>(undefined);
  const selectionContentContextKey = useRef(contentContextKey);
  const instructionRequest = useRef<AbortController | undefined>(undefined);
  const rootSearchRequest = useRef<AbortController | undefined>(undefined);
  const librarySearchRequest = useRef<AbortController | undefined>(undefined);
  const rootSearchInputRef = useRef<ComponentRef<typeof TextInput>>(null);
  const rootSearchFocusTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const folderSearchRequest = useRef<AbortController | undefined>(undefined);
  const similarRequest = useRef<AbortController | undefined>(undefined);
  const similarGeneration = useRef(0);
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
  const narrationDocumentKey = useRef<string | undefined>(undefined);
  const narrationAudioVersionKey = useRef<string | undefined>(undefined);
  const persistedNarrationPositionMs = useRef(0);
  const audioPlaybackWrites = useRef<Promise<void>>(Promise.resolve());
  const pendingNarrationSeek = useRef<{ index: number; seconds: number; play: boolean } | undefined>(undefined);
  const summaryRequest = useRef<AbortController | undefined>(undefined);
  const summaryLoadGeneration = useRef(0);
  const summaryMutationGeneration = useRef(0);
  const instructionGeneration = useRef(0);
  const previewFileRef = useRef<File | undefined>(undefined);
  const restoreGeneration = useRef(0);
  const transformationVersionLoadGeneration = useRef(0);
  const historyGeneration = useRef(0);
  const uploadGeneration = useRef(0);
  const scanGeneration = useRef(0);
  const uploadBatchRef = useRef<UploadBatchItem[]>([]);
  const documentActionGeneration = useRef(0);
  const documentAiActionPending = useRef(false);
  const sourceImagesGeneration = useRef(0);
  const folderActionGeneration = useRef(0);
  const bulkMutationLocked = useRef(false);
  const folderCoverRequests = useRef(new Map<string, number>());
  const longPressedItem = useRef<string | undefined>(undefined);
  const pendingNavigationAction = useRef<Parameters<typeof navigation.dispatch>[0] | undefined>(undefined);
  const pendingEditorExit = useRef(false);
  const allowNavigation = useRef(false);
  const contentContextKeyRef = useRef(contentContextKey);
  const folderStackRef = useRef(folderStack);
  const workspaceModeRef = useRef(workspaceMode);
  const refreshViewKey = useRef("");
  contentContextKeyRef.current = contentContextKey;
  folderStackRef.current = folderStack;
  workspaceModeRef.current = workspaceMode;
  const currentFolder = folderStack.at(-1);
  refreshViewKey.current = JSON.stringify([contentContextKey, workspaceMode, currentFolder?.key, folderContentTab, query.trim(), rootSearchQuery.trim(), documentKeyRef.current]);
  const returnToTripAssets = returnTripKey ? () => router.replace({ pathname: "/capability/[slug]", params: { slug: "compass", tripKey: returnTripKey, openTripAssets: "1" } }) : undefined;
  const returnToSignalAttachments = returnSignalConnectorKey && returnSignalThreadKey && returnSignalMessageKey ? () => router.replace({ pathname: "/capability/[slug]", params: { slug: "signal", connectorKey: returnSignalConnectorKey, signalReturn: "root", signalThreadKey: returnSignalThreadKey, signalMessageKey: returnSignalMessageKey, openSignalAttachments: "1" } }) : undefined;
  const showOnlyFavorites = viewFilters.favoritesOnly;
  const showHidden = viewFilters.showHidden;
  const filtersActive = showOnlyFavorites || showHidden;
  const hidden = (source: UserHiddenSource | "file", sourceKey: string) => isUserHidden(userHiddens, source, sourceKey);
  const destinationFolder = destinationStack.at(-1);
  const contentSelection: ContentSelection = { folderKeys: selectedFolders.map(({ key }) => key), documentKeys: selectedDocuments.map(({ key }) => key) };
  const selectedCount = selectedFolders.length + selectedDocuments.length;
  const selectionActive = selectedCount > 0;
  const compactDelete = activeSheet === "bulkDelete" || activeSheet === "deleteDocument";
  const bulkDeleteNoun = selectedFolders.length === selectedCount ? "folder" : selectedDocuments.length === selectedCount && selectedDocuments.every(({ extension }) => extension) ? "file" : selectedDocuments.length === selectedCount && selectedDocuments.every(({ extension }) => !extension) ? "document" : "item";
  const deleteConfirmationTitle = activeSheet === "deleteDocument"
    ? `Delete ${selectedDocument?.extension ? "file" : "document"}?`
    : `Delete ${selectedCount} ${bulkDeleteNoun}${selectedCount === 1 ? "" : "s"}?`;
  const allSelectedFavorite = selectionActive && [...selectedFolders, ...selectedDocuments].every((item) => Boolean(item.isFavorite));
  const selectionHasManaged = [...selectedFolders, ...selectedDocuments].some((item) => item.managed);
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
  const filteredRootFolders = filterByHiddenView(rootFolders, userHiddens, "folder", viewFilters);
  const filteredFolders = filterByHiddenView(folders, userHiddens, "folder", viewFilters);
  const filteredRootDocuments = filterByHiddenView(rootDocuments, userHiddens, "document", viewFilters);
  const filteredDocuments = filterByHiddenView(documents, userHiddens, "document", viewFilters);
  const librarySearchFolders = filterByHiddenView(librarySearchResults?.folders ?? [], userHiddens, "folder", viewFilters);
  const librarySearchDocuments = filterByHiddenView(librarySearchResults?.documents ?? [], userHiddens, "document", viewFilters, ({ documentKey }) => documentKey);
  const visibleFolders = libraryQuery.trim() ? librarySearchFolders : filteredRootFolders;
  const visibleDocuments = libraryQuery.trim() ? librarySearchDocuments : filteredRootDocuments;
  const rootNotes = filteredRootDocuments.filter((document) => !document.extension);
  const rootFiles = filteredRootDocuments.filter((document) => Boolean(document.extension));
  const folderNotes = filteredDocuments.filter((document) => !document.extension);
  const folderFiles = filteredDocuments.filter((document) => Boolean(document.extension));
  const rootTabDocuments = folderContentTab === "files" ? rootFiles : rootNotes;
  const folderTabDocuments = folderContentTab === "files" ? folderFiles : folderNotes;
  const folderSearchFolders = filterByHiddenView(folderSearchResults?.folders ?? [], userHiddens, "folder", viewFilters);
  const folderSearchDocuments = filterByHiddenView(folderSearchResults?.documents ?? [], userHiddens, "document", viewFilters, ({ documentKey }) => documentKey).filter((document) => folderContentTab === "files" ? Boolean(document.extension) : !document.extension);
  const rootSearchFolders = filterByHiddenView(rootSearchResults?.folders ?? [], userHiddens, "folder", viewFilters);
  const rootSearchDocuments = filterByHiddenView(rootSearchResults?.documents ?? [], userHiddens, "document", viewFilters, ({ documentKey }) => documentKey).filter((document) => folderContentTab === "files" ? Boolean(document.extension) : !document.extension);
  const similarFolders = filterByHiddenView(similarResults?.folders ?? [], userHiddens, "folder", viewFilters);
  const similarTabDocuments = filterByHiddenView(similarContentTab === "files" ? similarResults?.files ?? [] : similarResults?.documents ?? [], userHiddens, "document", viewFilters);
  const currentNotePassages = useMemo(() => notePassages(content), [content]);
  const documentSearchMatches = useMemo(() => editorEditing ? [] : searchDocumentPassagesLiteral(currentNotePassages, documentSearchQuery), [currentNotePassages, documentSearchQuery, editorEditing]);
  const documentSearchMatchesById = useMemo(() => new Map(documentSearchMatches.map((match) => [match.id, match])), [documentSearchMatches]);
  const documentSearchTargetId = documentSearchMatches[0]?.id;
  const visibleUploadBatch = uploadFolderKey === currentFolder?.key
    ? uploadBatch.filter(({ status }) => status === "pending" || status === "uploading")
    : [];
  const visibleProcessingScan = processingScan?.folderKey === currentFolder?.key ? processingScan : undefined;
  const destinationTargetKey = destinationFolder?.key ?? null;
  const destinationAtInitialLocation = destinationInitialFolderKey !== undefined && destinationTargetKey === destinationInitialFolderKey;
  const destinationIsBlocked = typeof destinationTargetKey === "string" && destinationBlockedFolderKeys.includes(destinationTargetKey);
  const showArchiveRoot = !libraryQuery.trim() || "delete".includes(libraryQuery.trim().toLowerCase());
  const narrationDuration = audioTimelineDuration(narrationManifest);
  const narrationPlayerElapsed = audioTimelinePosition(narrationManifest, narrationActiveIndex, narrationAudio.currentTime);
  const narrationElapsed = narrationScrubValue ?? narrationPlayerElapsed;

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

  const stopNarration = useCallback((invalidatePlayback = true) => {
    if (invalidatePlayback) narrationPlaybackGeneration.current += 1;
    narrationChunks.current = [];
    narrationChunkIndex.current = -1;
    narrationTitleRef.current = "";
    narrationDocumentKey.current = undefined;
    narrationAudioVersionKey.current = undefined;
    pendingNarrationSeek.current = undefined;
    lastFinishedNarrationChunk.current = -1;
    pauseOwnedPlayer(narrationPlayer, narrationPlayerActive.current);
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

  const queueAudioPlaybackUpdate = (audioVersionKey: string, documentKey: string, playbackPositionMs: number) => {
    const operation = audioPlaybackWrites.current.catch(() => undefined).then(async () => {
      await updateContentDocumentAudioPlayback(audioVersionKey, playbackPositionMs);
      updateCachedContentDocumentAudioPlayback(queryClient, contentContext, documentKey, audioVersionKey, playbackPositionMs);
    });
    audioPlaybackWrites.current = operation.catch(() => undefined);
    return operation;
  };

  const dismissNarration = () => {
    const documentKey = narrationDocumentKey.current;
    if (documentKey) {
      clearCachedContentDocumentAudioPlayback(queryClient, contentContext, documentKey);
      setAudioVersions((current) => current.map((version) => ({ ...version, isCurrent: false })));
      const operation = audioPlaybackWrites.current.catch(() => undefined).then(async () => {
        await clearContentDocumentAudioPlayback(documentKey);
      });
      audioPlaybackWrites.current = operation.catch(() => undefined);
      void operation.catch(() => notify("Audio resume state could not be cleared"));
    }
    stopNarration();
  };

  const persistNarrationPosition = () => {
    const audioVersionKey = narrationAudioVersionKey.current;
    const documentKey = narrationDocumentKey.current;
    if (!audioVersionKey || !documentKey) return;
    const playbackPositionMs = Math.round(narrationElapsed * 1_000);
    persistedNarrationPositionMs.current = playbackPositionMs;
    void queueAudioPlaybackUpdate(audioVersionKey, documentKey, playbackPositionMs).catch(() => setNarrationError("Playback progress could not be saved."));
  };

  const toggleNarration = () => {
    if (narrationStateRef.current === "playing") {
      pauseOwnedPlayer(narrationPlayer, narrationPlayerActive.current);
      updateNarrationState("paused");
      persistNarrationPosition();
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

  useEffect(() => {
    const audioVersionKey = narrationAudioVersionKey.current;
    const documentKey = narrationDocumentKey.current;
    if (!narrationAudio.playing || !audioVersionKey || !documentKey) return;
    const playbackPositionMs = Math.round(narrationElapsed * 1_000);
    if (Math.abs(playbackPositionMs - persistedNarrationPositionMs.current) < 5_000) return;
    persistedNarrationPositionMs.current = playbackPositionMs;
    void queueAudioPlaybackUpdate(audioVersionKey, documentKey, playbackPositionMs).catch(() => setNarrationError("Playback progress could not be saved."));
  }, [narrationAudio.playing, narrationElapsed]);

  const seekNarration = (seconds: number) => {
    if (narrationChunks.current.length === 0) return;
    const target = resolveAudioTimelinePosition(narrationChunks.current, seconds);
    const playbackPositionMs = Math.round(Math.min(audioTimelineDuration(narrationChunks.current), Math.max(0, seconds)) * 1_000);
    const audioVersionKey = narrationAudioVersionKey.current;
    const documentKey = narrationDocumentKey.current;
    if (audioVersionKey && documentKey) {
      persistedNarrationPositionMs.current = playbackPositionMs;
      void queueAudioPlaybackUpdate(audioVersionKey, documentKey, playbackPositionMs).catch(() => setNarrationError("Playback progress could not be saved."));
    }
    const shouldPlay = narrationStateRef.current === "playing";
    if (target.index === narrationChunkIndex.current) {
      void narrationPlayer.seekTo(target.seconds).catch(() => {
        setNarrationScrubValue(undefined);
        setNarrationError("The audio position could not be changed.");
      });
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
    }).catch(() => {
      setNarrationScrubValue(undefined);
      setNarrationError("The audio position could not be changed.");
    });
  }, [narrationAudio.isLoaded, narrationPlayer]);

  useEffect(() => {
    if (narrationScrubValue === undefined || pendingNarrationSeek.current) return;
    if (Math.abs(narrationPlayerElapsed - narrationScrubValue) > 0.75) return;
    const timeout = setTimeout(() => setNarrationScrubValue(undefined), 0);
    return () => clearTimeout(timeout);
  }, [narrationPlayerElapsed, narrationScrubValue]);

  useEffect(() => {
    if (!narrationAudio.didJustFinish) return;
    const current = narrationChunkIndex.current;
    if (current < 0 || lastFinishedNarrationChunk.current === current) return;
    lastFinishedNarrationChunk.current = current;
    if (playNarrationChunk(current + 1)) return;
    narrationPlayer.clearLockScreenControls();
    updateNarrationState("ready");
    const audioVersionKey = narrationAudioVersionKey.current;
    const documentKey = narrationDocumentKey.current;
    if (audioVersionKey && documentKey) {
      persistedNarrationPositionMs.current = 0;
      void queueAudioPlaybackUpdate(audioVersionKey, documentKey, 0).catch(() => setNarrationError("Playback progress could not be saved."));
    }
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

  useEffect(() => {
    selectedDocumentKeyRef.current = selectedDocument?.key;
  }, [selectedDocument?.key]);

  const openSheet = (sheet: ArchiveSheet) => {
    rootSearchInputRef.current?.blur();
    Keyboard.dismiss();
    if (sheetCloseTimer.current) clearTimeout(sheetCloseTimer.current);
    setSheetError(undefined);
    setSheetLoadError(undefined);
    sheetBackStack.current = [];
    activeSheetRef.current = sheet;
    setActiveSheet(sheet);
    setSheetOpen(true);
  };

  const pushSheet = (sheet: ArchiveSheet) => {
    const current = activeSheetRef.current;
    if (current) sheetBackStack.current.push(current);
    setSheetError(undefined);
    setSheetLoadError(undefined);
    activeSheetRef.current = sheet;
    setActiveSheet(sheet);
  };

  const goBackSheet = () => {
    const previous = sheetBackStack.current.pop();
    if (!previous) return;
    if (activeSheetRef.current === "summaryReader" && narrationStatus === "SUMMARY AUDIO") stopNarration();
    if (activeSheetRef.current === "similar") {
      similarGeneration.current += 1;
      similarRequest.current?.abort();
      similarRequest.current = undefined;
      setSimilarLoading(false);
    }
    if (activeSheetRef.current === "scanSources") sourceImagesGeneration.current += 1;
    if (temporarySingleSelection && (activeSheetRef.current === "destinationBrowser" || activeSheetRef.current === "bulkDelete")) {
      clearSelection();
      setTemporarySingleSelection(false);
      setDestinationUsesDirectSelection(false);
    }
    setSheetError(undefined);
    setSheetLoadError(undefined);
    activeSheetRef.current = previous;
    setActiveSheet(previous);
  };

  const closeSheet = (preserveSelection = false) => {
    rootSearchInputRef.current?.blur();
    Keyboard.dismiss();
    if (activeSheetRef.current === "summaryReader" && narrationStatus === "SUMMARY AUDIO") stopNarration();
    if (activeSheetRef.current === "searchHistory") historyGeneration.current += 1;
    if (activeSheetRef.current === "similar") {
      similarGeneration.current += 1;
      similarRequest.current?.abort();
      similarRequest.current = undefined;
      setSimilarLoading(false);
    }
    if (activeSheetRef.current === "scanSources") sourceImagesGeneration.current += 1;
    if (activeSheetRef.current === "destination" || activeSheetRef.current === "destinationBrowser") {
      destinationGeneration.current += 1;
      if (!preserveSelection && destinationUsesDirectSelection) clearSelection();
      setDestinationUsesDirectSelection(false);
      setDestinationStack([]);
      setDestinationFolders([]);
      setDestinationInitialFolderKey(undefined);
      setDestinationBlockedFolderKeys([]);
      setDestinationLoading(false);
      setDestinationAction(undefined);
    }
    if (!preserveSelection && temporarySingleSelection) clearSelection();
    setTemporarySingleSelection(false);
    if (activeSheetRef.current === "documentActions" || activeSheetRef.current === "documentDetails") documentActionGeneration.current += 1;
    if (activeSheetRef.current === "folderActions" || activeSheetRef.current === "folderDetails") folderActionGeneration.current += 1;
    setSheetOpen(false);
    activeSheetRef.current = undefined;
    sheetBackStack.current = [];
    if (sheetCloseTimer.current) clearTimeout(sheetCloseTimer.current);
    sheetCloseTimer.current = setTimeout(() => setActiveSheet(undefined), 240);
  };

  useEffect(() => () => {
    narrationPlayerActive.current = false;
    if (sheetCloseTimer.current) clearTimeout(sheetCloseTimer.current);
    if (rootSearchFocusTimer.current) clearTimeout(rootSearchFocusTimer.current);
    instructionRequest.current?.abort();
    summaryRequest.current?.abort();
    similarRequest.current?.abort();
    previewFileRef.current?.delete();
  }, []);

  function completeEditorExit() {
    Keyboard.dismiss();
    persistNarrationPosition();
    stopNarration();
    setDocumentSearchQuery("");
    const nextMode = folderStackRef.current.length ? "folder" : "folders";
    workspaceModeRef.current = nextMode;
    setWorkspaceMode(nextMode);
  }

  useEffect(() => navigation.addListener("beforeRemove", (event) => {
    if (allowNavigation.current) {
      allowNavigation.current = false;
      return;
    }
    if (!hasContentContext || (saveState !== "dirty" && saveState !== "saving")) return;
    event.preventDefault();
    pendingNavigationAction.current = event.data.action;
    saveImmediately.current = true;
    setSaveRetry((current) => current + 1);
  }), [hasContentContext, navigation, saveState]);

  useEffect(() => {
    if (saveState !== "saved" && saveState !== "local") return;
    if (pendingEditorExit.current) {
      pendingEditorExit.current = false;
      completeEditorExit();
    }
    if (pendingNavigationAction.current) {
      const action = pendingNavigationAction.current;
      pendingNavigationAction.current = undefined;
      allowNavigation.current = true;
      navigation.dispatch(action);
    }
  }, [navigation, saveState]);

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

  const refreshArchive = async () => {
    if (!hasContentContext || userRefreshing) return;
    const viewKey = refreshViewKey.current;
    const navigationRequest = navigationGeneration.current;
    const isCurrent = () => refreshViewKey.current === viewKey && navigationGeneration.current === navigationRequest;
    setUserRefreshing(true);
    setError(undefined);
    try {
      if (workspaceMode === "editor") {
        const documentKey = documentKeyRef.current;
        const session = editorSession.current;
        const startingRevision = revision.current;
        if (!documentKey || editorEditing || dirty.current || saveState === "dirty" || saveState === "saving") return;
        const document = await refreshContentDocument(queryClient, contentContext, documentKey);
        if (isCurrent() && session === editorSession.current && startingRevision === revision.current && documentKeyRef.current === documentKey && !dirty.current) applyRemoteDocument(document);
        return;
      }

      const folderKey = workspaceMode === "folder" ? currentFolder?.key : undefined;
      const pendingFolder = folderKey ? pendingFolderCreates.current.get(folderKey) : undefined;
      if (pendingFolder) await pendingFolder;
      if (!isCurrent()) return;
      const normalizedSearch = workspaceMode === "folder" ? query.trim() : rootSearchQuery.trim();
      const controller = new AbortController();
      if (workspaceMode === "folder") folderSearchRequest.current?.abort();
      else rootSearchRequest.current?.abort();
      const [matches, location] = await Promise.all([
        normalizedSearch ? searchContentMatches(normalizedSearch, controller.signal, folderKey, false) : undefined,
        refreshContentLocation(queryClient, contentContext, folderKey),
        userHiddensQuery.refetch(),
      ]);
      if (!isCurrent()) return;
      setFolders(location.folders);
      if (!folderKey) {
        setRootFolders(location.folders);
        setRootDocuments(location.documents);
      }
      setDocuments(location.documents);
      if (matches) {
        if (workspaceMode === "folder") setFolderSearchResults(matches);
        else setRootSearchResults(matches);
      }
    } catch (cause) {
      if (isCurrent()) setError(cause instanceof Error ? cause.message : "Archive could not be refreshed.");
    } finally {
      setUserRefreshing(false);
    }
  };

  useEffect(() => { if (userHiddensQuery.data) setUserHiddens(userHiddensQuery.data); }, [userHiddensQuery.data]);

  function setHiddenOptimistically(source: "folder" | "document", sourceKey: string, shouldHide: boolean, label: "Folder" | "Document" | "File") {
    const previous = userHiddens;
    const optimistic: UserHiddenRecord = { key: `optimistic-${source}-${sourceKey}`, userKey: "optimistic", source, sourceKey, createdAt: new Date().toISOString() };
    const next = shouldHide
      ? [...previous.filter((record) => record.source !== source || record.sourceKey !== sourceKey), optimistic]
      : previous.filter((record) => record.source !== source || record.sourceKey !== sourceKey);
    setUserHiddens(next);
    patchContentUserHiddens(queryClient, contentContext, () => next);
    closeSheet();
    notify(`${label} ${shouldHide ? "hidden" : "revealed"}`);
    void (shouldHide ? hideUserSource(source, sourceKey) : revealUserSource(source, sourceKey)).then((result) => {
      if (shouldHide && result) {
        setUserHiddens((current) => current.map((record) => record.key === optimistic.key ? result : record));
        patchContentUserHiddens(queryClient, contentContext, (current) => current.map((record) => record.key === optimistic.key ? result : record));
      }
    }).catch(() => {
      setUserHiddens(previous);
      patchContentUserHiddens(queryClient, contentContext, () => previous);
      notify(`${label} ${shouldHide ? "hide" : "reveal"} failed`);
    }).finally(() => {
      void Promise.all([
        queryClient.invalidateQueries({ queryKey: contentQueryKeys.userHiddens(contentContext), exact: true }),
        queryClient.invalidateQueries({ queryKey: contentQueryKeys.folderTree(contentContext), exact: true, refetchType: "none" }),
        queryClient.invalidateQueries({ queryKey: contentQueryKeys.locations(contentContext), refetchType: "none" }),
      ]);
    });
  }

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
    setDestinationAction(undefined);
    setDestinationLoading(false);
    setDestinationUsesDirectSelection(false);
    setTemporarySingleSelection(false);
    setBulkLoading(false);
    setViewFilters({ favoritesOnly: false, showHidden: false });
    setUserHiddens([]);
    longPressedItem.current = undefined;
  }, [contentContextKey]);

  useEffect(() => {
    if (!hasContentContext) {
      if (loadedContentContextKey.current) {
        destinationGeneration.current += 1;
        stopNarration();
        previewFileRef.current?.delete();
        previewFileRef.current = undefined;
        setFilePreviewUri(undefined);
        setFilePreviewError(undefined);
        setDocumentSearchQuery("");
        setSelectedFolders([]);
        setSelectedDocuments([]);
        setHydratingFolderKeys([]);
        setHydratingDocumentKeys([]);
        setDestinationStack([]);
        setDestinationFolders([]);
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
      setFilePreviewUri(undefined);
      setFilePreviewError(undefined);
      navigationGeneration.current += 1;
      destinationGeneration.current += 1;
      documentActionGeneration.current += 1;
      folderActionGeneration.current += 1;
      restoreGeneration.current += 1;
      uploadGeneration.current += 1;
      scanGeneration.current += 1;
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
      setUploading(false);
      uploadBatchRef.current = [];
      setUploadBatch([]);
      setUploadFolderKey(undefined);
      setScanBusy(false);
      setProcessingScan(undefined);
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
      setDocumentSearchQuery("");
      setSelectedFolder(undefined);
      setSelectedFolders([]);
      setSelectedDocuments([]);
      setHydratingFolderKeys([]);
      setHydratingDocumentKeys([]);
      setDestinationStack([]);
      setDestinationFolders([]);
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
      const treeRequest = getContentFolderTree(queryClient, contentContext);
      void treeRequest.then((tree) => {
        if (contentContextKeyRef.current !== requestContextKey) return;
        const rootChildren = contentFolderChildren(tree);
        setRootFolders(rootChildren);
        if (workspaceModeRef.current === "folders") setFolders(rootChildren);
      }).catch(() => {});
      const [root, tree] = await Promise.all([getContentLocation(queryClient, contentContext), treeRequest]);
      const initialDocument = initialDocumentKey ? await getContentDocument(queryClient, contentContext, initialDocumentKey) : undefined;
      const targetFolderKey = initialDocument?.folderKey ?? initialFolderKey;
      if (targetFolderKey) {
        const target = tree.find(({ key }) => key === targetFolderKey);
        if (target) {
          const stack = contentFolderPath(tree, target.key);
          return { initial: { root, location: await getContentLocation(queryClient, contentContext, target.key), initialFolder: target }, useInitialFolder: true, initialStack: stack };
        }
      }
      return { initial: { root, location: root, initialFolder: undefined }, useInitialFolder: false, initialStack: undefined };
    })()
      .then(({ initial, useInitialFolder, initialStack }) => {
        if (contentContextKeyRef.current !== requestContextKey) return;
        const location = useInitialFolder ? initial.location : initial.root;
        setFolders(location.folders);
        setRootFolders(initial.root.folders);
        setDocuments(location.documents);
        setRootDocuments(initial.root.documents);
        setFolderStack(initialStack ?? (useInitialFolder && initial.initialFolder ? [initial.initialFolder] : []));
        if (initialStack) {
          workspaceModeRef.current = "folder";
          setWorkspaceMode("folder");
        } else if (workspaceModeRef.current === "auto") {
          const nextMode = initial.initialFolder ? "folder" : "folders";
          workspaceModeRef.current = nextMode;
          setWorkspaceMode(nextMode);
        }
        setLocationLoading(false);
      })
      .catch((cause: unknown) => {
        if (contentContextKeyRef.current === requestContextKey) {
          setError(cause instanceof Error ? cause.message : "Knowledge could not connect.");
          setLocationLoading(false);
        }
      });
  }, [contentContextKey, hasContentContext, initialDocumentKey, initialFolderKey, stopNarration]);

  const queueDocumentSave = (session = editorSession.current) => {
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
      let activeCurrentVersionKey = activeDocument?.currentVersionKey ?? null;
      if (!activeKey) {
        if (!nextContent.trim()) {
          dirty.current = false;
          setSaveState(nextTitle === savedTitleRef.current ? "saved" : "local");
          return;
        }
        pendingCreate.current ??= { name: nextTitle, content: nextContent, folderKey: currentFolder?.key, mutationKey: createContentMutationKey() };
        const pending = pendingCreate.current;
        const pendingFolder = pending.folderKey ? pendingFolderCreates.current.get(pending.folderKey) : undefined;
        if (pendingFolder) await pendingFolder;
        const created = await createContentDocument(pending.name, pending.content, pending.folderKey, pending.mutationKey);
        if (session !== editorSession.current) return;
        addCachedContentDocument(queryClient, contentContext, pending.folderKey, created);
        if (currentFolderKeyRef.current === pending.folderKey) {
          const addDocument = (current: ContentDocument[]) => [created, ...current.filter(({ key }) => key !== created.key)];
          setDocuments(addDocument);
          if (!pending.folderKey) setRootDocuments(addDocument);
        }
        pendingCreate.current = undefined;
        activeKey = created.key;
        activeUpdatedAt = created.updatedAt;
        activeCurrentVersionKey = created.currentVersionKey ?? null;
        documentKeyRef.current = created.key;
        updatedAtRef.current = created.updatedAt;
        savedTitleRef.current = pending.name;
        savedContentRef.current = pending.content;
      }
      const topicSourceChanged = Boolean(activeKey && (nextContent !== savedContentRef.current || nextTitle !== savedTitleRef.current));
      if (activeKey && nextContent !== savedContentRef.current) {
        const shouldCreateVersion = createVersionOnNextSave.current;
        const saved = await saveContentDocument(activeKey, nextContent, activeUpdatedAt!, shouldCreateVersion);
        if (session !== editorSession.current) return;
        if (shouldCreateVersion) createVersionOnNextSave.current = false;
        activeUpdatedAt = saved.updatedAt;
        activeCurrentVersionKey = saved.currentVersionKey ?? null;
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
      if (activeKey && topicSourceChanged) await invalidateContentDocumentTopics(queryClient, contentContext, activeKey);
      updatedAtRef.current = activeUpdatedAt;
      savedTitleRef.current = nextTitle;
      savedContentRef.current = nextContent;
      setError(undefined);
      if (titleRef.current.trim().length === 0) {
        titleRef.current = nextTitle;
        setTitle(nextTitle);
      }
      if (savingRevision === revision.current) {
        dirty.current = false;
        setSaveState("saved");
      } else {
        setSaveState("dirty");
      }
      if (activeKey) queryClient.setQueryData(contentQueryKeys.document(contentContext, activeKey), (cached: (ContentDocument & { content: string }) | undefined) => ({
        ...cached,
        key: activeKey,
        name: nextTitle,
        folderKey: currentFolder?.key,
        isFavorite: cached?.isFavorite ?? activeDocument?.isFavorite ?? false,
        currentVersionKey: activeCurrentVersionKey,
        updatedAt: activeUpdatedAt!,
        content: nextContent,
      }));
      await invalidateContentLocations(queryClient, contentContext, [currentFolder?.key]).catch(() => undefined);
      await loadLocation(currentFolder?.key).catch(() => undefined);
    })().catch((cause: unknown) => {
      if (session === editorSession.current) {
        setSaveState("error");
        setError(cause instanceof Error ? cause.message : "The document could not be saved.");
      }
      throw cause;
    });
    saveInFlight.current = save;
    void save.then(() => {
      if (saveInFlight.current === save) saveInFlight.current = null;
    }, () => {
      if (saveInFlight.current === save) saveInFlight.current = null;
    });
    return save;
  };

  const flushDocumentSave = async () => {
    const session = editorSession.current;
    while (dirty.current || saveInFlight.current) {
      await queueDocumentSave(session);
      if (session !== editorSession.current) throw new Error("The open document changed before it could be saved.");
    }
    if (!documentKeyRef.current) throw new Error("The document could not be saved.");
    return documentKeyRef.current;
  };

  useEffect(() => {
    if (!hasContentContext || !dirty.current) return;
    const session = editorSession.current;
    const delay = saveImmediately.current || !documentKeyRef.current ? 0 : 500;
    saveImmediately.current = false;
    const timeout = setTimeout(() => { void queueDocumentSave(session).catch(() => undefined); }, delay);
    return () => clearTimeout(timeout);
  }, [content, contentContextKey, currentFolder?.key, hasContentContext, saveRetry, title]);

  const markDirty = () => {
    revision.current += 1;
    dirty.current = true;
    setSaveState(hasContentContext ? "dirty" : "local");
    if (saveState === "error") setError(undefined);
  };

  const openEnhanceSheet = () => {
    if (activeDocument?.managed) return;
    openSheet("enhance");
  };

  const openSummarizeSheet = () => {
    const activeKey = documentKeyRef.current;
    const document = activeKey
      ? activeDocument?.key === activeKey ? activeDocument : { key: activeKey, name: titleRef.current, isFavorite: false, updatedAt: updatedAtRef.current ?? new Date().toISOString() }
      : selectedDocument;
    if (document?.managed) return;
    if (!document?.key) return;
    setSelectedDocument(document);
    selectedDocumentKeyRef.current = document.key;
    setSelectedSummary(undefined);
    setSummaryReaderTopic(undefined);
    setSummaryTopics([]);
    setSummaries([]);
    if (sheetOpen) pushSheet("summarize");
    else openSheet("summarize");
    void loadSummaryTopics(document.key);
  };

  const loadSummaryTopics = async (targetDocumentKey?: string) => {
    const documentKey = targetDocumentKey ?? selectedDocument?.key ?? documentKeyRef.current;
    if (!documentKey) return;
    const generation = ++summaryLoadGeneration.current;
    setSummaryTopics([]);
    setLoadingSummaryTopics(true);
    setSheetError(undefined);
    setSheetLoadError(undefined);
    try {
      await invalidateContentDocumentTopics(queryClient, contentContext, documentKey);
      const topics = await getCachedContentDocumentTopics(queryClient, contentContext, documentKey);
      if (generation === summaryLoadGeneration.current && selectedDocumentKeyRef.current === documentKey) setSummaryTopics(topics);
    } catch (cause) {
      if (generation === summaryLoadGeneration.current && activeSheetRef.current === "summarize" && selectedDocumentKeyRef.current === documentKey) setSheetLoadError(cause instanceof Error ? cause.message : "Document topics could not be generated.");
    } finally {
      if (generation === summaryLoadGeneration.current) setLoadingSummaryTopics(false);
    }
  };

  const openSummaryVersionHistory = async (targetDocument?: ContentDocument) => {
    const document = targetDocument ?? selectedDocument ?? activeDocument;
    if (!document?.key) {
      setSheetError("Save the document before opening summary versions.");
      return;
    }
    if (targetDocument) {
      setSelectedDocument(targetDocument);
      selectedDocumentKeyRef.current = targetDocument.key;
    }
    const generation = ++summaryLoadGeneration.current;
    if (targetDocument) openSheet("summaryVersions");
    else if (sheetOpen) pushSheet("summaryVersions");
    else openSheet("summaryVersions");
    setSelectedSummary(undefined);
    setSummaries([]);
    setLoadingSummaries(true);
    setSheetError(undefined);
    try {
      const history = await refreshContentDocumentSummaries(queryClient, contentContext, document.key);
      if (generation === summaryLoadGeneration.current && selectedDocumentKeyRef.current === document.key) setSummaries(history);
    } catch (cause) {
      if (generation === summaryLoadGeneration.current && activeSheetRef.current === "summaryVersions" && selectedDocumentKeyRef.current === document.key) setSheetLoadError(cause instanceof Error ? cause.message : "Summary versions could not be loaded.");
    } finally {
      if (generation === summaryLoadGeneration.current) setLoadingSummaries(false);
    }
  };

  const generateSummaryForTopic = async (topic: string) => {
    const document = selectedDocument ?? activeDocument;
    if (!document?.key || document.managed || generatingSummary) return;
    const generation = ++summaryMutationGeneration.current;
    const controller = new AbortController();
    summaryRequest.current?.abort();
    summaryRequest.current = controller;
    pushSheet("summaryReader");
    setSummaryReaderTopic(topic);
    setSelectedSummary(undefined);
    setGeneratingSummary(true);
    setSheetError(undefined);
    setSheetLoadError(undefined);
    const historyRequest = getContentDocumentSummaries(queryClient, contentContext, document.key).then(() => true, () => false);
    try {
      const summary = await summarizeContentDocument(document.key, topic, controller.signal);
      const historyLoaded = await historyRequest;
      const cached = addCachedContentDocumentSummary(queryClient, contentContext, summary);
      if (!historyLoaded) void queryClient.invalidateQueries({ queryKey: contentQueryKeys.summaries(contentContext, document.key), exact: true, refetchType: "none" });
      if (!controller.signal.aborted && generation === summaryMutationGeneration.current && selectedDocumentKeyRef.current === document.key) {
        setSummaries(queryClient.getQueryData<ContentDocumentSummary[]>(contentQueryKeys.summaries(contentContext, document.key)) ?? [cached]);
        setSelectedSummary(cached);
      }
    } catch (cause) {
      if (!controller.signal.aborted && generation === summaryMutationGeneration.current && activeSheetRef.current === "summaryReader" && selectedDocumentKeyRef.current === document.key) setSheetLoadError(cause instanceof Error ? cause.message : "The document summary could not be created.");
    } finally {
      if (summaryRequest.current === controller) summaryRequest.current = undefined;
      if (generation === summaryMutationGeneration.current) {
        setGeneratingSummary(false);
      }
    }
  };

  const openSummaryReader = (summary: ContentDocumentSummary) => {
    setSheetError(undefined);
    setSelectedSummary(summary);
    setSummaryReaderTopic(summary.topic);
    pushSheet("summaryReader");
  };

  const openDocumentTransformation = (action: DocumentTransformation) => {
    const documentKey = documentKeyRef.current;
    if (!documentKey) return;
    if (activeDocument?.key === documentKey && activeDocument.managed) return;
    const generation = ++transformationVersionLoadGeneration.current;
    const language = languageForCountryCode(user?.countryCode);
    setDocumentTransformation(action);
    setTranslationTargetLanguage(language);
    setDocumentTransformationPrompt(action === "enhance"
      ? "Correct wording, grammar, punctuation, and spelling. Repair or remove nonsensical words, stray characters, and OCR artifacts. Reflow artificial short lines into natural sentences and paragraphs while preserving intentional headings, lists, meaning, facts, and tone."
      : `Translate this document to ${language} while preserving its meaning, facts, tone, and structure.`);
    setVersions([]);
    setLoadingVersions(true);
    pushSheet("versions");
    requestAnimationFrame(() => { void (async () => {
      try {
        const history = await listContentDocumentVersions(documentKey);
        if (generation === transformationVersionLoadGeneration.current && documentKeyRef.current === documentKey && activeSheetRef.current === "versions") setVersions(history.filter((version) => generatedVersionType(version) === (action === "enhance" ? "enhancement" : "translation")));
      } catch (cause) {
        if (activeSheetRef.current === "versions") setSheetLoadError(cause instanceof Error ? cause.message : "Versions could not be loaded.");
      } finally {
        if (generation === transformationVersionLoadGeneration.current && documentKeyRef.current === documentKey) setLoadingVersions(false);
      }
    })(); });
  };

  const requestDocumentAiAction = async (action: "summarize" | DocumentTransformation) => {
    if (documentAiActionPending.current) return;
    if (!contentRef.current.trim()) {
      notify("Enter some text before using an AI action.");
      return;
    }
    const session = editorSession.current;
    documentAiActionPending.current = true;
    try {
      await flushDocumentSave();
      if (session !== editorSession.current) return;
      if (!contentRef.current.trim()) {
        notify("Enter some text before using an AI action.");
        return;
      }
      if (action === "summarize") openSummarizeSheet();
      else openDocumentTransformation(action);
    } catch {
      notify("Save this document before using an AI action.");
    } finally {
      documentAiActionPending.current = false;
    }
  };

  const updateTranslationTargetLanguage = (language: string) => {
    setTranslationTargetLanguage(language);
    setDocumentTransformationPrompt(`Translate this document to ${language.trim()} while preserving its meaning, facts, tone, and structure.`);
  };

  const generateDocumentTransformation = async () => {
    const action = documentTransformation;
    const documentKey = documentKeyRef.current;
    const prompt = documentTransformationPrompt.trim();
    const expectedUpdatedAt = updatedAtRef.current;
    const session = editorSession.current;
    if (!documentKey || !prompt || !expectedUpdatedAt || documentActionLoading) return;
    const pendingLabel = action === "enhance" ? "Enhancing version..." : "Translating version...";
    setDocumentActionLoading(action);
    setPendingDocumentVersionLabel(pendingLabel);
    setSheetError(undefined);
    setSheetLoadError(undefined);
    if (activeSheetRef.current === "transform") goBackSheet();
    try {
      const targetLanguage = action === "translate" ? translationTargetLanguage.trim() || languageForCountryCode(user?.countryCode) : undefined;
      const generated = action === "enhance"
        ? await enhanceContentDocument(documentKey, prompt, "preview")
        : await translateContentDocument(documentKey, targetLanguage!, prompt, "preview");
      if (session !== editorSession.current || documentKeyRef.current !== documentKey || updatedAtRef.current !== expectedUpdatedAt) throw new Error("The document changed while the new version was generating.");
      const version = await createContentDocumentVersion(documentKey, action === "enhance" ? "Enhanced version" : `${targetLanguage} translation`, generated.text, action === "enhance" ? "enhancement" : "translation");
      setPendingDocumentVersionLabel(undefined);
      setVersions((history) => [...history.filter(({ key }) => key !== version.key), version]);
      await openDocumentVersion(version, generated.text, true);
      notify(action === "enhance" ? "Enhanced version ready" : "Translated version ready");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : action === "enhance" ? "The document could not be enhanced." : "The document could not be translated.";
      if (activeSheetRef.current === "versions") setSheetError(message);
      else notify(message);
    } finally {
      setPendingDocumentVersionLabel(undefined);
      setDocumentActionLoading(undefined);
    }
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
      } else if (documentKey && result.changes?.some(({ workspace }) => workspace === "archive")) {
        await invalidateContentDocumentTopics(queryClient, contentContext, documentKey);
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
  }

  const openHistoryChooser = (document: ContentDocument) => {
    setSelectedDocument(document);
    openSheet("historyChooser");
  };

  const openDocumentVersionHistory = async () => {
    const documentKey = selectedDocument?.key ?? documentKeyRef.current;
    if (!documentKey) return;
    const generation = ++transformationVersionLoadGeneration.current;
    setVersions([]);
    setLoadingVersions(true);
    pushSheet("documentVersions");
    try {
      const history = await listContentDocumentVersions(documentKey);
      if (generation === transformationVersionLoadGeneration.current && documentKeyRef.current === documentKey && activeSheetRef.current === "documentVersions") setVersions(history);
    } catch (cause) {
      if (activeSheetRef.current === "documentVersions") setSheetLoadError(cause instanceof Error ? cause.message : "Document versions could not be loaded.");
    } finally {
      if (generation === transformationVersionLoadGeneration.current && documentKeyRef.current === documentKey) setLoadingVersions(false);
    }
  };

  const startNarrationSource = async (source: {
    audioVersionKey?: string;
    documentKey?: string;
    durationMs: number;
    lockScreenTitle: string;
    status: string;
    title: string;
    url: string;
  }, generation: number, startSeconds = 0, autoPlay = true) => {
    await setAudioModeAsync(BOOK_AUDIO_MODE);
    if (generation !== narrationPlaybackGeneration.current) return;
    stopNarration(false);
    narrationTitleRef.current = source.lockScreenTitle;
    narrationDocumentKey.current = source.documentKey;
    narrationAudioVersionKey.current = source.audioVersionKey;
    persistedNarrationPositionMs.current = Math.round(startSeconds * 1_000);
    setNarrationTitle(source.title);
    setNarrationStatus(source.status);
    setSelectedAudioVersionKey(source.audioVersionKey);
    const chunk: NarrationChunk = { durationMs: source.durationMs, url: source.url };
    narrationChunks.current = [chunk];
    narrationChunkIndex.current = 0;
    setNarrationManifest([chunk]);
    setNarrationActiveIndex(0);
    pendingNarrationSeek.current = { index: 0, seconds: Math.min(startSeconds, source.durationMs / 1_000), play: autoPlay };
    narrationPlayer.replace(source.url);
    narrationPlayer.setActiveForLockScreen(true, { title: source.lockScreenTitle, artist: "Vorinthex Archive" }, { showSeekBackward: false, showSeekForward: false });
    if (autoPlay) narrationPlayer.play();
    updateNarrationState(autoPlay ? "playing" : "paused");
  };

  const playAudioVersion = async (version: ContentDocumentAudioVersion, startSeconds = 0, autoPlay = true, refreshUrl = true) => {
    const document = selectedDocument;
    if (!document) return;
    const generation = ++narrationPlaybackGeneration.current;
    try {
      const history = refreshUrl
        ? await refreshContentDocumentAudioVersions(queryClient, contentContext, document.key)
        : queryClient.getQueryData<ContentDocumentAudioVersion[]>(contentQueryKeys.audioVersions(contentContext, document.key)) ?? audioVersions;
      if (generation !== narrationPlaybackGeneration.current) return;
      if (refreshUrl) setAudioVersions(history);
      const playable = history.find((item) => item.key === version.key) ?? version;
      const playbackPositionMs = Math.round(Math.min(startSeconds, playable.durationMs / 1_000) * 1_000);
      await queueAudioPlaybackUpdate(playable.key, document.key, playbackPositionMs);
      if (generation !== narrationPlaybackGeneration.current) return;
      setAudioVersions(history.map((item) => ({ ...item, isCurrent: item.key === playable.key, ...(item.key === playable.key ? { playbackPositionMs } : {}) })));
      await startNarrationSource({
        audioVersionKey: playable.key,
        documentKey: document.key,
        durationMs: playable.durationMs,
        lockScreenTitle: document.name,
        status: "AUDIO VERSION",
        title: `${document.name} · Audio ${playable.version}`,
        url: playable.url,
      }, generation, startSeconds, autoPlay);
    } catch (cause) {
      if (generation !== narrationPlaybackGeneration.current) return;
      const message = cause instanceof Error ? cause.message : "This audio version could not be played.";
      setNarrationError(message);
      updateNarrationState("error");
    }
  };

  const playSummaryAudio = async (summary: ContentDocumentSummary) => {
    const generation = ++narrationPlaybackGeneration.current;
    try {
      const refreshed = addCachedContentDocumentSummary(queryClient, contentContext, await findContentDocumentSummary(summary.key));
      setSelectedSummary(refreshed);
      setSummaries(queryClient.getQueryData<ContentDocumentSummary[]>(contentQueryKeys.summaries(contentContext, refreshed.documentKey)) ?? [refreshed]);
      if (!refreshed.audio) throw new Error("This summary has no saved audio.");
      const title = capitalizeLabel(refreshed.topic ?? "Document summary");
      await startNarrationSource({
        durationMs: refreshed.audio.durationMs,
        lockScreenTitle: title,
        status: "SUMMARY AUDIO",
        title,
        url: refreshed.audio.url,
      }, generation);
    } catch (cause) {
      if (generation !== narrationPlaybackGeneration.current) return;
      const message = cause instanceof Error ? cause.message : "This summary audio could not be played.";
      setSheetError(message);
      setNarrationError(message);
      updateNarrationState("error");
    }
  };

  const controlSummaryAudio = () => {
    const summary = selectedSummary;
    if (!summary?.audio) return;
    if (narrationStatus === "SUMMARY AUDIO" && narrationState === "playing") return;
    if (narrationStatus === "SUMMARY AUDIO" && narrationState === "paused") {
      narrationPlayer.play();
      updateNarrationState("playing");
      return;
    }
    void playSummaryAudio(summary);
  };

  const openAudioVersionHistory = async (targetDocument?: ContentDocument) => {
    const documentKey = targetDocument?.key ?? selectedDocument?.key ?? documentKeyRef.current;
    if (!documentKey) {
      setSheetError("Save the document before opening audio versions.");
      return;
    }
    if (targetDocument) {
      setSelectedDocument(targetDocument);
      selectedDocumentKeyRef.current = targetDocument.key;
    }
    const generation = ++restoreGeneration.current;
    if (targetDocument) openSheet("audioVersions");
    else if (sheetOpen) pushSheet("audioVersions");
    else openSheet("audioVersions");
    setAudioVersions([]);
    setLoadingAudioVersions(true);
    try {
      const history = await refreshContentDocumentAudioVersions(queryClient, contentContext, documentKey);
      if (generation === restoreGeneration.current && selectedDocumentKeyRef.current === documentKey) setAudioVersions(history);
    } catch (cause) {
      if (generation === restoreGeneration.current && activeSheetRef.current === "audioVersions" && selectedDocumentKeyRef.current === documentKey) setSheetLoadError(cause instanceof Error ? cause.message : "Audio versions could not be loaded.");
    } finally {
      if (generation === restoreGeneration.current) setLoadingAudioVersions(false);
    }
  };

  const openDocumentVersion = async (version: ContentDocumentVersion, generatedContent?: string, propagateError = false) => {
    if (dirty.current || saveInFlight.current || saveState !== "saved") return false;
    setOpeningDocumentKey(version.documentKey);
    setError(undefined);
    closeSheet();
    persistNarrationPosition();
    stopNarration();
    try {
      const [restored, content] = await Promise.all([
        restoreContentDocumentVersion(version.documentKey, version.key, false),
        generatedContent ? Promise.resolve(generatedContent) : findContentDocumentVersion(version.key).then((selected) => selected.content!),
      ]);
      const opened = { ...restored, content };
      editorSession.current += 1;
      replaceDocument(opened);
      replaceCachedContentDocumentDetail(queryClient, contentContext, opened);
      applyRemoteDocument(opened);
      setSelectedDocument(opened);
      selectedDocumentKeyRef.current = opened.key;
      setSelectedSummary(undefined);
      setDocumentSearchQuery("");
      setEditorEditing(false);
      void invalidateContentDocumentTopics(queryClient, contentContext, opened.key);
      return true;
    } catch (cause) {
      if (propagateError) throw cause;
      setError(cause instanceof Error ? cause.message : "The version could not be opened.");
      return false;
    } finally {
      setOpeningDocumentKey(undefined);
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
    setVersions([]);
    editorSession.current += 1;
    revision.current = 0;
    dirty.current = false;
    documentKeyRef.current = undefined;
    selectedDocumentKeyRef.current = undefined;
    updatedAtRef.current = undefined;
    pendingCreate.current = undefined;
    createVersionOnNextSave.current = false;
    titleRef.current = nextTitle;
    contentRef.current = "";
    savedTitleRef.current = nextTitle;
    savedContentRef.current = "";
    setEditorContentHeight(280);
    setTitle(nextTitle);
    setContent("");
    setSelectedDocument(undefined);
    setSelectedSummary(undefined);
    setQuery("");
    setResults(undefined);
    setSaveState(hasContentContext ? "saved" : "local");
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
    if (dirty.current || saveInFlight.current) {
      reportError("Wait for the current document to save before opening another.");
      return false;
    }
    const generation = ++navigationGeneration.current;
    persistNarrationPosition();
    stopNarration();
    setDocumentSearchQuery("");
    instructionGeneration.current += 1;
    instructionRequest.current?.abort();
    instructionRequest.current = undefined;
    restoreGeneration.current += 1;
    setInstructing(false);
    setAiInstructionError(undefined);
    setAiResponse(undefined);
    setOpeningDocumentKey(document.key);
    setEditorEditing(false);
    setEditorContentHeight(280);
    setError(undefined);
    const previousMode = workspaceModeRef.current;
    titleRef.current = document.name;
    setTitle(document.name);
    workspaceModeRef.current = "editor";
    setWorkspaceMode("editor");
    try {
      await audioPlaybackWrites.current;
      const [opened, restoredAudioVersions] = await Promise.all([
        getContentDocument(queryClient, contentContext, document.key),
        getContentDocumentAudioVersions(queryClient, contentContext, document.key).catch(() => []),
      ]);
      if (generation !== navigationGeneration.current) return false;
      editorSession.current += 1;
      applyRemoteDocument(opened);
      setSelectedDocument(opened);
      selectedDocumentKeyRef.current = opened.key;
      setAudioVersions(restoredAudioVersions);
      workspaceModeRef.current = "editor";
      setWorkspaceMode("editor");
      setSelectedSummary(undefined);
      if (!preserveSearch) {
        setQuery("");
        setResults(undefined);
      }
      const currentAudioVersion = restoredAudioVersions.find(({ isCurrent }) => isCurrent);
      if (currentAudioVersion) {
        await startNarrationSource({
          audioVersionKey: currentAudioVersion.key,
          documentKey: opened.key,
          durationMs: currentAudioVersion.durationMs,
          lockScreenTitle: opened.name,
          status: "AUDIO VERSION",
          title: `${opened.name} · Audio ${currentAudioVersion.version}`,
          url: currentAudioVersion.url,
        }, narrationPlaybackGeneration.current, currentAudioVersion.playbackPositionMs / 1_000, false);
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
    const opened = await openNote(document, fromSheet ? setSheetError : setError, preserveSearch);
    if (opened) {
      if (fromSheet) closeSheet();
    }
    return opened;
  };

  const openInitialDocument = useEffectEvent(() => {
    if (!initialDocumentKey || !hasContentContext || locationLoading) return;
    const requestKey = `${contentContextKey}:${initialDocumentKey}`;
    if (initialDocumentOpened.current === requestKey) return;
    initialDocumentOpened.current = requestKey;
    void getContentDocument(queryClient, contentContext, initialDocumentKey)
      .then((document) => openArchiveDocument(document))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "The document could not be opened."));
  });

  useEffect(() => {
    openInitialDocument();
  }, [contentContextKey, hasContentContext, initialDocumentKey, locationLoading]);

  const listenToSelectedDocument = async () => {
    if (!selectedDocument) return;
    await openAudioVersionHistory(selectedDocument);
  };

  const generateSelectedDocumentAudio = async () => {
    const document = selectedDocument;
    if (!document || document.managed || generatingDocumentAudio) return;
    setGeneratingDocumentAudio(true);
    setSheetLoadError(undefined);
    try {
      const version = addCachedContentDocumentAudioVersion(queryClient, contentContext, await generateContentDocumentAudio(document.key));
      const history = queryClient.getQueryData<ContentDocumentAudioVersion[]>(contentQueryKeys.audioVersions(contentContext, document.key)) ?? [version];
      setAudioVersions(history);
      await playAudioVersion(version, 0, true, false);
    } catch (cause) {
      setSheetLoadError(cause instanceof Error ? cause.message : "Audio could not be generated.");
    } finally {
      setGeneratingDocumentAudio(false);
    }
  };

  const openSimilarContent = async (source: { folderKey: string } | { documentKey: string }, initialTab: FolderContentTab) => {
    const generation = ++similarGeneration.current;
    similarRequest.current?.abort();
    const controller = new AbortController();
    similarRequest.current = controller;
    setSimilarContentTab(initialTab);
    setSimilarResults(undefined);
    setSimilarLoading(true);
    if (sheetOpen) pushSheet("similar");
    else openSheet("similar");
    try {
      const next = await findContentNeighbors(source, controller.signal);
      if (generation === similarGeneration.current) setSimilarResults(next);
    } catch (cause) {
      if (generation === similarGeneration.current && !(cause instanceof Error && cause.name === "AbortError")) setSheetLoadError(cause instanceof Error ? cause.message : "Similar Archive content could not be loaded.");
    } finally {
      if (generation === similarGeneration.current) {
        similarRequest.current = undefined;
        setSimilarLoading(false);
      }
    }
  };

  const clearSelection = () => {
    setSelectedFolders([]);
    setSelectedDocuments([]);
    setHydratingFolderKeys([]);
    setHydratingDocumentKeys([]);
  };

  const showSelectionLimit = () => notify("Selection limit reached");

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
    const provisional: ContentDocument = { key: document.documentKey, name: document.name, folderKey: document.folderKey, extension: document.extension, isFavorite: document.isFavorite, managed: document.managed, updatedAt: "" };
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
      toggleDocumentSelection(existing ?? { key: document.documentKey, name: document.name, folderKey: document.folderKey, extension: document.extension, isFavorite: document.isFavorite, managed: document.managed, updatedAt: "" });
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
    setRootSearchResults((current) => current ? { ...current, documents: current.documents.map((document) => document.documentKey === updated.key ? { ...document, ...updated, documentKey: updated.key } : document) } : current);
    setFolderSearchResults((current) => current ? { ...current, documents: current.documents.map((document) => document.documentKey === updated.key ? { ...document, ...updated, documentKey: updated.key } : document) } : current);
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
        const output = await normalizeCapturedPng(coverChange, { maxSide: 2400, compress: 0.88 });
        const upload = await uploadGalleryImages([{ clientKey: `${Date.now()}-${previous.key}`, filename: `folder-cover-${Date.now()}.png`, uri: output.uri, sizeBytes: output.sizeBytes, processingMode: "cover" }]);
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
    })().catch(async () => {
      try {
        const location = await refreshContentLocation(queryClient, contentContext, previous.parentFolderKey);
        replaceFolder(location.folders.find(({ key }) => key === previous.key) ?? previous, false);
      } catch {
        replaceFolder(previous, false);
      }
      notify("Folder update failed");
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
    const previousTab = folderContentTab;
    setError(undefined);
    const cached = queryClient.getQueryData<{ folders: ContentFolder[]; documents: ContentDocument[] }>(contentQueryKeys.location(contentContext, folder.key));
    const tree = queryClient.getQueryData<ContentFolder[]>(contentQueryKeys.folderTree(contentContext));
    setLocationLoading(!cached);
    if (cached) {
      setFolders(cached.folders);
      setDocuments(cached.documents);
      setFolderContentTab((selected) => populatedContentTab(cached, selected));
    } else {
      setFolders(tree ? contentFolderChildren(tree, folder.key) : []);
      setDocuments([]);
    }
    setFolderStack((current) => [...current, folder]);
    workspaceModeRef.current = "folder";
    setWorkspaceMode("folder");
    setQuery("");
    setResults(undefined);
    if (pendingFolderCreates.current.has(folder.key)) {
      setLocationLoading(false);
      return;
    }
    try {
      const location = await getContentLocation(queryClient, contentContext, folder.key);
      if (generation !== navigationGeneration.current) return;
      setFolders(location.folders);
      setDocuments(location.documents);
      setFolderContentTab((selected) => populatedContentTab(location, selected));
    } catch (cause) {
      if (generation === navigationGeneration.current) {
        setFolders(previousFolders);
        setDocuments(previousDocuments);
        setFolderStack(previousStack);
        workspaceModeRef.current = previousMode;
        setWorkspaceMode(previousMode);
        setFolderContentTab(previousTab);
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
    const tree = queryClient.getQueryData<ContentFolder[]>(contentQueryKeys.folderTree(contentContext));
    setLocationLoading(!cached);
    if (cached) {
      setFolders(cached.folders);
      setDocuments(cached.documents);
    } else {
      setFolders(tree ? contentFolderChildren(tree, nextFolderKey) : []);
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
      const location = await getContentLocation(queryClient, contentContext, nextFolderKey);
      if (generation !== navigationGeneration.current) return;
      setFolders(location.folders);
      setDocuments(location.documents);
      if (nextMode === "folders") {
        setRootFolders(location.folders);
        setRootDocuments(location.documents);
      }
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
      pendingEditorExit.current = true;
      saveImmediately.current = true;
      setSaveRetry((current) => current + 1);
      return;
    }
    completeEditorExit();
  };

  const leaveFileViewer = () => {
    documentActionGeneration.current += 1;
    previewFileRef.current?.delete();
    previewFileRef.current = undefined;
    setFilePreviewUri(undefined);
    setFilePreviewError(undefined);
    const nextMode = documentKeyRef.current ? "editor" : folderStack.length ? "folder" : "folders";
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

  useEffect(() => {
    const normalized = libraryQuery.trim();
    librarySearchRequest.current?.abort();
    if (!normalized || !hasContentContext || activeSheet !== "folders" && activeSheet !== "documents") {
      setLibrarySearching(false);
      setLibrarySearchResults(undefined);
      return;
    }
    const controller = new AbortController();
    librarySearchRequest.current = controller;
    setLibrarySearchResults(undefined);
    const timeout = setTimeout(() => {
      setLibrarySearching(true);
      void searchContentMatches(normalized, controller.signal, undefined, false).then((matches) => {
        if (!controller.signal.aborted) setLibrarySearchResults(matches);
      }).catch((cause) => {
        if (!controller.signal.aborted) setSheetError(cause instanceof Error ? cause.message : "Archive search failed.");
      }).finally(() => {
        if (!controller.signal.aborted) setLibrarySearching(false);
      });
    }, 300);
    const historyTimeout = setTimeout(() => {
      void searchContentMatches(normalized, controller.signal).catch(() => undefined);
    }, 800);
    return () => {
      clearTimeout(timeout);
      clearTimeout(historyTimeout);
      controller.abort();
    };
  }, [activeSheet, hasContentContext, libraryQuery]);

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
      void searchContentMatches(normalized, controller.signal, undefined, false).then((matches) => {
        if (!controller.signal.aborted) {
          setRootSearchResults(matches);
        }
      }).catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Search failed.");
        }
      }).finally(() => {
        if (!controller.signal.aborted) setRootSearching(false);
      });
    }, 300);
    const historyTimeout = setTimeout(() => {
      void searchContentMatches(normalized, controller.signal).catch(() => undefined);
    }, 800);
    return () => {
      clearTimeout(timeout);
      clearTimeout(historyTimeout);
      controller.abort();
    };
  }, [hasContentContext, rootSearchQuery, rootSearchRevision]);

  useEffect(() => {
    const normalized = query.trim();
    const folderKey = currentFolder?.key;
    folderSearchRequest.current?.abort();
    if (!normalized || !hasContentContext || !folderKey) {
      setFolderSearching(false);
      setFolderSearchResults(undefined);
      return;
    }
    if (pendingFolderCreates.current.has(folderKey)) {
      setFolderSearching(false);
      setFolderSearchResults({ query: normalized, cached: true, folders: [], documents: [] });
      return;
    }
    setFolderSearchResults(undefined);
    const controller = new AbortController();
    folderSearchRequest.current = controller;
    const timeout = setTimeout(() => {
      setFolderSearching(true);
      setError(undefined);
      void searchContentMatches(normalized, controller.signal, folderKey, false).then((matches) => {
        if (!controller.signal.aborted) {
          setFolderSearchResults(matches);
        }
      }).catch((cause) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : "Search failed.");
        }
      }).finally(() => {
        if (!controller.signal.aborted) setFolderSearching(false);
      });
    }, 300);
    const historyTimeout = setTimeout(() => {
      void searchContentMatches(normalized, controller.signal, folderKey).catch(() => undefined);
    }, 800);
    return () => {
      clearTimeout(timeout);
      clearTimeout(historyTimeout);
      controller.abort();
    };
  }, [currentFolder?.key, folderSearchRevision, hasContentContext, query]);

  const openSearchDocument = async (document: ContentSearchMatch) => {
    setError(undefined);
    try {
      const opened = await getContentDocument(queryClient, contentContext, document.documentKey);
      await openArchiveDocument(opened, false, true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The document could not be opened.");
    }
  };

  const openLibrarySearchDocument = async (document: ContentSearchMatch) => {
    setSheetError(undefined);
    try {
      const opened = await getContentDocument(queryClient, contentContext, document.documentKey);
      await openArchiveDocument(opened, true, true);
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The document could not be opened.");
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
    const folderKey = createContentRecordKey();
    const mutationKey = `folder-create:${folderKey}`;
    const optimistic: ContentFolder = { key: folderKey, ...(parentFolderKey ? { parentFolderKey } : {}), name, ...(folderDescription.trim() ? { description: folderDescription.trim() } : {}) };
    const addFolder = (current: ContentFolder[], folder: ContentFolder) => [...current.filter(({ key }) => key !== folder.key), folder]
      .sort((left, right) => left.name.localeCompare(right.name));
    setFolders((current) => addFolder(current, optimistic));
    if (!parentFolderKey) setRootFolders((current) => addFolder(current, optimistic));
    addCachedContentFolder(queryClient, contentContext, parentFolderKey, optimistic);
    seedCachedContentFolderLocation(queryClient, contentContext, folderKey);
    setFolderName("");
    setFolderDescription("");
    closeSheet();
    const creation = (async () => {
      const parentCreation = parentFolderKey ? pendingFolderCreates.current.get(parentFolderKey) : undefined;
      if (parentCreation) await parentCreation;
      return createContentFolder(name, parentFolderKey, optimistic.description, folderKey, mutationKey);
    })();
    pendingFolderCreates.current.set(folderKey, creation);
    try {
      const created = await creation;
      if (created.key !== folderKey) throw new Error("The created folder identity did not match the optimistic folder.");
      replaceCachedContentFolder(queryClient, contentContext, created);
      setFolders((current) => addFolder(current, created));
      if (!parentFolderKey) setRootFolders((current) => addFolder(current, created));
      setFolderStack((current) => current.map((folder) => folder.key === folderKey ? created : folder));
      void invalidateContentLocations(queryClient, contentContext, [parentFolderKey, folderKey]);
    } catch (cause) {
      removeCachedContentFolder(queryClient, contentContext, parentFolderKey, folderKey);
      removeCachedContentFolderLocation(queryClient, contentContext, folderKey);
      setFolders((current) => current.filter(({ key }) => key !== folderKey));
      if (!parentFolderKey) setRootFolders((current) => current.filter(({ key }) => key !== folderKey));
      if (folderStackRef.current.some((folder) => folder.key === folderKey)) {
        const survivingStack = folderStackRef.current.slice(0, folderStackRef.current.findIndex((folder) => folder.key === folderKey));
        const survivingParent = survivingStack.at(-1)?.key;
        const cachedParent = queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, survivingParent));
        setFolderStack(survivingStack);
        setFolders(cachedParent?.folders ?? []);
        setDocuments(cachedParent?.documents ?? []);
        workspaceModeRef.current = survivingStack.length ? "folder" : "folders";
        setWorkspaceMode(workspaceModeRef.current);
      }
      notify(cause instanceof Error ? cause.message : "Folder creation failed");
    } finally {
      if (pendingFolderCreates.current.get(folderKey) === creation) pendingFolderCreates.current.delete(folderKey);
    }
  };

  const selectRootFolder = async () => {
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      setSheetError("Wait for the current document to save before changing folders.");
      return;
    }
    const generation = ++navigationGeneration.current;
    const tree = queryClient.getQueryData<ContentFolder[]>(contentQueryKeys.folderTree(contentContext));
    const cached = queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext));
    setLocationLoading(!cached);
    if (tree) {
      const children = contentFolderChildren(tree);
      setFolders(children);
      setRootFolders(children);
    }
    if (cached) {
      setDocuments(cached.documents);
      setRootDocuments(cached.documents);
    }
    setSheetError(undefined);
    try {
      if (hasContentContext) {
        const location = await getContentLocation(queryClient, contentContext);
        if (generation !== navigationGeneration.current) return;
        setFolders(location.folders);
        setRootFolders(location.folders);
        setDocuments(location.documents);
        setRootDocuments(location.documents);
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
    const tree = queryClient.getQueryData<ContentFolder[]>(contentQueryKeys.folderTree(contentContext));
    const cached = queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, folder.key));
    setLocationLoading(!cached);
    if (tree) setFolders(contentFolderChildren(tree, folder.key));
    if (cached) setDocuments(cached.documents);
    setSheetError(undefined);
    try {
      if (hasContentContext) {
        const location = await getContentLocation(queryClient, contentContext, folder.key);
        if (generation !== navigationGeneration.current) return;
        setFolders(location.folders);
        setDocuments(location.documents);
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

  const openSearchHistory = async () => {
    if (!hasContentContext) return;
    const generation = ++historyGeneration.current;
    const folderKey = undefined;
    const key = userSearchHistoryQueryKey(contentContext.userKey);
    const cached = queryClient.getQueryData<ContentSearchHistoryItem[]>(key);
    const invalidated = queryClient.getQueryState(key)?.isInvalidated === true;
    setHistory(cached ?? []);
    setHistoryLoading(!cached || invalidated);
    setRemovingHistoryQuery(undefined);
    openSheet("searchHistory");
    if (cached && !invalidated) return;
    try {
      const loaded = await getUserSearchHistory(queryClient, contentContext);
      if (generation === historyGeneration.current && activeSheetRef.current === "searchHistory") setHistory(loaded);
    } catch (cause) {
      if (generation === historyGeneration.current && activeSheetRef.current === "searchHistory") setSheetLoadError(cause instanceof Error ? cause.message : "Search history could not be loaded.");
    } finally {
      if (generation === historyGeneration.current) setHistoryLoading(false);
    }
  };

  const useHistoryQuery = (item: ContentSearchHistoryItem) => {
    const folderKey = currentFolder?.key;
    const promoted = promoteCachedUserSearchHistory(queryClient, contentContext, item);
    setHistory((current) => [promoted, ...current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery)]);
    closeSheet();
    if (folderKey) {
      setQuery(item.query);
      setFolderSearchResults(undefined);
      setFolderSearchRevision((current) => current + 1);
    } else {
      setRootSearchQuery(item.query);
      setRootSearchResults(undefined);
      setRootSearchRevision((current) => current + 1);
    }
  };

  const removeHistoryQuery = async (item: ContentSearchHistoryItem) => {
    if (removingHistoryQuery) return;
    const folderKey = undefined;
    const previous = removeCachedUserSearchHistory(queryClient, contentContext, item.normalizedQuery);
    setHistory((current) => current.filter(({ normalizedQuery }) => normalizedQuery !== item.normalizedQuery));
    setRemovingHistoryQuery(item.normalizedQuery);
    setSheetError(undefined);
    try {
      await deleteContentSearchHistory(item.normalizedQuery);
    } catch (cause) {
      queryClient.setQueryData(userSearchHistoryQueryKey(contentContext.userKey), previous);
      setHistory(previous);
      setSheetError(cause instanceof Error ? cause.message : "The search could not be removed.");
    } finally {
      setRemovingHistoryQuery(undefined);
    }
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
      : directSelection?.folder
        ? directSelection.folder.parentFolderKey
        : directSelection?.document
          ? directSelection.document.folderKey
          : currentFolder?.key;
    setDestinationInitialFolderKey(action === "upload" ? undefined : sourceFolderKey ?? null);
    setDestinationBlockedFolderKeys([]);
    setDestinationStack([]);
    setDestinationFolders([]);
    if (action === "upload") {
      if (sheetOpen) pushSheet("destination");
      else openSheet("destination");
    } else if (sheetOpen) pushSheet("destinationBrowser");
    else openSheet("destinationBrowser");
    setDestinationLoading(true);
    try {
      const tree = await getContentFolderTree(queryClient, contentContext);
      const resolvedStack = contentFolderStack(tree, sourceFolderKey);
      const selectedFolderKeys = directSelection?.folder ? [directSelection.folder.key] : selectedFolders.map(({ key }) => key);
      const blockedFolderKeys = action === "move"
        ? contentFolderDescendantKeys(tree, selectedFolderKeys)
        : action === "copy"
          ? selectedFolderKeys
          : [];
      if (generation === destinationGeneration.current) {
        setDestinationStack(resolvedStack);
        setDestinationFolders(contentFolderChildren(tree, sourceFolderKey));
        setDestinationBlockedFolderKeys(blockedFolderKeys);
      }
    } catch (cause) {
      if (generation === destinationGeneration.current) {
        const message = cause instanceof Error ? cause.message : "Folders could not be loaded.";
        if (action === "upload") setSheetError(message);
        else setSheetLoadError(message);
      }
    } finally {
      if (generation === destinationGeneration.current) setDestinationLoading(false);
    }
  };

  const openDestinationBrowser = async () => {
    const generation = ++destinationGeneration.current;
    setDestinationLoading(true);
    setDestinationFolders([]);
    setSheetError(undefined);
    setSheetLoadError(undefined);
    pushSheet("destinationBrowser");
    try {
      const tree = await getContentFolderTree(queryClient, contentContext);
      const children = contentFolderChildren(tree, destinationFolder?.key);
      if (generation === destinationGeneration.current) setDestinationFolders(children);
    } catch (cause) {
      if (generation === destinationGeneration.current) setSheetLoadError(cause instanceof Error ? cause.message : "Folders could not be loaded.");
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
    setSheetLoadError(undefined);
    try {
      const tree = await getContentFolderTree(queryClient, contentContext);
      const next = contentFolderChildren(tree, nextStack.at(-1)?.key);
      if (generation !== destinationGeneration.current) return;
      setDestinationFolders(next);
    } catch (cause) {
      if (generation === destinationGeneration.current) setSheetLoadError(cause instanceof Error ? cause.message : "The folder could not be opened.");
    } finally {
      if (generation === destinationGeneration.current) setDestinationLoading(false);
    }
  };

  const pickAndUpload = async (folderKey?: string) => {
    const requestContext = getContentContext();
    const requestContextKey = `${requestContext.organizationKey}:${requestContext.scopeKey}`;
    const generation = ++uploadGeneration.current;
    setSheetError(undefined);
    try {
      const picked = await DocumentPicker.getDocumentAsync({ type: UPLOAD_MIME_TYPES, multiple: true, copyToCacheDirectory: true });
      if (picked.canceled) return;
      const batch = picked.assets.map((asset: { uri: string; name: string; mimeType?: string | null }, index: number): UploadBatchItem => {
        const file = new File(asset.uri);
        return { id: `${asset.uri}-${index}`, mutationKey: createContentMutationKey(), file, name: asset.name, mimeType: asset.mimeType ?? file.type, status: "pending" };
      });
      setUploadFolderKey(folderKey);
      uploadBatchRef.current = batch;
      setUploadBatch(batch);
      setUploading(true);
      setFolderContentTab("files");
      closeSheet();
      const pendingFolder = folderKey ? pendingFolderCreates.current.get(folderKey) : undefined;
      if (pendingFolder) await pendingFolder;
      let cursor = 0;
      const update = (id: string, change: Partial<UploadBatchItem>) => {
        uploadBatchRef.current = uploadBatchRef.current.map((item) => item.id === id ? { ...item, ...change } : item);
        setUploadBatch(uploadBatchRef.current);
      };
      const uploadedDocuments = new Map<string, ContentDocument>();
      const worker = async () => {
        while (cursor < batch.length) {
          const item = batch[cursor];
          cursor += 1;
          if (!item) return;
          update(item.id, { status: "uploading" });
          try {
            if (item.file.size > MAX_MOBILE_UPLOAD_BYTES) throw new Error("Mobile uploads must be 8 MB or smaller.");
            const { document } = await uploadContentDocument({ name: item.name, type: item.mimeType, size: item.file.size, base64: await item.file.base64() }, folderKey, requestContext, item.mutationKey);
            if (generation !== uploadGeneration.current || contentContextKeyRef.current !== requestContextKey) return;
            const verified = await refreshContentDocument(queryClient, requestContext, document.key);
            if (!verified.content.trim()) throw new Error("No text could be extracted from the uploaded file.");
            if (generation !== uploadGeneration.current || contentContextKeyRef.current !== requestContextKey) return;
            uploadedDocuments.set(item.id, verified);
          } catch (cause) {
            if (generation !== uploadGeneration.current || contentContextKeyRef.current !== requestContextKey) return;
            update(item.id, { status: "error", error: cause instanceof Error ? cause.message : "Upload failed." });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, batch.length) }, () => worker()));
      if (generation !== uploadGeneration.current || contentContextKeyRef.current !== requestContextKey) return;
      const location = await refreshContentLocation(queryClient, requestContext, folderKey);
      if (generation !== uploadGeneration.current || contentContextKeyRef.current !== requestContextKey) return;
      const visibleKeys = new Set(location.documents.map(({ key }) => key));
      for (const [id, document] of uploadedDocuments) {
        update(id, visibleKeys.has(document.key) && document.folderKey === folderKey
          ? { status: "success", error: undefined }
          : { status: "error", error: "The uploaded file was not found in this folder." });
      }
      const completed = uploadBatchRef.current;
      const successCount = completed.filter(({ status }) => status === "success").length;
      const failureCount = completed.filter(({ status }) => status === "error").length;
      if (currentFolderKeyRef.current === folderKey) {
        setFolders(location.folders);
        setDocuments(location.documents);
        if (!folderKey) {
          setRootFolders(location.folders);
          setRootDocuments(location.documents);
        }
      }
      notify(failureCount > 0
        ? successCount > 0 ? `${successCount} uploaded, ${failureCount} failed` : "Files could not be uploaded"
        : `Uploaded ${successCount} ${successCount === 1 ? "file" : "files"}`);
      uploadBatchRef.current = [];
      setUploadBatch([]);
      setUploadFolderKey(undefined);
      const topUploaded = batch.map(({ id }) => uploadedDocuments.get(id)).find((document): document is ContentDocument => Boolean(document));
      if (topUploaded) await openNote(topUploaded);
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
    const requestContextKey = `${requestContext.organizationKey}:${requestContext.scopeKey}`;
    const folderKey = scanFolderKey;
    const generation = ++scanGeneration.current;
    const name = `Scanned document ${new Date().toISOString().slice(0, 10)}`;
    let processingStarted = false;
    setScanBusy(true);
    setScanError(undefined);
    try {
      if (scanSessionSize(pages) > MAX_DOCUMENT_SCAN_BYTES) throw new Error("Scanned pages must be 16 MB or smaller in total.");
      const prepared = await Promise.all(pages.map(async (page, index) => ({ name: `scan-page-${index + 1}.png`, size: page.sizeBytes, base64: await new File(page.uri).base64() })));
      if (generation !== scanGeneration.current || contentContextKeyRef.current !== requestContextKey) return;
      processingStarted = true;
      setProcessingScan({ id: `scan-${generation}`, folderKey, name });
      setFolderContentTab("documents");
      setScanOpen(false);
      const pendingFolder = folderKey ? pendingFolderCreates.current.get(folderKey) : undefined;
      if (pendingFolder) await pendingFolder;
      const { document } = await scanContentDocument(prepared, folderKey, requestContext, name);
      if (generation !== scanGeneration.current || contentContextKeyRef.current !== requestContextKey) return;
      addCachedContentDocument(queryClient, requestContext, folderKey, document);
      if (currentFolderKeyRef.current === folderKey) {
        const addDocument = (current: ContentDocument[]) => [document, ...current.filter(({ key }) => key !== document.key)];
        setDocuments(addDocument);
        if (!folderKey) setRootDocuments(addDocument);
      }
      await invalidateContentLocations(queryClient, requestContext, [folderKey]);
      notify("Document scanned");
      await openNote(document);
    } catch (cause) {
      if (generation !== scanGeneration.current || contentContextKeyRef.current !== requestContextKey) return;
      const message = cause instanceof Error ? cause.message : "The document could not be scanned.";
      if (processingStarted) notify("Document could not be scanned");
      else setScanError(message);
    } finally {
      if (generation === scanGeneration.current) {
        setScanBusy(false);
        if (processingStarted) setProcessingScan(undefined);
      }
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
        if (isCurrent()) notify(`${directDocument.extension ? "File" : "Document"} ${action === "move" ? "moved" : "copied"}`);
      }).catch(() => {
        if (committed) {
          if (isCurrent()) notify(`${directDocument.extension ? "File" : "Document"} ${action === "move" ? "moved" : "copied"}`);
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
        notify(`${directDocument.extension ? "File" : "Document"} ${action} failed`);
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
      if (action === "move") {
        const optimistic = { ...directFolder, parentFolderKey: destinationKeys[0] };
        removeCachedContentFolder(queryClient, contentContext, sourceKey, directFolder.key);
        addCachedContentFolder(queryClient, contentContext, destinationKeys[0], optimistic);
        if (!queryClient.getQueryData(contentQueryKeys.location(contentContext, destinationKeys[0]))) queryClient.setQueryData(contentQueryKeys.location(contentContext, destinationKeys[0]), { folders: [optimistic], documents: [] });
      } else if (!queryClient.getQueryData(contentQueryKeys.location(contentContext, destinationKeys[0]))) {
        const tree = queryClient.getQueryData<ContentFolder[]>(contentQueryKeys.folderTree(contentContext)) ?? [];
        queryClient.setQueryData(contentQueryKeys.location(contentContext, destinationKeys[0]), { folders: contentFolderChildren(tree, destinationKeys[0]), documents: [] });
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
        if (isCurrent()) notify(outcome.failed
          ? `${outcome.succeeded} ${action === "move" ? "moved" : "copied"}, ${outcome.failed} failed`
          : `${outcome.succeeded} ${outcome.succeeded === 1 ? "folder" : "folders"} ${action === "move" ? "moved" : "copied"}`);
      })().catch(() => {
        if (committed) {
          if (isCurrent()) notify(`Folder ${action === "move" ? "moved" : "copied"}`);
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
        notify(`Folder ${action} failed`);
      });
      return;
    }
    if (bulkMutationLocked.current) return;
    bulkMutationLocked.current = true;
    setBulkLoading(true);
    setSheetError(undefined);
    let operationFolders: ContentFolder[];
    let operationDocuments: ContentDocument[];
    try {
      ({ folders: operationFolders, documents: operationDocuments } = await resolveStructuralResources(selectedFoldersSnapshot, selectedDocumentsSnapshot));
    } catch (cause) {
      bulkMutationLocked.current = false;
      setBulkLoading(false);
      setSheetError(cause instanceof Error ? cause.message : "The selected items could not be prepared.");
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
    const folderTreeSnapshot = queryClient.getQueryData<ContentFolder[]>(contentQueryKeys.folderTree(contentContext));
    const sourceKeys = [...operationFolders.map(({ parentFolderKey }) => parentFolderKey), ...operationDocuments.map(({ folderKey }) => folderKey)];
    const locationSnapshots = new Map([...new Set([...sourceKeys, targetKey])].map((key) => [key, queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, key))]));
    const optimisticFolders = action === "move"
      ? operationFolders.map((folder): ContentFolder => ({ ...folder, parentFolderKey: targetKey }))
      : [];
    const optimisticDocuments = operationDocuments.map((document, index): ContentDocument => action === "move"
      ? { ...document, folderKey: targetKey }
      : { ...document, key: `optimistic-${createContentMutationKey()}-${index}`, folderKey: targetKey, name: `${document.name} (copying)`, isFavorite: false });
    if (action === "move") {
      operationFolders.forEach((folder) => removeCachedContentFolder(queryClient, contentContext, folder.parentFolderKey, folder.key));
      operationDocuments.forEach((document) => removeCachedContentDocument(queryClient, contentContext, document.folderKey, document.key));
    }
    optimisticFolders.forEach((folder) => addCachedContentFolder(queryClient, contentContext, targetKey, folder));
    optimisticDocuments.forEach((document) => addCachedContentDocument(queryClient, contentContext, targetKey, document));
    const targetTree = queryClient.getQueryData<ContentFolder[]>(contentQueryKeys.folderTree(contentContext)) ?? [];
    const optimisticLocation = queryClient.getQueryData<ContentLocation>(contentQueryKeys.location(contentContext, targetKey)) ?? {
      folders: action === "move" ? optimisticFolders : contentFolderChildren(targetTree, targetKey),
      documents: optimisticDocuments,
    };
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
    try {
      if (transferContextKey !== contentContextKeyRef.current) throw new Error("Archive context changed before the transfer could start.");
      locationSnapshots.forEach((location, key) => {
        if (location) queryClient.setQueryData(contentQueryKeys.location(contentContext, key), location);
        else queryClient.removeQueries({ queryKey: contentQueryKeys.location(contentContext, key), exact: true });
      });
      if (folderTreeSnapshot) queryClient.setQueryData(contentQueryKeys.folderTree(contentContext), folderTreeSnapshot);
      else queryClient.removeQueries({ queryKey: contentQueryKeys.folderTree(contentContext), exact: true });
      const normalizedFolders = action === "move"
        ? operationFolders.map((folder): ContentFolder => ({ ...folder, parentFolderKey: targetKey }))
        : [];
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
      if (transferIsCurrent()) notify(outcome.failed
        ? `${outcome.succeeded} ${action === "move" ? "moved" : "copied"}, ${outcome.failed} failed`
        : `${outcome.succeeded} ${outcome.succeeded === 1 ? "item" : "items"} ${action === "move" ? "moved" : "copied"}`);
    } catch {
      if (transferCommitted) {
        if (transferIsCurrent()) notify(`${action === "move" ? "Move" : "Copy"} completed`);
        return;
      }
      locationSnapshots.forEach((location, key) => {
        if (location) queryClient.setQueryData(contentQueryKeys.location(contentContext, key), location);
        else queryClient.removeQueries({ queryKey: contentQueryKeys.location(contentContext, key), exact: true });
      });
      if (folderTreeSnapshot) queryClient.setQueryData(contentQueryKeys.folderTree(contentContext), folderTreeSnapshot);
      else queryClient.removeQueries({ queryKey: contentQueryKeys.folderTree(contentContext), exact: true });
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
        notify(`${action === "move" ? "Move" : "Copy"} failed`);
      }
    } finally {
      bulkMutationLocked.current = false;
      setBulkLoading(false);
    }
  };

  const updateSelectionFavorite = async () => {
    if (bulkMutationLocked.current) return;
    bulkMutationLocked.current = true;
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
      notify(outcome.failed
        ? outcome.succeeded ? `${outcome.succeeded} updated, ${outcome.failed} failed` : "Favorites could not be updated"
        : `${outcome.succeeded} ${outcome.succeeded === 1 ? "item" : "items"} ${nextFavorite ? "favorited" : "unfavorited"}`);
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "Favorites could not be updated.");
    } finally {
      bulkMutationLocked.current = false;
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
      if (directFolder.isFavorite) {
        closeSheet();
        notify("Can't delete favorite folder");
        return;
      }
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
      void invalidateContentLocations(queryClient, contentContext, [parentKey]).catch(() => undefined);
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
      void hardDeleteContentSelection({ folderKeys: [directFolder.key], documentKeys: [] }).then((outcome) => {
        if (outcome.succeeded === 0) throw outcome.failures[0] ?? new Error("The folder could not be deleted.");
        committed = true;
        removeCachedContentFoldersEverywhere(queryClient, contentContext, [directFolder.key]);
        void queryClient.invalidateQueries({ queryKey: compassQueryKeys.trips(contentContext), exact: true });
        void invalidateContentLocations(queryClient, contentContext, [parentKey]).catch(() => undefined);
        notify("1 item deleted");
      }).catch((cause: unknown) => {
        if (committed) {
          if (isCurrent()) notify("1 item deleted");
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
        notify(isFavoriteContentConflict(cause) ? "Can't delete favorite folder" : "Folder deletion failed");
      });
      return;
    }
    if (bulkMutationLocked.current) return;
    const { favoriteFolders, favoriteDocuments, eligibleFolders, eligibleDocuments } = partitionFavoriteContentSelection(selectedFoldersSnapshot, selectedDocumentsSnapshot);
    const localFavoriteCount = favoriteFolders.length + favoriteDocuments.length;
    if (localFavoriteCount > 0 && eligibleFolders.length === 0 && eligibleDocuments.length === 0) {
      closeSheet(true);
      notify(`Can't delete ${localFavoriteCount} favorite item${localFavoriteCount === 1 ? "" : "s"}`);
      return;
    }
    bulkMutationLocked.current = true;
    setBulkLoading(true);
    setSheetError(undefined);
    try {
      const { folders: operationFolders, documents: operationDocuments } = await resolveStructuralResources(eligibleFolders, eligibleDocuments);
      const operationSelection: ContentSelection = { folderKeys: operationFolders.map(({ key }) => key), documentKeys: operationDocuments.map(({ key }) => key) };
      setSelectedFolders([...favoriteFolders, ...operationFolders]);
      setSelectedDocuments([...favoriteDocuments, ...operationDocuments]);
      const outcome = await hardDeleteContentSelection(operationSelection);
      const failedFolders = new Set(outcome.failures.filter(({ kind }) => kind === "folder").map(({ key }) => key));
      const failedDocuments = new Set(outcome.failures.filter(({ kind }) => kind === "document").map(({ key }) => key));
      const serverFavoriteFailures = new Set(outcome.failures.filter(isFavoriteContentConflict).map(({ kind, key }) => `${kind}:${key}`));
      const favoriteCount = localFavoriteCount > 0 ? localFavoriteCount : serverFavoriteFailures.size;
      const archivedFolderKeys = operationFolders.map(({ key }) => key).filter((key) => !failedFolders.has(key));
      const archivedDocumentKeys = operationDocuments.map(({ key }) => key).filter((key) => !failedDocuments.has(key));
      removeCachedContentFoldersEverywhere(queryClient, contentContext, archivedFolderKeys);
      if (archivedFolderKeys.length) void queryClient.invalidateQueries({ queryKey: compassQueryKeys.trips(contentContext), exact: true });
      removeCachedContentDocumentsEverywhere(queryClient, contentContext, archivedDocumentKeys);
      setFolders((current) => current.filter(({ key }) => !archivedFolderKeys.includes(key)));
      setRootFolders((current) => current.filter(({ key }) => !archivedFolderKeys.includes(key)));
      setDocuments((current) => current.filter(({ key }) => !archivedDocumentKeys.includes(key)));
      setRootDocuments((current) => current.filter(({ key }) => !archivedDocumentKeys.includes(key)));
      setSelectedFolders([...favoriteFolders, ...operationFolders.filter(({ key }) => failedFolders.has(key))]);
      setSelectedDocuments([...favoriteDocuments, ...operationDocuments.filter(({ key }) => failedDocuments.has(key))]);
      void queryClient.invalidateQueries({ queryKey: contentQueryKeys.locations(contentContext), refetchType: "none" }).catch(() => undefined);
      if (favoriteCount > 0) {
        closeSheet(true);
      } else if (outcome.succeeded) {
        closeSheet(outcome.failed > 0);
      }
      notify(favoriteCount > 0
        ? `Can't delete ${favoriteCount} favorite item${favoriteCount === 1 ? "" : "s"}`
        : outcome.failed
          ? outcome.succeeded ? `${outcome.succeeded} deleted, ${outcome.failed} failed` : "Items could not be deleted"
          : `${outcome.succeeded} ${outcome.succeeded === 1 ? "item" : "items"} deleted`);
    } catch {
      setSheetError("The selected items could not be deleted.");
    } finally {
      bulkMutationLocked.current = false;
      setBulkLoading(false);
    }
  };

  const openDocumentDetails = () => {
    if (!selectedDocument) return;
    setDocumentDetailsName(selectedDocument.name);
    setDocumentDetailsFavorite(Boolean(selectedDocument.isFavorite));
    pushSheet("documentDetails");
  };

  const submitDocumentDetails = async () => {
    const name = documentDetailsName.trim();
    if (!selectedDocument || !name) return;
    const previous = selectedDocument;
    const optimistic = { ...previous, name, isFavorite: documentDetailsFavorite };
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
      const operation = (async () => {
        let updated = previous;
        if (name !== previous.name) updated = await renameContentDocument(previous.key, name);
        if (documentDetailsFavorite !== Boolean(previous.isFavorite)) updated = await setContentDocumentFavorite(previous.key, documentDetailsFavorite);
        return updated;
      })();
      const updated = await trackActiveDocumentMutation(previous.key, operation, (result) => {
        if (result.key === documentKeyRef.current) updatedAtRef.current = result.updatedAt;
      });
      if (generation !== documentActionGeneration.current) return;
      replaceDocument(updated);
      if (name !== previous.name) await invalidateContentDocumentTopics(queryClient, contentContext, updated.key);
      if (updated.key === documentKeyRef.current && titleRef.current === name) {
        titleRef.current = updated.name;
        savedTitleRef.current = updated.name;
        setTitle(updated.name);
      }
      void invalidateContentLocations(queryClient, contentContext, [updated.folderKey]);
    } catch (cause) {
      if (generation !== documentActionGeneration.current) return;
      let restored = previous;
      try {
        const location = await refreshContentLocation(queryClient, contentContext, previous.folderKey);
        restored = location.documents.find(({ key }) => key === previous.key) ?? previous;
      } catch {}
      replaceDocument(restored);
      if (restored.key === documentKeyRef.current && titleRef.current === name) {
        titleRef.current = restored.name;
        savedTitleRef.current = restored.name;
        setTitle(restored.name);
      }
      notify("Update failed");
    }
  };

  const confirmSelectedFolderDelete = () => {
    if (!selectedFolder) return;
    beginSingleSelection(selectedFolder, "folder");
    setTemporarySingleSelection(true);
    pushSheet("bulkDelete");
  };

  const downloadOriginal = () => {
    const document = selectedDocument;
    if (!document) return;
    closeSheet();
    void (async () => {
      try {
        const download = await downloadContentDocument(document.key, document.originalAvailable ? "original" : "txt");
        await saveBase64Download(download.fileName, download.mimeType, download.content);
        await new Promise((resolve) => setTimeout(resolve, 1_000));
        notify(document.originalAvailable ? "Original downloaded" : "Text downloaded");
      } catch {
        notify("Download failed");
      }
    })();
  };

  const showOriginal = async () => {
    if (!selectedDocument?.extension || !selectedDocument.originalAvailable) return;
    const document = selectedDocument;
    setSheetError(undefined);
    previewFileRef.current?.delete();
    previewFileRef.current = undefined;
    setFilePreviewUri(undefined);
    setFilePreviewError(undefined);
    closeSheet();
    workspaceModeRef.current = "viewer";
    setWorkspaceMode("viewer");
    const generation = ++documentActionGeneration.current;
    try {
      const download = await downloadContentDocument(document.key, document.extension === "pdf" ? "original" : "html");
      if (generation !== documentActionGeneration.current) return;
      const file = await saveTemporaryBase64File(download.fileName, download.content);
      if (generation !== documentActionGeneration.current || workspaceModeRef.current !== "viewer") {
        file.delete();
        return;
      }
      previewFileRef.current = file;
      setFilePreviewUri(file.uri);
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "The original file could not be opened.";
      if (generation !== documentActionGeneration.current) return;
      setFilePreviewError(message);
    } finally {
      if (generation === documentActionGeneration.current) setDocumentActionLoading(undefined);
    }
  };

  const openScanSources = async (document = selectedDocument) => {
    if (!document?.sourceImageCount) return;
    const generation = ++sourceImagesGeneration.current;
    selectedDocumentKeyRef.current = document.key;
    setSelectedDocument(document);
    setSourceImages([]);
    setSourceImagesLoading(true);
    setSheetError(undefined);
    if (sheetOpen) pushSheet("scanSources");
    else openSheet("scanSources");
    try {
      const sources = await readContentDocumentSources(document.key);
      if (generation === sourceImagesGeneration.current && selectedDocumentKeyRef.current === document.key && activeSheetRef.current === "scanSources") setSourceImages(sources);
    } catch (cause) {
      if (generation === sourceImagesGeneration.current && selectedDocumentKeyRef.current === document.key && activeSheetRef.current === "scanSources") setSheetLoadError(cause instanceof Error ? cause.message : "The scanned pages could not be opened.");
    } finally {
      if (generation === sourceImagesGeneration.current && selectedDocumentKeyRef.current === document.key) setSourceImagesLoading(false);
    }
  };

  const deleteSelectedDocument = async () => {
    if (!selectedDocument) return;
    const target = selectedDocument;
    if (target.isFavorite) {
      closeSheet();
      notify(`Can't delete favorite ${target.extension ? "file" : "document"}`);
      return;
    }
    setDocumentActionLoading("delete");
    setSheetError(undefined);
    try {
      const outcome = await hardDeleteContentSelection({ folderKeys: [], documentKeys: [target.key] });
      if (outcome.succeeded === 0) {
        if (outcome.failures.some(isFavoriteContentConflict)) {
          closeSheet();
          notify(`Can't delete favorite ${target.extension ? "file" : "document"}`);
        } else {
          setSheetError("The item could not be deleted.");
        }
        return;
      }
      removeCachedContentDocumentEverywhere(queryClient, contentContext, target.key);
      setDocuments((current) => current.filter(({ key }) => key !== target.key));
      setRootDocuments((current) => current.filter(({ key }) => key !== target.key));
      closeSheet();
      if (target.key === documentKeyRef.current) {
        previewFileRef.current?.delete();
        previewFileRef.current = undefined;
        setFilePreviewUri(undefined);
        setFilePreviewError(undefined);
        resetEditor();
        workspaceModeRef.current = currentFolder ? "folder" : "folders";
        setWorkspaceMode(workspaceModeRef.current);
      }
      setSelectedDocument(undefined);
      void invalidateContentLocations(queryClient, contentContext, [target.folderKey]).catch(() => undefined);
      notify("1 item deleted");
    } catch {
      setSheetError("The item could not be deleted.");
    } finally {
      setDocumentActionLoading(undefined);
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
    const close = (disabled: boolean) => <Button disabled={disabled} onPress={() => closeSheet()} size="md" variant="secondary">Close</Button>;
    const managedDocument = activeDocument?.managed || selectedDocument?.managed;
    if (activeSheet === "transform") return <>
      {!managedDocument ? <Button disabled={!documentKeyRef.current || (documentTransformation === "enhance" ? !documentTransformationPrompt.trim() : !translationTargetLanguage.trim())} onPress={() => void generateDocumentTransformation()} size="md" variant="primary">{documentTransformation === "enhance" ? "Enhance" : "Translate"}</Button> : null}
      {close(false)}
    </>;
    if (activeSheet === "versions") return <>
      {!managedDocument && !documentActionLoading ? <Button disabled={loadingVersions} onPress={() => { if (documentTransformation === "enhance") void generateDocumentTransformation(); else pushSheet("transform"); }} size="md" variant="primary">{documentTransformation === "enhance" ? "Enhance" : "Translate"}</Button> : null}
      {close(false)}
    </>;
    if (activeSheet === "documentVersions") return close(loadingVersions);
    if (activeSheet === "summarize") return <>
      {sheetLoadError ? <Button disabled={loadingSummaryTopics || generatingSummary} loading={loadingSummaryTopics} onPress={() => void loadSummaryTopics()} size="md" variant="primary">Retry</Button> : null}
      {close(false)}
    </>;
    if (activeSheet === "summaryVersions") return <>
      {!managedDocument && !loadingSummaries && summaries.length === 0 ? <Button disabled={generatingSummary} onPress={() => void requestDocumentAiAction("summarize")} size="md" variant="primary">Create summary</Button> : null}
      {close(false)}
    </>;
    if (activeSheet === "summaryReader") return <>
      {summaryNarrationIsland}
      {generatingSummary ? <LoadingText text="Generating summary..." /> : null}
      {selectedSummary?.audio ? <Button disabled={generatingSummary || narrationStatus === "SUMMARY AUDIO" && narrationState === "playing"} onPress={controlSummaryAudio} size="md" variant="primary">Listen</Button> : null}
      {close(false)}
    </>;
    if (activeSheet === "audioVersions") return <>
      {documentNarrationIsland}
      {!managedDocument ? <Button disabled={loadingAudioVersions || generatingDocumentAudio || saveState !== "saved"} loading={generatingDocumentAudio} onPress={() => void generateSelectedDocumentAudio()} size="md" variant="primary">Generate audio</Button> : null}
      {close(generatingDocumentAudio)}
    </>;
    if (activeSheet === "folderDetails") return <>
      <Button disabled={!folderDetailsName.trim()} onPress={() => void submitFolderDetails()} size="md" variant="primary">Save</Button>
      {close(false)}
    </>;
    if (activeSheet === "documentDetails") return <>
      <Button disabled={!documentDetailsName.trim()} onPress={() => void submitDocumentDetails()} size="md" variant="primary">Save</Button>
      {close(false)}
    </>;
    if (activeSheet === "deleteDocument") return null;
    if (activeSheet === "bulkDelete") return null;
    if (activeSheet === "destinationBrowser") return <>
      {destinationAction !== "upload" && (destinationAtInitialLocation || destinationIsBlocked)
        ? <Text style={styles.invalidDestinationHelp}>Invalid destination. Choose another folder to {destinationAction} to.</Text>
        : <Button disabled={bulkLoading} loading={bulkLoading} onPress={() => { if (destinationAction === "upload") goBackSheet(); else void selectDestination(); }} size="md" variant="primary">{destinationAction === "upload" ? "Choose folder" : destinationAction === "move" ? "Move here" : "Copy here"}</Button>}
      {close(bulkLoading)}
    </>;
    if (activeSheet === "destination" && destinationAction === "upload") return <>
      <Button disabled={destinationLoading} loading={destinationLoading} onPress={() => void selectDestination()} size="md" variant="primary">Choose files for this folder</Button>
      {close(destinationLoading)}
    </>;
    if (activeSheet === "folder") return <>
      <Button disabled={!folderName.trim()} onPress={() => void submitFolder()} size="md" variant="primary">Create folder</Button>
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
    if (!version || version.key === narrationAudioVersionKey.current) {
      seekNarration(seconds);
      return;
    }
    const wasPlaying = narrationStateRef.current === "playing";
    if (wasPlaying) {
      pauseOwnedPlayer(narrationPlayer, narrationPlayerActive.current);
      updateNarrationState("paused");
    }
    void playAudioVersion(version, seconds, wasPlaying);
  };

  const summaryNarrationIsland = narrationStatus === "SUMMARY AUDIO" && narrationState !== "idle" ? (
    <View style={styles.narrationPlayer}>
      <View style={styles.narrationHeading}>
        <View style={styles.narrationTitleBlock}>
          <Text numberOfLines={1} style={styles.narrationTitle}>{capitalizeLabel(selectedSummary?.topic ?? summaryReaderTopic ?? "Summary audio")}</Text>
        </View>
        <Button accessibilityLabel="Close summary audio player" contentMode="raw" onPress={() => stopNarration()} size="xs" variant="icon"><CloseIcon size="sm" /></Button>
      </View>
      <View style={styles.narrationControls}>
        <Button accessibilityLabel={narrationState === "playing" ? "Pause summary audio" : "Play summary audio"} contentMode="raw" disabled={narrationManifest.length === 0} onPress={controlSelectedAudioVersion} size="sm" variant="icon">{narrationState === "playing" ? <PauseIcon size="sm" /> : <PlayIcon size="sm" />}</Button>
        <Text style={styles.narrationTime}>{formatAudioTime(narrationElapsed)}</Text>
        <Slider accessibilityLabel="Summary audio progress" disabled={narrationDuration <= 0} max={Math.max(1, narrationDuration)} onSlidingComplete={(value) => { setNarrationScrubValue(value); scrubSelectedAudioVersion(value); }} onValueChange={setNarrationScrubValue} style={styles.narrationSlider} value={Math.min(narrationElapsed, narrationDuration)} />
        <Text style={styles.narrationTime}>{formatAudioTime(narrationDuration)}</Text>
      </View>
      {narrationError ? <Text accessibilityRole="alert" numberOfLines={2} style={styles.narrationError}>{narrationError}</Text> : null}
    </View>
  ) : null;

  const documentNarrationIsland = narrationState !== "idle" && narrationStatus !== "SUMMARY AUDIO" ? (
    <View style={styles.narrationPlayer}>
      <View style={styles.narrationHeading}>
        <View style={styles.narrationTitleBlock}>
          <Text numberOfLines={1} style={styles.narrationTitle}>{narrationTitle || "Document audio"}</Text>
        </View>
        <Button accessibilityLabel="Close audio player" contentMode="raw" onPress={dismissNarration} size="xs" variant="icon"><CloseIcon size="sm" /></Button>
      </View>
      <View style={styles.narrationControls}>
        <Button accessibilityLabel={narrationState === "playing" ? "Pause listening" : "Play audio"} contentMode="raw" disabled={narrationManifest.length === 0} loading={narrationManifest.length === 0 && narrationState !== "error"} onPress={controlSelectedAudioVersion} size="sm" variant="icon">{narrationState === "playing" ? <PauseIcon size="sm" /> : <PlayIcon size="sm" />}</Button>
        <Text style={styles.narrationTime}>{formatAudioTime(narrationElapsed)}</Text>
        <Slider accessibilityLabel="Audio progress" disabled={narrationDuration <= 0} max={Math.max(1, narrationDuration)} onSlidingComplete={(value) => { setNarrationScrubValue(value); scrubSelectedAudioVersion(value); }} onValueChange={setNarrationScrubValue} style={styles.narrationSlider} value={Math.min(narrationElapsed, narrationDuration)} />
        <Text style={styles.narrationTime}>{formatAudioTime(narrationDuration)}</Text>
      </View>
      {narrationError ? <Text accessibilityRole="alert" numberOfLines={2} style={styles.narrationError}>{narrationError}</Text> : null}
    </View>
  ) : null;
  const narrationAccessory = activeSheet !== "audioVersions" ? documentNarrationIsland : undefined;
  const tripReturnAccessory = returnToTripAssets ? <Button accessibilityLabel={`Back to ${returnTripName ?? "trip"} assets`} contentMode="raw" onPress={returnToTripAssets} size="sm" style={styles.tripReturn} variant="secondary"><Text numberOfLines={1} style={styles.tripReturnText}>{returnTripName ?? "Trip"}</Text><ChevronRightIcon size="sm" /></Button> : undefined;
  const signalReturnAccessory = returnToSignalAttachments ? <Button accessibilityLabel="Back to Signal attachments" contentMode="raw" onPress={returnToSignalAttachments} size="sm" style={styles.tripReturn} variant="secondary"><Text numberOfLines={1} style={styles.tripReturnText}>Signal attachments</Text><ChevronRightIcon size="sm" /></Button> : undefined;
  const coreAccessory = signalReturnAccessory || tripReturnAccessory || narrationAccessory ? <View style={styles.coreAccessories}>{signalReturnAccessory}{tripReturnAccessory}{narrationAccessory}</View> : undefined;
  const bulkToolbar = selectionActive ? <Tabs style={styles.bulkToolbar}>
    <View style={styles.bulkToolbarSelection}>
      <Button accessibilityLabel="Clear selection" contentMode="raw" onPress={clearSelection} size="xs" style={styles.bulkToolbarClose} variant="secondary"><CloseIcon size="sm" /></Button>
      <Text style={styles.bulkSelectionText}>{selectedCount} selected</Text>
    </View>
    <Button accessibilityLabel="Selected item actions" contentMode="raw" disabled={selectionMetadataLoading} loading={selectionMetadataLoading} onPress={() => openSheet("bulkActions")} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
  </Tabs> : null;
  const filterBadges = !filtersActive ? null : <View style={styles.filterBadgeRow}>
    {showOnlyFavorites ? <View style={styles.similarPill}><Text numberOfLines={1} style={styles.similarPillText}>Favorites</Text><Button accessibilityLabel="Close Favorites filter" contentMode="raw" onPress={() => setViewFilters((current) => ({ ...current, favoritesOnly: false }))} size="xs" variant="icon"><CloseIcon size="sm" /></Button></View> : null}
    {showHidden ? <View style={styles.similarPill}><Text numberOfLines={1} style={styles.similarPillText}>Show hidden</Text><Button accessibilityLabel="Close Show hidden filter" contentMode="raw" onPress={() => setViewFilters((current) => ({ ...current, showHidden: false }))} size="xs" variant="icon"><CloseIcon size="sm" /></Button></View> : null}
  </View>;
  const rootSearchEmpty = Boolean(rootSearchQuery.trim() && !rootSearching && rootSearchResults && (folderContentTab === "folders" ? rootSearchFolders.length === 0 : rootSearchDocuments.length === 0));
  return (
    <KeyboardAvoidingView behavior={aiInputFocused ? "height" : undefined} style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}><WorkspaceAppSwitcher active="archive" /></View>
      {workspaceMode === "viewer" ? <FileViewer
        error={filePreviewError}
        loading={!filePreviewError && !filePreviewUri}
        onBack={leaveFileViewer}
        onMenu={() => { if (selectedDocument) showDocumentActions(selectedDocument); }}
        onRenderError={setFilePreviewError}
        htmlUri={selectedDocument?.extension !== "pdf" ? filePreviewUri : undefined}
        pdfUri={selectedDocument?.extension === "pdf" ? filePreviewUri : undefined}
        title={selectedDocument ? documentDisplayName(selectedDocument) : "File"}
      /> : <View style={styles.workspaceViewport}><ArchiveContentViewport editor={workspaceMode === "editor"} onRefresh={refreshArchive} refreshEnabled={hasContentContext && workspaceMode !== "editor"} refreshing={userRefreshing}>
        {workspaceMode === "auto" || workspaceMode === "folders" ? (
          <View style={styles.archiveRoot}>
            <View style={styles.folderTitleRow}>
              <WorkspaceAppSwitcher active="archive" trigger="back" />
              <Text numberOfLines={1} style={styles.folderTitle}>Archive</Text>
              <Button accessibilityLabel="Create in Archive" contentMode="raw" disabled={locationLoading} onPress={() => openSheet("create")} size="xs" variant="icon"><PlusIcon size="sm" /></Button>
            </View>
            {error ? <Text accessibilityRole="alert" style={styles.notice}>{error}</Text> : null}
            <View style={styles.rootActions}>
              <View style={styles.rootSearch}>
                <SearchIcon size="sm" variant="muted" />
                <TextInput accessibilityLabel="Search all Archive folders, documents, and files" editable={rootSearchFocusable} focusable={rootSearchFocusable} onChangeText={setRootSearchQuery} placeholder="Search..." ref={rootSearchInputRef} style={styles.rootSearchInput} value={rootSearchQuery} />
                {rootSearchQuery.trim() ? <Button accessibilityLabel="Clear Archive search" contentMode="raw" iconOnly onPress={() => setRootSearchQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}
              </View>
              <Button accessibilityLabel="Filter Archive" contentMode="raw" disabled={!hasContentContext} onPress={() => openSheet("filter")} size="sm" style={styles.searchHistoryButton} variant="icon"><FilterIcon size="sm" variant={filtersActive ? "accent" : "default"} /></Button>
            </View>
            {bulkToolbar}
            {filterBadges}
            <View style={[styles.rootContent, rootSearchEmpty && styles.searchRootContent]}>
              <Tabs accessibilityRole="tablist" style={styles.folderTabs}>
                <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "folders" }} onPress={() => setFolderContentTab("folders")} size="xs" style={styles.folderTab} variant={folderContentTab === "folders" ? "secondary" : "ghost"}>Folders</Button>
                <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "documents" }} onPress={() => setFolderContentTab("documents")} size="xs" style={styles.folderTab} variant={folderContentTab === "documents" ? "secondary" : "ghost"}>Documents</Button>
                <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "files" }} onPress={() => setFolderContentTab("files")} size="xs" style={styles.folderTab} variant={folderContentTab === "files" ? "secondary" : "ghost"}>Files</Button>
              </Tabs>
              {rootSearchQuery.trim() ? rootSearching || !rootSearchResults ? folderContentTab === "folders" ? <View accessibilityLabel="Loading folder search results" accessibilityRole="progressbar" style={[styles.rootFolderGrid, styles.loadingGrid]}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.rootFolderCard, styles.skeletonCard, { width: archiveCardSize, height: archiveCardSize }]} />)}</View> : <View accessibilityLabel="Loading search results" accessibilityRole="progressbar" style={styles.rootDocuments}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.documentSkeleton, styles.skeletonCard]} />)}</View> : folderContentTab === "folders" ? <View accessibilityLiveRegion="polite" style={[styles.rootFolderGrid, rootSearchFolders.length === 0 && styles.searchEmptyContent]}>
                {rootSearchFolders.map((folder) => { const selected = selectedFolders.some(({ key }) => key === folder.key); return <View key={folder.key} style={[styles.rootFolderCard, selected && styles.selectedItem, { width: archiveCardSize, height: archiveCardSize }]}><FolderCover folder={folder} /><Button accessibilityState={{ selected }} contentMode="raw" onLongPress={() => handleFolderLongPress(folder)} onPress={() => handleFolderPress(folder)} shape="rounded" size="xl" style={[styles.rootFolderMain, folderHasCover(folder) && styles.coveredFolderMain]} variant="ghost">{folderHasCover(folder) ? null : <FolderIcon size="lg" />}<Text ellipsizeMode="tail" numberOfLines={1} style={[styles.archiveCardLabel, folderHasCover(folder) && styles.coveredFolderLabel]}>{folder.name}</Text></Button>{selected ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}</View>; })}
                {rootSearchFolders.length === 0 ? <Text style={styles.empty}>No folders matched this search.</Text> : null}
              </View> : <View accessibilityLiveRegion="polite" style={[styles.rootDocuments, rootSearchDocuments.length === 0 && styles.searchEmptyContent]}>
                {rootSearchDocuments.map((document) => { const selected = selectedDocuments.some(({ key }) => key === document.documentKey); return <Button accessibilityState={{ selected }} contentMode="raw" key={document.documentKey} onLongPress={() => handleSearchDocumentLongPress(document)} onPress={() => handleSearchDocumentPress(document)} size="sm" style={[styles.documentButton, selected && styles.selectedDocumentItem]} variant={selected ? "ghost" : "secondary"}><FileIcon size="sm" /><Text numberOfLines={1} style={styles.documentButtonLabel}>{documentDisplayName(document)}</Text></Button>; })}
                {rootSearchDocuments.length === 0 ? <Text style={styles.empty}>No {folderContentTab === "files" ? "files" : "documents"} matched this search.</Text> : null}
              </View> : archiveLocationLoading && (folderContentTab !== "folders" || filteredRootFolders.length === 0) ? folderContentTab === "folders" ? <View accessibilityLabel="Loading folders" accessibilityRole="progressbar" style={[styles.rootFolderGrid, styles.loadingGrid]}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.rootFolderCard, styles.skeletonCard, { width: archiveCardSize, height: archiveCardSize }]} />)}</View> : <View accessibilityLabel={`Loading ${folderContentTab}`} accessibilityRole="progressbar" style={styles.rootDocuments}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.documentSkeleton, styles.skeletonCard]} />)}</View> : folderContentTab === "folders" ? (
                <View style={[styles.rootFolderGrid, filteredRootFolders.length === 0 && !archiveLocationLoading && styles.emptyTabContent]}>
                  {filteredRootFolders.length ? filteredRootFolders.map((folder) => {
                    const selected = selectedFolders.some(({ key }) => key === folder.key);
                    return <View key={folder.key} style={[styles.rootFolderCard, selected && styles.selectedItem, { width: archiveCardSize, height: archiveCardSize }]}>
                       <FolderCover folder={folder} />
                       <Button accessibilityState={{ selected }} contentMode="raw" onLongPress={() => handleFolderLongPress(folder)} onPress={() => handleFolderPress(folder)} shape="rounded" size="xl" style={[styles.rootFolderMain, folderHasCover(folder) && styles.coveredFolderMain]} variant="ghost">{folderHasCover(folder) ? null : <FolderIcon size="lg" />}<Text ellipsizeMode="tail" numberOfLines={1} style={[styles.archiveCardLabel, folderHasCover(folder) && styles.coveredFolderLabel]}>{folder.name}</Text></Button>
                       {selected ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
                    </View>;
                  }) : !error ? <View style={styles.folderEmptyState}><Text style={styles.empty}>{showOnlyFavorites ? "No favorite folders." : "No folders here yet."}</Text>{!showOnlyFavorites ? <Button accessibilityLabel="Create folder" contentMode="raw" onPress={openNewFolder} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : null}</View> : null}
                </View>
              ) : (
                <View style={styles.rootDocuments}>
                   {rootTabDocuments.length ? rootTabDocuments.map((document) => (
                    <Button accessibilityState={{ selected: selectedDocuments.some(({ key }) => key === document.key) }} contentMode="raw" key={document.key} onLongPress={() => handleDocumentLongPress(document)} onPress={() => handleDocumentPress(document)} size="sm" style={[styles.documentButton, selectedDocuments.some(({ key }) => key === document.key) && styles.selectedDocumentItem]} variant={selectedDocuments.some(({ key }) => key === document.key) ? "ghost" : "secondary"}>
                      <FileIcon size="sm" />
                      <Text numberOfLines={1} style={styles.documentButtonLabel}>{documentDisplayName(document)}</Text>
                      <ScannedBadge document={document} />
                   </Button>
                  )) : (folderContentTab === "files" ? visibleUploadBatch.length === 0 : !visibleProcessingScan) && !error ? <View style={styles.folderEmptyState}><Text style={styles.empty}>{showOnlyFavorites ? `No favorite ${folderContentTab}.` : folderContentTab === "files" ? "No files here yet." : "No documents here yet."}</Text>{!showOnlyFavorites ? <Button accessibilityLabel={folderContentTab === "files" ? "Upload files" : "Create document"} contentMode="raw" onPress={() => { if (folderContentTab === "files") void pickAndUpload(currentFolder?.key); else startNewNote(); }} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : null}</View> : null}
                  {folderContentTab === "files" && visibleUploadBatch.length ? <LoadingText text={`Processing ${visibleUploadBatch.length} ${visibleUploadBatch.length === 1 ? "file" : "files"}, this might take a while...`} /> : folderContentTab === "documents" && visibleProcessingScan ? <LoadingText text="Processing scanned document, this might take a while..." /> : null}
                  {folderContentTab === "files" ? visibleUploadBatch.map((item) => <ProcessingDocumentButton key={item.id} name={item.name} />) : visibleProcessingScan ? <ProcessingDocumentButton key={visibleProcessingScan.id} name={visibleProcessingScan.name} /> : null}
                </View>
              )}
            </View>
          </View>
        ) : workspaceMode === "folder" ? (
          <View style={styles.archiveFolder}>
            <View style={styles.folderTitleRow}>
              <Button accessibilityLabel={`Back to ${folderStack.at(-2)?.name ?? "folders"}`} contentMode="raw" disabled={selectionActive} onPress={() => void goBackFolder()} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button>
              <Text numberOfLines={1} style={styles.folderTitle}>{currentFolder?.name ?? "Archive"}</Text>
              <View style={styles.folderTitleActions}>
                {currentFolder ? <Button accessibilityLabel={`Manage ${currentFolder.name}`} contentMode="raw" onPress={() => showFolderActions(currentFolder)} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button> : null}
                {!currentFolder?.managed ? <Button accessibilityLabel={`Create in ${currentFolder?.name ?? "Archive"}`} contentMode="raw" onPress={() => openSheet("create")} size="xs" variant="icon"><PlusIcon size="sm" /></Button> : null}
              </View>
            </View>
            {error ? <Text accessibilityRole="alert" style={styles.notice}>{error}</Text> : null}
            <View style={styles.rootActions}>
              <View style={[styles.rootSearch, styles.folderScopedSearch]}>
                <SearchIcon size="sm" variant="muted" />
                <TextInput accessibilityLabel={`Search ${currentFolder?.name ?? "folder"}`} onChangeText={setQuery} placeholder="Search..." style={styles.rootSearchInput} value={query} />
                {query.trim() ? <Button accessibilityLabel="Clear folder search" contentMode="raw" iconOnly onPress={() => setQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}
              </View>
              <Button accessibilityLabel={`Filter ${currentFolder?.name ?? "this folder"}`} contentMode="raw" disabled={!hasContentContext} onPress={() => openSheet("filter")} size="sm" style={styles.searchHistoryButton} variant="icon"><FilterIcon size="sm" variant={filtersActive ? "accent" : "default"} /></Button>
            </View>
            {bulkToolbar}
            {filterBadges}
            <Tabs accessibilityRole="tablist" style={styles.folderTabs}>
              <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "folders" }} onPress={() => setFolderContentTab("folders")} size="xs" style={styles.folderTab} variant={folderContentTab === "folders" ? "secondary" : "ghost"}>Folders</Button>
              <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "documents" }} onPress={() => setFolderContentTab("documents")} size="xs" style={styles.folderTab} variant={folderContentTab === "documents" ? "secondary" : "ghost"}>Documents</Button>
              <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "files" }} onPress={() => setFolderContentTab("files")} size="xs" style={styles.folderTab} variant={folderContentTab === "files" ? "secondary" : "ghost"}>Files</Button>
            </Tabs>
            {query.trim() ? folderSearching || !folderSearchResults ? folderContentTab === "folders" ? <View accessibilityLabel="Loading folder search results" accessibilityRole="progressbar" style={[styles.rootFolderGrid, styles.folderTabContent, styles.loadingGrid]}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.rootFolderCard, styles.skeletonCard, { width: archiveCardSize, height: archiveCardSize }]} />)}</View> : <View accessibilityLabel="Loading search results" accessibilityRole="progressbar" style={[styles.folderDocuments, styles.folderTabContent]}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.documentSkeleton, styles.skeletonCard]} />)}</View> : folderContentTab === "folders" ? (
              <View accessibilityLiveRegion="polite" style={[styles.rootFolderGrid, styles.folderTabContent, folderSearchFolders.length === 0 && styles.searchEmptyContent]}>
                {folderSearchFolders.map((folder) => { const selected = selectedFolders.some(({ key }) => key === folder.key); return <View key={folder.key} style={[styles.rootFolderCard, selected && styles.selectedItem, { width: archiveCardSize, height: archiveCardSize }]}>
                  <FolderCover folder={folder} />
                  <Button accessibilityState={{ selected }} contentMode="raw" onLongPress={() => handleFolderLongPress(folder)} onPress={() => handleFolderPress(folder)} shape="rounded" size="xl" style={[styles.rootFolderMain, folderHasCover(folder) && styles.coveredFolderMain]} variant="ghost">{folderHasCover(folder) ? null : <FolderIcon size="lg" />}<Text ellipsizeMode="tail" numberOfLines={1} style={[styles.archiveCardLabel, folderHasCover(folder) && styles.coveredFolderLabel]}>{folder.name}</Text></Button>
                  {selected ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
                </View>; })}
                {folderSearchFolders.length === 0 ? <Text style={styles.empty}>No folders matched this search.</Text> : null}
              </View>
            ) : <View accessibilityLiveRegion="polite" style={[styles.folderDocuments, styles.folderTabContent, folderSearchDocuments.length === 0 && styles.searchEmptyContent]}>
              {folderSearchDocuments.map((document) => { const selected = selectedDocuments.some(({ key }) => key === document.documentKey); return <Button accessibilityState={{ selected }} contentMode="raw" key={document.documentKey} onLongPress={() => handleSearchDocumentLongPress(document)} onPress={() => handleSearchDocumentPress(document)} size="sm" style={[styles.documentButton, selected && styles.selectedDocumentItem]} variant={selected ? "ghost" : "secondary"}>
                <FileIcon size="sm" />
                <Text numberOfLines={1} style={styles.documentButtonLabel}>{documentDisplayName(document)}</Text>
              </Button>; })}
              {folderSearchDocuments.length === 0 ? <Text style={styles.empty}>No {folderContentTab === "files" ? "files" : "documents"} matched this search.</Text> : null}
            </View> : archiveLocationLoading && (folderContentTab !== "folders" || filteredFolders.length === 0) ? folderContentTab === "folders" ? <View accessibilityLabel="Loading folders" accessibilityRole="progressbar" style={[styles.rootFolderGrid, styles.folderTabContent]}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.rootFolderCard, styles.skeletonCard, { width: archiveCardSize, height: archiveCardSize }]} />)}</View> : <View accessibilityLabel={`Loading ${folderContentTab}`} accessibilityRole="progressbar" style={[styles.folderDocuments, styles.folderTabContent]}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.documentSkeleton, styles.skeletonCard]} />)}</View> : folderContentTab === "folders" ? (
              <View style={[styles.rootFolderGrid, styles.folderTabContent, filteredFolders.length === 0 && !archiveLocationLoading && styles.emptyTabContent, archiveLocationLoading && styles.loadingGrid]}>
                {filteredFolders.length ? filteredFolders.map((folder) => { const selected = selectedFolders.some(({ key }) => key === folder.key); return (
                  <View key={folder.key} style={[styles.rootFolderCard, selected && styles.selectedItem, { width: archiveCardSize, height: archiveCardSize }]}>
                    <FolderCover folder={folder} />
                    <Button accessibilityState={{ selected }} contentMode="raw" onLongPress={() => handleFolderLongPress(folder)} onPress={() => handleFolderPress(folder)} shape="rounded" size="xl" style={[styles.rootFolderMain, folderHasCover(folder) && styles.coveredFolderMain]} variant="ghost">{folderHasCover(folder) ? null : <FolderIcon size="lg" />}<Text ellipsizeMode="tail" numberOfLines={1} style={[styles.archiveCardLabel, folderHasCover(folder) && styles.coveredFolderLabel]}>{folder.name}</Text></Button>
                    {selected ? <View pointerEvents="none" style={styles.selectionBadge}><CheckIcon size="sm" variant="inverse" /></View> : null}
                  </View>
                ); }) : <View style={styles.folderEmptyState}><Text style={styles.empty}>{showOnlyFavorites ? "No favorite folders." : "No folders here yet."}</Text>{!showOnlyFavorites ? <Button accessibilityLabel="Create folder" contentMode="raw" onPress={openNewFolder} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : null}</View>}
              </View>
            ) : (
              <View style={[styles.folderDocuments, styles.folderTabContent]}>
                {folderTabDocuments.length ? folderTabDocuments.map((document) => (
                  <Button accessibilityState={{ selected: selectedDocuments.some(({ key }) => key === document.key) }} contentMode="raw" key={document.key} onLongPress={() => handleDocumentLongPress(document)} onPress={() => handleDocumentPress(document)} size="sm" style={[styles.documentButton, selectedDocuments.some(({ key }) => key === document.key) && styles.selectedDocumentItem]} variant={selectedDocuments.some(({ key }) => key === document.key) ? "ghost" : "secondary"}>
                    <FileIcon size="sm" />
                    <Text numberOfLines={1} style={styles.documentButtonLabel}>{documentDisplayName(document)}</Text>
                    <ScannedBadge document={document} />
                  </Button>
                )) : (folderContentTab === "files" ? visibleUploadBatch.length === 0 : !visibleProcessingScan) ? <View style={styles.folderEmptyState}><Text style={styles.empty}>{showOnlyFavorites ? `No favorite ${folderContentTab}.` : folderContentTab === "files" ? "No files here yet." : "No documents here yet."}</Text>{!showOnlyFavorites ? <Button accessibilityLabel={folderContentTab === "files" ? "Upload files" : "Create document"} contentMode="raw" onPress={() => { if (folderContentTab === "files") void pickAndUpload(currentFolder?.key); else startNewNote(); }} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button> : null}</View> : null}
                {folderContentTab === "files" && visibleUploadBatch.length ? <LoadingText text={`Processing ${visibleUploadBatch.length} ${visibleUploadBatch.length === 1 ? "file" : "files"}, this might take a while...`} /> : folderContentTab === "documents" && visibleProcessingScan ? <LoadingText text="Processing scanned document, this might take a while..." /> : null}
                {folderContentTab === "files" ? visibleUploadBatch.map((item) => <ProcessingDocumentButton key={item.id} name={item.name} />) : visibleProcessingScan ? <ProcessingDocumentButton key={visibleProcessingScan.id} name={visibleProcessingScan.name} /> : null}
              </View>
            )}
          </View>
        ) : (
        <View style={styles.editorScene}>
          <View style={styles.editorHeader}>
            <Button accessibilityLabel={`Back to ${currentFolder?.name ?? "folders"}`} contentMode="raw" onPress={leaveEditor} size="sm" variant="icon"><ChevronLeftIcon size="sm" /></Button>
            <Text numberOfLines={1} style={styles.editorHeaderTitle}>{activeDocument ? documentDisplayName(activeDocument) : title}</Text>
            <Button accessibilityLabel="Manage document" contentMode="raw" disabled={!activeDocument || saveState !== "saved"} onPress={() => { if (activeDocument) showDocumentActions(activeDocument); }} size="sm" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
          </View>
          <View style={styles.editorHeaderActions}>
            {!activeDocument?.managed && (editorEditing
              ? <Button accessibilityLabel="Finish editing document" accessibilityState={{ selected: true }} contentMode="raw" onPress={finishEditing} size="sm" variant="primary"><CheckIcon size="sm" variant="inverse" /></Button>
              : <Button accessibilityLabel="Edit document" contentMode="raw" onPress={() => { persistNarrationPosition(); stopNarration(); setDocumentSearchQuery(""); setEditorEditing(true); }} size="sm" variant="icon"><EditIcon size="sm" /></Button>)}
            {!activeDocument?.managed ? <Button accessibilityLabel="AI document actions" contentMode="raw" onPress={openEnhanceSheet} size="sm" variant="icon"><BrainIcon size="sm" /></Button> : null}
            <Button accessibilityLabel="Document versions and history" contentMode="raw" disabled={!activeDocument || saveState !== "saved"} onPress={() => { if (activeDocument) openHistoryChooser(activeDocument); }} size="sm" variant="icon"><ClockIcon size="sm" /></Button>
          </View>
          <View style={[styles.rootSearch, styles.documentSearch]}>
            <SearchIcon size="sm" variant="muted" />
            <TextInput accessibilityLabel="Search in document" editable={!editorEditing} maxLength={200} onChangeText={setDocumentSearchQuery} onSubmitEditing={() => setDocumentSearchRevision((current) => current + 1)} placeholder="Search in document..." returnKeyType="search" style={styles.rootSearchInput} value={documentSearchQuery} />
            {documentSearchQuery.trim() ? <Button accessibilityLabel="Clear document search" contentMode="raw" iconOnly onPress={() => setDocumentSearchQuery("")} size="xs" variant="secondary"><CloseIcon size="sm" /></Button> : null}
          </View>
          {narrationError ? <Text accessibilityRole="alert" style={styles.documentSearchStatus}>{narrationError}</Text> : null}
          <View style={[styles.noteSheet, (editorFocused || aiInputFocused) && styles.noteSheetFocused]}>
          {openingDocumentKey ? <View accessibilityLabel={`Loading ${title}`} accessibilityRole="progressbar" style={styles.editorSkeleton}>
            <Skeleton style={styles.editorBodySkeleton} />
          </View> : <>
          {error ? <Text accessibilityRole="alert" style={styles.notice}>{error}</Text> : null}
          {saveState === "error" ? (
            <View style={styles.saveErrorRow}>
              <Text style={styles.saveErrorText}>This document has not synced.</Text>
              <Button onPress={() => setSaveRetry((current) => current + 1)} size="xs" variant="secondary">Retry save</Button>
            </View>
          ) : null}

          <ScrollView alwaysBounceVertical contentContainerStyle={styles.editorReadDocument} keyboardShouldPersistTaps="handled" nestedScrollEnabled onLayout={(event) => { editorDocumentViewportHeight.current = event.nativeEvent.layout.height; }} ref={editorDocumentScroll} refreshControl={<PullToRefresh enabled={Boolean(documentKeyRef.current) && !editorEditing && !dirty.current && saveState === "saved"} onRefresh={refreshArchive} refreshing={userRefreshing} />} showsVerticalScrollIndicator={false} style={styles.editorReadScroll}>
            {editorEditing ? <>
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
                  }}
                  onContentSizeChange={(event) => setEditorContentHeight(Math.max(280, Math.ceil(event.nativeEvent.contentSize.height)))}
                  placeholder="Start writing from here..."
                  onFocus={() => setEditorFocused(true)}
                  style={[styles.editor, (editorFocused || aiInputFocused) && styles.editorFocused, { height: editorContentHeight }]}
                  textAlignVertical="top"
                  value={content}
                />
              </View>
            </> : <>
              {currentNotePassages.map((passage) => <View key={passage.id} onLayout={(event) => documentPassageOffsets.current.set(passage.id, { y: event.nativeEvent.layout.y, height: event.nativeEvent.layout.height })}>
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
                } : undefined} ranges={documentSearchMatchesById.get(passage.id)?.ranges} style={styles.editorReadText} text={passage.text} />
              </View>)}
            </>}
          </ScrollView>
          </>}
          </View>
        </View>
        )}
      </ArchiveContentViewport></View>}

      <CoreComposer
        accessory={coreAccessory}
        accessibilityHint="Ask a question, search your Archive, or describe how to change the open document"
        accessibilityLabel="Ask Core about your Archive"
        disabled={!hasContentContext || instructing || saveState === "saving"}
        editable={!instructing}
        leading={<ChromeIcon glow={0.35} size={24} source={assistantIconSource} />}
        leadingAccessibilityLabel="Open document actions"
        leadingDisabled={!hasContentContext || instructing}
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
          if (rootSearchFocusTimer.current) clearTimeout(rootSearchFocusTimer.current);
          rootSearchInputRef.current?.blur();
          Keyboard.dismiss();
          setRootSearchFocusable(false);
          if (!focused) {
            rootSearchFocusTimer.current = setTimeout(() => {
              rootSearchInputRef.current?.blur();
              Keyboard.dismiss();
              setRootSearchFocusable(true);
            }, 300);
          }
          setAiInputFocused(focused);
          if (!focused) {
            setAiResponse(undefined);
            setAiInstructionError(undefined);
          }
        }}
        onLeadingPress={openEnhanceSheet}
        onSubmit={() => void runNoteInstruction()}
        pageIdentity={(closeCore) => <WorkspaceAppSwitcher active="archive" identity="core" onSelectActive={closeCore} />}
        prompts={CORE_PROMPTS}
        sendIcon={<SendIcon size="sm" />}
        value={aiInstruction}
      />

      <SearchHistorySheet error={sheetLoadError ?? sheetError} history={history} loading={historyLoading} onClose={closeSheet} onRemove={(item) => void removeHistoryQuery(item)} onSelect={useHistoryQuery} open={sheetOpen && activeSheet === "searchHistory"} removingQuery={removingHistoryQuery} />

      <BottomSheet
        description={activeSheet === "create" ? "Choose what to add to the current folder." : activeSheet === "transform" ? documentTransformation === "enhance" ? "Review or adjust how this document should be enhanced." : "Review or adjust how this document should be translated." : activeSheet === "documentVersions" ? "Choose a document version to open." : activeSheet === "versions" ? `Choose an ${documentTransformation === "enhance" ? "enhancement" : "translation"} to open.` : activeSheet === "audioVersions" ? "Listen to your saved recordings." : activeSheet === "summarize" ? `Choose one of the ${selectedDocument?.extension ? "file's" : "document's"} primary topics to summarize.` : activeSheet === "summaryVersions" ? "View saved summaries or create a new one." : undefined}
        dismissible={!destinationLoading && !bulkLoading && (!documentActionLoading || documentActionLoading === "enhance" || documentActionLoading === "translate")}
        footer={mutationFooter()}
        focusKey={activeSheet}
        hideHeading={activeSheet === "create" || activeSheet === "documentActions" || activeSheet === "enhance" || activeSheet === "historyChooser" || activeSheet === "filter" || activeSheet === "folderActions" || activeSheet === "bulkActions"}
        height={activeSheet === "documents" || activeSheet === "folder" || activeSheet === "folders" || activeSheet === "searchHistory" || activeSheet === "similar" || activeSheet === "transform" || activeSheet === "documentVersions" || activeSheet === "versions" || activeSheet === "audioVersions" || activeSheet === "summarize" || activeSheet === "summaryVersions" || activeSheet === "summaryReader" || activeSheet === "scanSources" || activeSheet === "destinationBrowser" || activeSheet === "folderDetails" || activeSheet === "documentDetails" ? "full" : undefined}
        onOpenChange={(open) => { if (!open) closeSheet(); }}
        open={sheetOpen && activeSheet !== "searchHistory"}
        title={compactDelete ? deleteConfirmationTitle : activeSheet === "enhance" ? "AI actions" : activeSheet === "transform" ? documentTransformation === "enhance" ? "Enhance document" : "Translate document" : activeSheet === "summarize" ? "Summarize document" : activeSheet === "summaryVersions" ? "Summary versions" : activeSheet === "summaryReader" ? capitalizeLabel(selectedSummary?.topic ?? summaryReaderTopic ?? `Summary ${selectedSummary?.version ?? ""}`) : activeSheet === "historyChooser" ? "Document history" : activeSheet === "searchHistory" ? "Search history" : activeSheet === "similar" ? "Archive" : activeSheet === "documentVersions" ? "Document versions" : activeSheet === "versions" ? documentTransformation === "enhance" ? "Enhancements" : "Translations" : activeSheet === "audioVersions" ? "Audio versions" : activeSheet === "scanSources" ? "Scanned pages" : activeSheet === "folder" ? "Create folder" : activeSheet === "documents" ? "Documents and files" : activeSheet === "folders" ? "Folders" : activeSheet === "destinationBrowser" ? destinationAction === "upload" ? destinationFolder?.name ?? "Archive" : destinationAction === "move" ? "Move to folder" : "Copy to folder" : activeSheet === "library" ? "Browse Archive" : activeSheet === "documentActions" ? selectedDocument?.name ?? "Document actions" : activeSheet === "documentDetails" ? `Edit ${selectedDocument?.extension ? "file" : "document"}` : activeSheet === "destination" ? destinationAction === "upload" ? "Upload files" : "Choose destination" : activeSheet === "folderActions" ? selectedFolder?.name ?? "Folder actions" : activeSheet === "folderDetails" ? "Edit folder" : "New in Archive"}
      >
        {sheetError ? <Text accessibilityRole="alert" style={styles.notice}>{sheetError}</Text> : null}
        {sheetLoadError ? <View style={styles.sheetEmptyContent}><Text accessibilityRole="alert" style={styles.notice}>{sheetLoadError}</Text></View> : <>
        {compactDelete ? <View style={styles.compactSheetActions}>
          <Button disabled={activeSheet === "deleteDocument" ? Boolean(documentActionLoading) : bulkLoading} loading={activeSheet === "deleteDocument" ? documentActionLoading === "delete" : bulkLoading} onPress={() => void (activeSheet === "deleteDocument" ? deleteSelectedDocument() : deleteContentSelection())} size="md" variant="primary">Delete</Button>
          <Button disabled={activeSheet === "deleteDocument" ? Boolean(documentActionLoading) : bulkLoading} onPress={() => closeSheet()} size="md" variant="secondary">Close</Button>
        </View> : null}
        {activeSheet === "create" ? (
          <BottomSheetMenu>
            <BottomSheetItem onPress={openNewFolder} style={styles.sheetAction} variant="secondary">Create folder</BottomSheetItem>
            <BottomSheetItem onPress={() => { void startNewNote(); }} style={styles.sheetAction} variant="secondary">Create document</BottomSheetItem>
            <BottomSheetItem disabled={uploading} loading={uploading} onPress={() => void pickAndUpload(currentFolder?.key)} style={styles.sheetAction} variant="secondary">Upload files</BottomSheetItem>
            <BottomSheetItem disabled={uploading || scanBusy} onPress={startDocumentScan} style={styles.sheetAction} variant="secondary">Scan documents</BottomSheetItem>
          </BottomSheetMenu>
        ) : null}
        {activeSheet === "bulkActions" ? <BottomSheetMenu>
          <Button disabled={bulkLoading} loading={bulkLoading} onPress={() => void updateSelectionFavorite()} size="md" variant="secondary">{allSelectedFavorite ? "Unfavorite" : "Favorite"}</Button>
          {!selectionHasManaged ? <Button disabled={bulkLoading} onPress={() => void openDestinationPicker("move")} size="md" variant="secondary">Move to folder</Button> : null}
          {!selectionHasManaged ? <Button disabled={bulkLoading} onPress={() => void openDestinationPicker("copy")} size="md" variant="secondary">Copy to folder</Button> : null}
          {!selectionHasManaged ? <Button disabled={bulkLoading} onPress={() => pushSheet("bulkDelete")} size="md" variant="secondary">Delete</Button> : null}
        </BottomSheetMenu> : null}
        {activeSheet === "historyChooser" ? (
          <BottomSheetMenu>
            <BottomSheetItem onPress={() => void openDocumentVersionHistory()} style={styles.sheetAction}>Document versions</BottomSheetItem>
            <BottomSheetItem onPress={() => void openAudioVersionHistory()} style={styles.sheetAction}>Audio versions</BottomSheetItem>
            <BottomSheetItem onPress={() => void openSummaryVersionHistory()} style={styles.sheetAction}>Summary versions</BottomSheetItem>
          </BottomSheetMenu>
        ) : null}
        {activeSheet === "filter" ? <View style={styles.filterPanel}>
          <View style={styles.favoriteSwitchRow}>
            <Switch accessibilityLabel="Show only Archive favorites" checked={showOnlyFavorites} onCheckedChange={(checked) => { setViewFilters((current) => ({ ...current, favoritesOnly: checked })); closeSheet(); }} />
            <Text style={styles.favoriteSwitchLabel}>Favorites</Text>
          </View>
          <View style={styles.favoriteSwitchRow}>
            <Switch accessibilityLabel="Show hidden Archive items" checked={showHidden} onCheckedChange={(checked) => { setViewFilters((current) => ({ ...current, showHidden: checked })); closeSheet(); }} />
            <Text style={styles.favoriteSwitchLabel}>Show hidden</Text>
          </View>
          <Button onPress={() => void openSearchHistory()} size="md" style={styles.searchHistoryOption} variant="secondary">Search history</Button>
        </View> : null}
        {activeSheet === "similar" ? (
          <View style={styles.similarPanel}>
            <Tabs accessibilityRole="tablist" style={styles.folderTabs}>
              <Button accessibilityRole="tab" accessibilityState={{ selected: similarContentTab === "folders" }} contentMode="raw" onPress={() => setSimilarContentTab("folders")} size="md" style={styles.similarTab} variant={similarContentTab === "folders" ? "secondary" : "ghost"}><Text numberOfLines={1} style={styles.similarTabText}>Folders</Text></Button>
              <Button accessibilityRole="tab" accessibilityState={{ selected: similarContentTab === "documents" }} contentMode="raw" onPress={() => setSimilarContentTab("documents")} size="md" style={styles.similarTab} variant={similarContentTab === "documents" ? "secondary" : "ghost"}><Text numberOfLines={1} style={styles.similarTabText}>Documents</Text></Button>
              <Button accessibilityRole="tab" accessibilityState={{ selected: similarContentTab === "files" }} contentMode="raw" onPress={() => setSimilarContentTab("files")} size="md" style={styles.similarTab} variant={similarContentTab === "files" ? "secondary" : "ghost"}><Text numberOfLines={1} style={styles.similarTabText}>Files</Text></Button>
            </Tabs>
            {filterBadges}
            <ScrollView contentContainerStyle={styles.similarResults} showsVerticalScrollIndicator={false}>
              {similarLoading && similarContentTab === "folders" ? <View accessibilityLabel="Loading similar folders" accessibilityRole="progressbar" style={styles.rootFolderGrid}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.rootFolderCard, styles.skeletonCard, { width: destinationCardSize, height: destinationCardSize }]} />)}</View> : null}
              {similarLoading && similarContentTab !== "folders" ? <View accessibilityLabel={`Loading similar ${similarContentTab}`} accessibilityRole="progressbar" style={styles.folderDocuments}>{Array.from({ length: 3 }, (_, index) => <Skeleton key={index} style={[styles.documentSkeleton, styles.skeletonCard]} />)}</View> : null}
              {!similarLoading && similarContentTab === "folders" ? <View style={similarResults?.folders.length ? styles.rootFolderGrid : styles.similarEmpty}>
                {similarFolders.map((folder) => <View key={folder.key} style={[styles.rootFolderCard, { width: destinationCardSize, height: destinationCardSize }]}>
                  <FolderCover folder={folder} />
                  <Button contentMode="raw" onPress={() => { closeSheet(); requestAnimationFrame(() => { void openFolder(folder); }); }} shape="rounded" size="md" style={[styles.rootFolderMain, folderHasCover(folder) && styles.coveredFolderMain]} variant="ghost">{folderHasCover(folder) ? null : <FolderIcon size="lg" />}<Text ellipsizeMode="tail" numberOfLines={1} style={[styles.archiveCardLabel, folderHasCover(folder) && styles.coveredFolderLabel]}>{folder.name}</Text></Button>
                </View>)}
                {similarFolders.length === 0 ? <Text style={styles.empty}>No matching folders found.</Text> : null}
              </View> : null}
              {!similarLoading && similarContentTab !== "folders" ? <View style={similarTabDocuments.length > 0 ? styles.folderDocuments : styles.similarEmpty}>
                {similarTabDocuments.map((document) => <Button contentMode="raw" key={document.key} onPress={() => { closeSheet(); requestAnimationFrame(() => { void openArchiveDocument(document); }); }} size="md" style={styles.documentButton} variant="secondary"><FileIcon size="sm" /><Text numberOfLines={1} style={styles.documentButtonLabel}>{documentDisplayName(document)}</Text><ScannedBadge document={document} /></Button>)}
                {similarResults && similarTabDocuments.length === 0 ? <Text style={styles.empty}>No matching {similarContentTab} found.</Text> : null}
              </View> : null}
            </ScrollView>
          </View>
        ) : null}
        {activeSheet === "documentActions" && selectedDocument ? (
          <BottomSheetMenu>
            {!selectedDocument.managed ? <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={openDocumentDetails} style={styles.sheetAction}>Edit</BottomSheetItem> : null}
            <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => void listenToSelectedDocument()} style={styles.sheetAction}>Listen</BottomSheetItem>
            {selectedDocument.extension && selectedDocument.originalAvailable ? <BottomSheetItem disabled={Boolean(documentActionLoading)} loading={documentActionLoading === "original"} onPress={() => {
              if (workspaceModeRef.current === "viewer") { closeSheet(); leaveFileViewer(); }
              else void showOriginal();
            }} style={styles.sheetAction}>{workspaceMode === "viewer" ? "Show text" : "Show original"}</BottomSheetItem> : selectedDocument.sourceImageCount ? <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => void openScanSources()} style={styles.sheetAction}>Show scanned pages</BottomSheetItem> : null}
            <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={downloadOriginal} style={styles.sheetAction}>{selectedDocument.originalAvailable ? "Download original" : "Download text"}</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => void openSimilarContent({ documentKey: selectedDocument.key }, selectedDocument.extension ? "files" : "documents")} style={styles.sheetAction}>Find similar</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => setHiddenOptimistically("document", selectedDocument.key, !hidden("document", selectedDocument.key), selectedDocument.extension ? "File" : "Document")} style={styles.sheetAction}>{hidden("document", selectedDocument.key) ? "Reveal" : "Hide"}</BottomSheetItem>
            {!selectedDocument.managed ? <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => pushSheet("deleteDocument")} style={styles.sheetAction}>Delete {selectedDocument.extension ? "file" : "document"}</BottomSheetItem> : null}
          </BottomSheetMenu>
        ) : null}
        {activeSheet === "scanSources" ? (
          <ScrollView contentContainerStyle={[styles.sourceGrid, !sourceImagesLoading && !sheetError && sourceImages.length === 0 && styles.sheetEmptyContent]} showsVerticalScrollIndicator={false}>
            {sourceImagesLoading ? <View accessibilityLabel="Loading scanned pages" accessibilityRole="progressbar" style={styles.sourceLoading}><Spinner size="large" /></View> : null}
            {!sourceImagesLoading && !sheetError && sourceImages.length === 0 ? <Text style={styles.empty}>No scanned pages found.</Text> : null}
            {sourceImages.map((source) => <View key={source.page} style={styles.sourceCard}><Image contentFit="contain" source={source.url} style={styles.sourceImage} /><Text style={styles.sourceLabel}>Page {source.page}</Text></View>)}
          </ScrollView>
        ) : null}
        {activeSheet === "folderActions" && selectedFolder ? (
          <BottomSheetMenu>
            {!selectedFolder.managed ? <BottomSheetItem onPress={openFolderDetails} style={styles.sheetAction}>Edit</BottomSheetItem> : null}
            {!selectedFolder.managed ? <BottomSheetItem onPress={() => void openDestinationPicker("move", { folder: selectedFolder })} style={styles.sheetAction}>Move folder</BottomSheetItem> : null}
            {!selectedFolder.managed ? <BottomSheetItem onPress={() => void openDestinationPicker("copy", { folder: selectedFolder })} style={styles.sheetAction}>Copy to folder</BottomSheetItem> : null}
            <BottomSheetItem onPress={() => void openSimilarContent({ folderKey: selectedFolder.key }, "folders")} style={styles.sheetAction}>Find similar</BottomSheetItem>
            <BottomSheetItem onPress={() => setHiddenOptimistically("folder", selectedFolder.key, !hidden("folder", selectedFolder.key), "Folder")} style={styles.sheetAction}>{hidden("folder", selectedFolder.key) ? "Reveal" : "Hide"}</BottomSheetItem>
            {!selectedFolder.managed ? <BottomSheetItem onPress={confirmSelectedFolderDelete} style={styles.sheetAction}>Delete folder</BottomSheetItem> : null}
          </BottomSheetMenu>
        ) : null}
        {activeSheet === "folderDetails" && selectedFolder ? (
          <View style={styles.folderDetailsForm}>
            <TextInput accessibilityLabel="Folder name" maxLength={255} onChangeText={setFolderDetailsName} placeholder="Folder name" value={folderDetailsName} />
            <Text style={styles.inputLabel}>Description (Optional)</Text>
            <TextInput accessibilityLabel="Folder description" maxLength={2000} multiline onChangeText={setFolderDetailsDescription} placeholder="What belongs in this folder?" style={styles.folderDescriptionInput} textAlignVertical="top" value={folderDetailsDescription} />
            <View style={styles.folderDetailsCoverControl}>
              <Button accessibilityLabel={(folderDetailsCoverAsset === undefined ? selectedFolder.coverUrl : folderDetailsCoverAsset?.uri) ? "Change folder cover" : "Set folder cover"} contentMode="raw" onPress={() => void chooseFolderCover()} shape="rounded" size="md" style={styles.folderDetailsCoverButton} variant="secondary">
                {(folderDetailsCoverAsset === undefined ? selectedFolder.coverUrl : folderDetailsCoverAsset?.uri)
                  ? <Image contentFit="cover" source={folderDetailsCoverAsset === undefined ? selectedFolder.coverUrl : folderDetailsCoverAsset?.uri} style={styles.folderCover} />
                  : <FolderIcon size="lg" />}
              </Button>
              {(folderDetailsCoverAsset === undefined ? selectedFolder.coverUrl : folderDetailsCoverAsset?.uri) ? <Button accessibilityLabel="Remove folder cover" contentMode="raw" iconOnly onPress={clearFolderCover} size="md" style={styles.folderDetailsCoverRemove} variant="secondary"><CloseIcon size="sm" /></Button> : null}
            </View>
            <View style={styles.favoriteSwitchRow}>
              <Switch accessibilityLabel="Favorite folder" checked={folderDetailsFavorite} onCheckedChange={setFolderDetailsFavorite} />
              <Text style={styles.favoriteSwitchLabel}>Favorite</Text>
            </View>
          </View>
        ) : null}
        {activeSheet === "documentDetails" && selectedDocument ? (
          <View style={styles.documentDetailsForm}>
            <TextInput accessibilityLabel={`${selectedDocument.extension ? "File" : "Document"} name`} maxLength={255} onChangeText={setDocumentDetailsName} placeholder={`${selectedDocument.extension ? "File" : "Document"} name`} value={documentDetailsName} />
            <View style={styles.favoriteSwitchRow}>
              <Switch accessibilityLabel={`Favorite ${selectedDocument.extension ? "file" : "document"}`} checked={documentDetailsFavorite} onCheckedChange={setDocumentDetailsFavorite} />
              <Text style={styles.favoriteSwitchLabel}>Favorite</Text>
            </View>
          </View>
        ) : null}
        {activeSheet === "summarize" && !selectedDocument?.managed ? (
          <ScrollView contentContainerStyle={[styles.summaryTopicPanel, !loadingSummaryTopics && !sheetError && summaryTopics.length === 0 && styles.sheetEmptyContent]} showsVerticalScrollIndicator={false} style={styles.summaryTopicScroll}>
            {!loadingSummaryTopics && !sheetError && summaryTopics.length === 0 ? <Text style={styles.empty}>No topics were found in this document.</Text> : null}
            {loadingSummaryTopics ? Array.from({ length: 3 }, (_, index) => (
              <Skeleton accessibilityLabel="Generating document topics" accessibilityRole="progressbar" key={index} style={[styles.documentSkeleton, styles.skeletonCard]} />
            )) : summaryTopics.map((topic) => <Button contentMode="raw" disabled={generatingSummary} key={topic} onPress={() => void generateSummaryForTopic(topic)} size="md" style={styles.documentButton} variant="secondary"><FileIcon size="sm" /><Text numberOfLines={1} style={styles.documentButtonLabel}>{capitalizeLabel(topic)}</Text></Button>)}
          </ScrollView>
        ) : null}
        {activeSheet === "summaryVersions" ? (
          <View style={styles.summaryVersionPanel}>
            <ScrollView contentContainerStyle={[styles.audioVersionList, !loadingSummaries && summaries.length === 0 && styles.sheetEmptyContent]} showsVerticalScrollIndicator={false} style={styles.sheetList}>
              {!loadingSummaries && summaries.length === 0 ? <Text style={styles.empty}>No summaries yet.</Text> : null}
              {loadingSummaries ? Array.from({ length: 3 }, (_, index) => (
                <Skeleton accessibilityLabel={generatingSummary ? "Generating document summary" : "Loading summary versions"} accessibilityRole="progressbar" key={index} style={styles.audioVersionSkeletonRow} />
              )) : summaries.map((summary) => (
                <Button contentMode="raw" key={summary.key} onPress={() => openSummaryReader(summary)} size="md" style={styles.versionMain} variant="secondary">
                  <FileIcon size="md" />
                  <View style={styles.resultText}><Text numberOfLines={1} style={styles.rowTitle}>{capitalizeLabel(summary.topic ?? `Summary ${summary.version}`)}</Text><Text style={styles.rowSubtitle}>Version {summary.version} · {new Date(summary.createdAt).toLocaleString()}</Text></View>
                </Button>
              ))}
            </ScrollView>
          </View>
        ) : null}
        {activeSheet === "summaryReader" ? (
          <ScrollView contentContainerStyle={[styles.summaryReader, !generatingSummary && !selectedSummary && styles.sheetEmptyContent]} showsVerticalScrollIndicator={false}>
            {generatingSummary ? <View accessibilityLabel="Generating document summary" accessibilityRole="progressbar" style={styles.summaryReaderSkeleton}>
              <Skeleton style={styles.summaryReaderSkeletonTitle} />
              <Skeleton style={styles.summaryReaderSkeletonText} />
            </View> : selectedSummary ? <SummaryText value={selectedSummary.summary} /> : <Text style={styles.empty}>No summary available.</Text>}
          </ScrollView>
        ) : null}
        {activeSheet === "destination" ? (
          <View style={styles.destinationPanel}>
            <BottomSheetItem disabled={destinationLoading} loading={destinationLoading} onPress={() => void openDestinationBrowser()} style={styles.sheetAction}>Choose folder</BottomSheetItem>
          </View>
        ) : null}
        {activeSheet === "destinationBrowser" ? (
          <View style={styles.destinationBrowser}>
            <View style={styles.destinationLocationLane}>
              {destinationStack.length > 0 ? <Button accessibilityLabel={`Back to ${destinationStack.at(-2)?.name ?? "Archive"}`} contentMode="raw" onPress={() => void browseDestination(undefined, true)} size="md" variant="icon"><ChevronLeftIcon size="sm" /></Button> : null}
              <Text numberOfLines={1} style={styles.destinationLocationTitle}>{destinationFolder?.name ?? "Archive"}</Text>
            </View>
            <ScrollView contentContainerStyle={[styles.destinationFolderGrid, !destinationLoading && !sheetError && destinationFolders.length === 0 && styles.sheetEmptyContent]} keyboardShouldPersistTaps="handled" style={styles.folderList}>
              {destinationLoading ? Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Loading folders" accessibilityRole="progressbar" key={index} style={[styles.rootFolderCard, styles.skeletonCard, { width: destinationCardSize, height: destinationCardSize }]} />) : null}
              {!destinationLoading && !sheetError && destinationFolders.length === 0 ? <Text style={styles.empty}>No subfolders here.</Text> : null}
              {destinationFolders.map((folder) => {
                return <View key={folder.key} style={[styles.rootFolderCard, { width: destinationCardSize, height: destinationCardSize }]}>
                  <FolderCover folder={folder} />
                  <Button accessibilityLabel={`Open ${folder.name}`} contentMode="raw" onPress={() => void browseDestination(folder)} shape="rounded" size="md" style={[styles.rootFolderMain, folderHasCover(folder) && styles.coveredFolderMain]} variant="ghost">{folderHasCover(folder) ? null : <FolderIcon size="lg" />}<Text ellipsizeMode="tail" numberOfLines={1} style={[styles.archiveCardLabel, folderHasCover(folder) && styles.coveredFolderLabel]}>{folder.name}</Text></Button>
                </View>;
              })}
            </ScrollView>
          </View>
        ) : null}
        {activeSheet === "enhance" && !activeDocument?.managed ? (
          <View style={styles.enhancePanel}>
            <Button onPress={() => void requestDocumentAiAction("summarize")} size="md" variant="secondary">Summarize document</Button>
            <Button onPress={() => void requestDocumentAiAction("enhance")} size="md" variant="secondary">Enhance document</Button>
            <Button onPress={() => void requestDocumentAiAction("translate")} size="md" variant="secondary">Translate document</Button>
          </View>
        ) : null}
        {activeSheet === "transform" ? <View style={styles.transformationForm}>
          <Text style={styles.inputLabel}>Language</Text><TextInput accessibilityLabel="Translation language" maxLength={100} onChangeText={updateTranslationTargetLanguage} placeholder="Language" value={translationTargetLanguage} />
        </View> : null}
        {activeSheet === "versions" || activeSheet === "documentVersions" ? (
          <View style={[styles.versionPanel, !loadingVersions && !pendingDocumentVersionLabel && versions.length === 0 && styles.sheetEmptyContent]}>
            {loadingVersions && !pendingDocumentVersionLabel ? Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Loading version history" accessibilityRole="progressbar" key={index} style={[styles.versionSkeleton, styles.skeletonCard]} />) : null}
            {!loadingVersions && !pendingDocumentVersionLabel && versions.length === 0 ? <Text style={styles.empty}>{activeSheet === "documentVersions" ? "No document versions yet." : `No ${documentTransformation === "enhance" ? "enhancements" : "translations"} yet.`}</Text> : null}
            {versions.map((version) => {
              const document = activeDocument?.key === version.documentKey ? activeDocument : selectedDocument?.key === version.documentKey ? selectedDocument : undefined;
              const isCurrentVersion = document?.currentVersionKey === version.key;
              return <View key={version.key} style={styles.versionRow}>
                <Button accessibilityState={{ selected: isCurrentVersion }} contentMode="raw" onPress={() => void openDocumentVersion(version)} size="md" style={[styles.versionMain, isCurrentVersion && styles.selectedDocumentItem]} variant="secondary"><ClockIcon size="sm" variant="accent" /><Text numberOfLines={1} style={styles.documentButtonLabel}>Version {version.version}</Text></Button>
              </View>;
            })}
            {activeSheet === "versions" && pendingDocumentVersionLabel ? <Skeleton accessibilityLabel={pendingDocumentVersionLabel} accessibilityRole="progressbar" style={styles.versionSkeleton} /> : null}
          </View>
        ) : null}
        {activeSheet === "audioVersions" ? (
          <View style={styles.audioVersionPanel}>
            <ScrollView accessibilityLabel={loadingAudioVersions ? "Loading audio versions" : undefined} accessibilityRole={loadingAudioVersions ? "progressbar" : undefined} contentContainerStyle={[styles.audioVersionList, !loadingAudioVersions && audioVersions.length === 0 && styles.sheetEmptyContent]} showsVerticalScrollIndicator={false} style={styles.sheetList}>
              {!loadingAudioVersions && audioVersions.length === 0 ? <Text style={styles.empty}>No saved audio versions.</Text> : null}
              {loadingAudioVersions ? Array.from({ length: 3 }, (_, index) => (
                <Skeleton key={index} style={[styles.documentSkeleton, styles.skeletonCard]} />
              )) : audioVersions.map((version) => (
                <Button contentMode="raw" key={version.key} onPress={() => void playAudioVersion(version, selectedAudioVersionKey === version.key ? narrationElapsed : version.isCurrent ? version.playbackPositionMs / 1_000 : 0)} size="md" style={styles.documentButton} variant="secondary">
                  <PlayIcon size="sm" />
                  <Text numberOfLines={1} style={styles.documentButtonLabel}>Audio version {version.version}</Text>
                </Button>
              ))}
            </ScrollView>
          </View>
        ) : null}
        {activeSheet === "folder" ? (
          <View style={styles.namingForm}>
            <Text style={styles.inputLabel}>Folder name</Text>
            <TextInput accessibilityLabel="New folder name" maxLength={255} onChangeText={setFolderName} placeholder="Folder name" value={folderName} />
            <Text style={styles.inputLabel}>Description (Optional)</Text>
            <TextInput accessibilityLabel="New folder description" maxLength={2000} multiline onChangeText={setFolderDescription} placeholder="What belongs in this folder?" style={styles.folderDescriptionInput} textAlignVertical="top" value={folderDescription} />
          </View>
        ) : null}
        {activeSheet === "library" ? (
          <View style={styles.libraryChoices}>
            <Button icon={<FileIcon size="lg" />} onPress={() => { setLibraryQuery(""); pushSheet("documents"); }} size="md" style={styles.libraryChoice} variant="secondary">Documents</Button>
            <Button icon={<FolderIcon size="lg" />} onPress={() => { setLibraryQuery(""); pushSheet("folders"); }} size="md" style={styles.libraryChoice} variant="secondary">Folders</Button>
          </View>
        ) : null}
        {activeSheet === "folders" ? (
          <>
            <View style={styles.folderSearchRow}>
              <View style={styles.folderSearch}>
                <SearchIcon size="sm" variant="muted" />
                <TextInput accessibilityLabel="Search Archive folders" onChangeText={setLibraryQuery} placeholder="Search..." style={styles.folderSearchInput} value={libraryQuery} />
                {libraryQuery.trim() ? <Button accessibilityLabel="Clear Archive folder picker search" contentMode="raw" iconOnly onPress={() => setLibraryQuery("")} size="md" variant="secondary"><CloseIcon size="sm" /></Button> : null}
              </View>
              <Button accessibilityLabel="Filter Archive folders" contentMode="raw" onPress={() => openSheet("filter")} size="md" style={styles.searchHistoryButton} variant="icon"><FilterIcon size="sm" variant={filtersActive ? "accent" : "default"} /></Button>
            </View>
            {filterBadges}
            <ScrollView contentContainerStyle={[styles.folderGrid, !showArchiveRoot && visibleFolders.length === 0 && styles.sheetEmptyContent]} keyboardShouldPersistTaps="handled" style={styles.folderList}>
              {showArchiveRoot ? <Button icon={<ArchiveIcon size="md" />} onPress={() => void selectRootFolder()} size="md" style={styles.folderTile} variant="secondary">Archive</Button> : null}
              {libraryQuery.trim() && (librarySearching || !librarySearchResults) ? Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Loading Archive folder picker search" accessibilityRole="progressbar" key={index} style={styles.folderTileSkeleton} />) : visibleFolders.map((folder) => (
                <View key={folder.key} style={styles.managedTile}>
                  <Button icon={<FolderIcon size="md" />} onPress={() => void selectFolder(folder)} size="md" style={styles.managedTileMain} variant="secondary">{folder.name}</Button>
                  <Button accessibilityLabel={`Manage ${folder.name}`} contentMode="raw" onPress={() => showFolderActions(folder)} size="md" style={styles.managedTileAction} variant="icon"><MoreHorizontalIcon size="sm" /></Button>
                </View>
              ))}
              {!librarySearching && librarySearchResults && !showArchiveRoot && visibleFolders.length === 0 ? <Text style={styles.empty}>No folders match this search.</Text> : null}
            </ScrollView>
          </>
        ) : null}
        {activeSheet === "documents" ? (
          <>
            <View style={styles.folderSearchRow}>
              <View style={styles.folderSearch}>
                <SearchIcon size="sm" variant="muted" />
                <TextInput accessibilityLabel="Search Archive documents and files" onChangeText={setLibraryQuery} placeholder="Search..." style={styles.folderSearchInput} value={libraryQuery} />
                {libraryQuery.trim() ? <Button accessibilityLabel="Clear Archive document picker search" contentMode="raw" iconOnly onPress={() => setLibraryQuery("")} size="md" variant="secondary"><CloseIcon size="sm" /></Button> : null}
              </View>
              <Button accessibilityLabel="Filter Archive documents and files" contentMode="raw" onPress={() => openSheet("filter")} size="md" style={styles.searchHistoryButton} variant="icon"><FilterIcon size="sm" variant={filtersActive ? "accent" : "default"} /></Button>
            </View>
            {filterBadges}
            <ScrollView contentContainerStyle={[styles.folderGrid, visibleDocuments.length === 0 && styles.sheetEmptyContent]} keyboardShouldPersistTaps="handled" style={styles.folderList}>
              {libraryQuery.trim() && (librarySearching || !librarySearchResults) ? Array.from({ length: 3 }, (_, index) => <Skeleton accessibilityLabel="Loading Archive document picker search" accessibilityRole="progressbar" key={index} style={styles.folderTileSkeleton} />) : visibleDocuments.map((document) => (
                <Button contentMode="raw" key={"documentKey" in document ? document.documentKey : document.key} onPress={() => void ("documentKey" in document ? openLibrarySearchDocument(document) : openArchiveDocument(document, true))} size="md" style={styles.folderTile} variant="secondary">
                  <FileIcon size="md" /><Text numberOfLines={1} style={styles.folderTileLabel}>{documentDisplayName(document)}</Text>{"documentKey" in document ? null : <ScannedBadge document={document} />}
                </Button>
              ))}
              {!librarySearching && librarySearchResults && visibleDocuments.length === 0 ? <Text style={styles.empty}>No documents or files match this search.</Text> : null}
            </ScrollView>
          </>
        ) : null}
        </>}
      </BottomSheet>
      {scanOpen ? <DocumentScanModal busy={scanBusy} error={scanError} onClose={() => { setScanOpen(false); setScanError(undefined); }} onSubmit={(pages) => void submitDocumentScan(pages)} /> : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md, justifyContent: "center", borderBottomColor: palette.hairline, borderBottomWidth: 1 },
  workspaceViewport: { flex: 1, minHeight: 0 },
  scrollView: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  archiveRoot: { flexGrow: 1, gap: spacing.md },
  archiveFolder: { flexGrow: 1, gap: spacing.md },
  editorViewportContent: { flex: 1, minHeight: 0 },
  editorScene: { flex: 1, minHeight: 0, width: "100%", gap: spacing.sm },
  editorHeader: { minHeight: 40, minWidth: 0, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  editorHeaderTitle: { flex: 1, minWidth: 0, color: palette.silver50, fontFamily: fonts.medium, fontSize: 15, lineHeight: 20 },
  editorHeaderActions: { minHeight: 40, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 8 },
  rootActions: { minHeight: 52, marginTop: -spacing.xs, flexDirection: "row", alignItems: "center", gap: 8 },
  bulkToolbar: { minHeight: 40, padding: 5, flexDirection: "row", alignItems: "center", justifyContent: "space-between", borderWidth: 1, backgroundColor: palette.panel },
  bulkToolbarSelection: { flexDirection: "row", alignItems: "center", gap: 8 },
  bulkToolbarClose: { height: 28, width: 28, paddingHorizontal: 0, paddingVertical: 0 },
  bulkSelectionText: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 12 },
  rootSearch: { minHeight: 44, flex: 1, paddingLeft: 12, paddingRight: 8, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page },
  documentSearch: { flex: 0, width: "100%" },
  documentSearchStatus: { minHeight: 16, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16, textAlign: "right" },
  documentSearchHighlight: { color: palette.silver50, backgroundColor: "rgba(206, 170, 92, 0.36)" },
  folderScopedSearch: { flex: 1 },
  folderSearchRow: { minHeight: 44, marginTop: spacing.xxs, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  searchHistoryButton: { width: 44, height: 44 },
  rootSearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  rootSearchResults: { gap: 7 },
  rootContent: { width: "100%", gap: spacing.md },
  searchRootContent: { flexGrow: 1 },
  searchEmptyContent: { flexGrow: 1, width: "100%", flexDirection: "column", alignContent: "center", alignItems: "center", justifyContent: "center" },
  emptyTabContent: { flexDirection: "column", flexWrap: "nowrap", alignContent: "stretch" },
  rootDocuments: { width: "100%", gap: 7 },
  rootFolderGrid: { width: "100%", alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10 },
  loadingGrid: { flex: 1 },
  rootFolderCard: { position: "relative", borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised, overflow: "hidden" },
  selectedItem: { borderColor: palette.silver50, shadowColor: palette.silver50, shadowOffset: { width: 0, height: 0 }, shadowOpacity: 0.62, shadowRadius: 5, elevation: 4 },
  selectionBadge: { position: "absolute", top: 4, right: 4, width: 20, height: 20, alignItems: "center", justifyContent: "center", borderRadius: 10, backgroundColor: palette.silver50 },
  selectedDocumentItem: { borderColor: palette.silver50, borderWidth: 1, backgroundColor: "transparent" },
  rootFolderMain: { height: "100%", width: "100%", flexDirection: "column", justifyContent: "center", gap: 10, paddingHorizontal: 8 },
  folderCover: StyleSheet.absoluteFill,
  managedFolderLogo: { position: "absolute", top: spacing.sm, right: spacing.sm, bottom: spacing.sm, left: spacing.sm },
  coveredFolderMain: { justifyContent: "flex-end", paddingBottom: 10 },
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
  folderDocuments: { width: "100%", gap: 7 },
  folderTabContent: { flexGrow: 1 },
  similarPanel: { flex: 1, minHeight: 0, gap: spacing.md },
  similarTab: { minWidth: 0, flex: 1, minHeight: 34, paddingHorizontal: 8, paddingVertical: 8 },
  similarTabText: { color: palette.silver100, fontFamily: fonts.semibold, fontSize: 11, letterSpacing: 0.88, lineHeight: 14 },
  similarResults: { flexGrow: 1, paddingBottom: spacing.lg },
  similarEmpty: { flexGrow: 1, minHeight: 320, alignItems: "center", justifyContent: "center" },
  folderEmptyState: { flexGrow: 1, minHeight: 360, width: "100%", alignItems: "center", justifyContent: "center", gap: 14 },
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
  noteSheet: { flex: 1, minHeight: 0, width: "100%", padding: spacing.md, borderRadius: radii.xl, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page, overflow: "hidden" },
  editorSkeleton: { flex: 1, gap: spacing.lg },
  editorBodySkeleton: { flex: 1, minHeight: 280, borderRadius: radii.md, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  noteSheetFocused: { flex: 1, minHeight: 0 },
  metaRow: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteActions: { flexDirection: "row", gap: 8 },
  folderContext: { flexDirection: "row", alignItems: "center", gap: 6 },
  folderContextBack: { flex: 1, justifyContent: "flex-start" },
  notice: { marginBottom: 12, padding: 10, borderRadius: radii.sm, color: palette.silver300, backgroundColor: "rgba(120, 76, 40, 0.24)", fontFamily: fonts.regular, fontSize: 12 },
  saveErrorRow: { marginBottom: 10, padding: 10, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radii.sm, borderColor: palette.hairline, borderWidth: 1 },
  saveErrorText: { flex: 1, color: palette.silver300, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  editorFrame: { minHeight: 280, width: "100%", position: "relative", overflow: "hidden" },
  editorFrameFocused: { minHeight: 280 },
  editor: { minHeight: 280, width: "100%", paddingHorizontal: 0, paddingVertical: 0, borderWidth: 0, backgroundColor: "transparent", color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26, textAlign: "left", writingDirection: "ltr" },
  editorReadScroll: { flex: 1, minHeight: 0, width: "100%" },
  editorReadDocument: { flexGrow: 1, width: "100%", gap: spacing.md, paddingBottom: spacing.xl },
  editorReadText: { width: "100%", color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26, textAlign: "left", writingDirection: "ltr" },
  editorFocused: { minHeight: 280 },
  aiComposerError: { paddingHorizontal: 8, color: "#D98B8B", fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  aiResponse: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, gap: 3, borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panel },
  aiResponseText: { color: palette.text, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  aiResponseSources: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  coreAccessories: { width: "100%", gap: spacing.xs },
  tripReturn: { width: "100%", minHeight: 40, justifyContent: "flex-start", paddingHorizontal: spacing.sm },
  tripReturnText: { minWidth: 0, flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14, textAlign: "left" },
  narrationPlayer: { marginHorizontal: 4, marginBottom: spacing.xs, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, gap: spacing.xs, borderRadius: radii.lg, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.voidBlack },
  narrationHeading: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  narrationTitleBlock: { flex: 1, gap: 2 },
  narrationTitle: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 13 },
  narrationControls: { flexDirection: "row", alignItems: "center", gap: spacing.xs },
  narrationSlider: { flex: 1 },
  narrationTime: { minWidth: 32, color: palette.silver300, fontFamily: fonts.regular, fontSize: 10, textAlign: "center" },
  narrationError: { color: "#D98B8B", fontFamily: fonts.regular, fontSize: 10, lineHeight: 14 },
  summaryNarrationSpinner: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  enhancePanel: { gap: 6 },
  transformationForm: { flex: 1, gap: spacing.sm },
  filterPanel: { gap: 6 },
  searchHistoryOption: { backgroundColor: palette.page },
  filterBadgeRow: { flexDirection: "row", flexWrap: "wrap", alignItems: "center", gap: spacing.xs },
  similarPill: { alignSelf: "flex-start", maxWidth: "100%", minHeight: 38, padding: 4, paddingLeft: 5, flexDirection: "row", alignItems: "center", gap: 7, borderWidth: 1, borderColor: palette.hairline, borderRadius: 999, backgroundColor: palette.panel },
  similarPillText: { maxWidth: 210, color: palette.silver300, fontFamily: fonts.medium, fontSize: 11 },
  enhanceIdentity: { padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panel },
  enhanceCopy: { flex: 1, gap: 4 },
  versionPanel: { gap: 6 },
  versionSkeleton: { width: "100%", height: 42, borderRadius: 999 },
  versionRow: { flexDirection: "row", alignItems: "stretch", gap: 6 },
  versionMain: { flex: 1, justifyContent: "flex-start", paddingHorizontal: 14 },
  historyChoices: { gap: 6 },
  sheetEmptyContent: { flexGrow: 1, alignContent: "center", alignItems: "center", justifyContent: "center" },
  sheetList: { flex: 1 },
  audioVersionPanel: { flex: 1, minHeight: 0, gap: spacing.md },
  audioVersionList: { gap: 6, paddingBottom: spacing.xl },
  audioVersionSkeletonRow: { minHeight: 52, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: spacing.sm, borderRadius: radii.lg, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised, opacity: 0.72 },
  summaryTopicScroll: { flex: 1, minHeight: 0 },
  summaryTopicPanel: { flexGrow: 1, gap: spacing.sm, paddingBottom: spacing.xl },
  summaryVersionPanel: { flex: 1, minHeight: 0, gap: spacing.md },
  summaryReader: { flexGrow: 1, gap: spacing.md, paddingBottom: spacing.xl },
  summaryReaderSkeleton: { gap: spacing.lg },
  summaryReaderSkeletonTitle: { height: 18, width: "38%", borderRadius: radii.sm, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  summaryReaderSkeletonText: { height: 160, width: "100%", borderRadius: radii.md, backgroundColor: palette.hairlineBright, opacity: 0.72 },
  summarySections: { gap: spacing.lg },
  summarySection: { gap: spacing.xs },
  summarySectionTitle: { color: palette.silver50, fontFamily: fonts.medium, fontSize: 16, lineHeight: 22 },
  summaryText: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 24 },
  destinationPanel: { flex: 1, gap: 12 },
  bulkActionList: { width: "100%", gap: spacing.sm },
  compactSheetActions: { width: "100%", gap: spacing.sm, padding: 2 },
  sheetAction: { justifyContent: "center" },
  destinationBrowser: { flex: 1, minHeight: 0, gap: spacing.sm },
  destinationLocationLane: { minHeight: 40, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  destinationLocationTitle: { flex: 1, color: palette.silver100, fontFamily: fonts.medium, fontSize: 14 },
  destinationFolders: { gap: 8, paddingVertical: 4 },
  destinationFolderGrid: { alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10, paddingVertical: 4 },
  invalidDestinationHelp: { alignSelf: "stretch", color: palette.muted, fontFamily: fonts.regular, fontSize: 13, lineHeight: 18, textAlign: "left" },
  uploadDestinationButton: { justifyContent: "flex-start", paddingHorizontal: 14 },
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
  folderDetailsForm: { gap: spacing.lg, paddingBottom: spacing.xs },
  folderDetailsCoverControl: { width: 88, height: 88, position: "relative", alignSelf: "flex-start" },
  folderDetailsCoverButton: { width: 88, height: 88, paddingHorizontal: 0, paddingVertical: 0, overflow: "hidden" },
  folderDetailsCoverRemove: { width: 42, height: 42, minHeight: 42, paddingHorizontal: 0, paddingVertical: 0, position: "absolute", right: -12, top: -12 },
  documentDetailsForm: { gap: 12, paddingBottom: spacing.xs },
  favoriteSwitchRow: { minHeight: 32, flexDirection: "row", alignItems: "center", gap: spacing.xs },
  favoriteSwitchLabel: { color: palette.muted, fontFamily: fonts.regular, fontSize: 12 },
  inputLabel: { marginLeft: 2, color: palette.silver300, fontFamily: fonts.medium, fontSize: 12, letterSpacing: 0.4 },
  folderDescriptionInput: { minHeight: 120 },
  libraryChoices: { gap: 10 },
  libraryChoice: { minHeight: 72, width: "100%", gap: 10 },
  folderSearch: { minHeight: 48, flex: 1, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.page },
  folderSearchInput: { flex: 1, minHeight: 40, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 13 },
  folderGrid: { paddingTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  folderList: { flex: 1 },
  folderTile: { minHeight: 86, flexBasis: "48%", flexDirection: "column", gap: 8, paddingHorizontal: 10 },
  folderTileSkeleton: { minHeight: 86, flexBasis: "48%", borderRadius: radii.md },
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
