import { useNavigation } from "expo-router";
import { File, Paths } from "expo-file-system";
import * as ImageManipulator from "expo-image-manipulator";
import * as ImagePicker from "expo-image-picker";
import { Image } from "expo-image";
import { useEffect, useRef, useState } from "react";
import { BackHandler, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useQueryClient } from "@tanstack/react-query";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Badge } from "@vorinthex/shared/ui/badge";
import { Button } from "@vorinthex/shared/ui/button";
import { CoreComposer } from "@vorinthex/shared/ui/core-composer";
import { FileViewer } from "@vorinthex/shared/ui/file-viewer";
import { Tabs } from "@vorinthex/shared/ui/tabs";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import { useToast } from "@vorinthex/shared/ui/toast";
import { Spinner } from "@vorinthex/shared/ui/spinner";
import {
  ArchiveIcon,
  BrainIcon,
  CheckIcon,
  ChevronLeftIcon,
  ClockIcon,
  DownloadIcon,
  EditIcon,
  FileIcon,
  FolderIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  CloseIcon,
} from "@vorinthex/shared/ui/icons-mobile";

import { WorkspaceAppSwitcher } from "@/components/capability/WorkspaceAppSwitcher";
import { DocumentScanModal, type DocumentScanPage } from "@/components/capability/DocumentScanModal";
import { MAX_DOCUMENT_SCAN_BYTES, scanSessionSize } from "@/lib/document-scan-session";
import { ChromeIcon } from "@/components/ChromeIcon";
import { assistantIconSource } from "@/data/capability-icons";
import {
  autocompleteContent,
  archiveContentDocument,
  askPersonalAssistant,
  createContentDocument,
  createContentFolder,
  createContentMutationKey,
  copyContentDocument,
  downloadContentDocument,
  findContentDocumentVersion,
  getContentContext,
  isContentContextConfigured,
  listContentDocumentVersions,
  moveContentFolder,
  moveContentDocument,
  renameContentDocument,
  readContentDocumentSources,
  saveContentDocument,
  scanContentDocument,
  searchContent,
  searchContentMatches,
  setContentDocumentFavorite,
  summarizeContentDocument,
  uploadContentDocument,
  updateContentFolder,
  setContentFolderCover,
  type ContentDocument,
  type ContentDocumentPreview,
  type ContentDocumentSourceImage,
  type ContentDocumentVersion,
  type ContentFolder,
  type ContentSearchHistoryItem,
  type ContentSearchDocument,
  type ContentSearchMatch,
  type ContentSearchResponse,
  type PersonalAssistantResponse,
} from "@/lib/content-client";
import {
  addCachedContentDocument,
  addCachedContentFolder,
  contentQueryKeys,
  getContentDocument,
  getContentDocumentPreview,
  getContentHistory,
  getContentLocation,
  invalidateContentLocations,
  invalidateContentHistories,
  refreshContentDocument,
  refreshContentHistory,
  refreshContentLocation,
  replaceCachedContentDocument,
  replaceCachedContentDocumentDetail,
  replaceCachedContentFolder,
  removeCachedContentDocument,
  removeCachedContentDocumentEverywhere,
  removeCachedContentFolder,
} from "@/lib/content-query-cache";
import { invalidateAssistantChanges } from "@/lib/workspace-query-cache";
import { saveBase64Download, saveTemporaryBase64File, saveTextDownload } from "@/lib/device-download";
import { fetchGalleryUploadStatus, uploadGalleryImages } from "@/lib/gallery-client";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";
import { useAuthStore } from "@/state/auth";

type SaveState = "local" | "dirty" | "saving" | "saved" | "error";
type WorkspaceMode = "auto" | "folders" | "folder" | "editor" | "viewer";
type FolderContentTab = "folders" | "documents" | "files";
type ArchiveSheet = "create" | "folder" | "library" | "documents" | "folders" | "enhance" | "versions" | "documentActions" | "deleteDocument" | "scanSources" | "destination" | "destinationBrowser" | "rename" | "summary" | "folderActions" | "folderDetails";
type DestinationAction = "upload" | "move" | "copy" | "moveFolder";
type UploadBatchItem = { id: string; file: File; name: string; status: "pending" | "uploading" | "success" | "error"; error?: string };
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

const MAX_MOBILE_UPLOAD_BYTES = 8 * 1024 * 1024;
const AUTOCOMPLETE_WORD_COUNT = 8;
const UPLOAD_MIME_TYPES = ["text/plain", "text/markdown", "application/pdf", "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"];
const CORE_PROMPTS = [
  "Summarize what I saved about systems",
  "Rewrite this document more clearly",
  "Translate this document to Spanish",
] as const;
const wait = (milliseconds: number) => new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

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

function lastWords(value: string, count: number) {
  return value.trim().split(/\s+/).filter(Boolean).slice(-count).join(" ");
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
  const destinationCardSize = Math.floor((width - 40 - 20) / 3);
  const userKey = useAuthStore((state) => state.user?.key ?? "");
  const organizationKey = useAuthStore((state) => typeof state.organization?.key === "string" ? state.organization.key : "");
  const scopeKey = useAuthStore((state) => typeof state.scope?.key === "string" ? state.scope.key : "");
  const agentKey = useAuthStore((state) => state.contentExecution?.agentKey ?? "");
  const reconnectContentContext = useAuthStore((state) => state.reconnectContentContext);
  const hasContentContext = isContentContextConfigured({ organizationKey, scopeKey, agentKey });
  const contentContextKey = hasContentContext ? `${organizationKey}:${scopeKey}:${agentKey}` : "";
  const contentContext = { organizationKey, scopeKey, agentKey };
  const draftIdentity = userKey && organizationKey && scopeKey ? `${userKey}:${organizationKey}:${scopeKey}` : "";
  const localDraftFile = draftFileFor(draftIdentity || "unavailable");
  const [activeSheet, setActiveSheet] = useState<ArchiveSheet>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetError, setSheetError] = useState<string>();
  const [editorFocused, setEditorFocused] = useState(false);
  const [editorEditing, setEditorEditing] = useState(false);
  const [editorTitleHeight, setEditorTitleHeight] = useState(58);
  const [editorContentHeight, setEditorContentHeight] = useState(280);
  const [aiInputFocused, setAiInputFocused] = useState(false);
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [title, setTitle] = useState("Untitled document");
  const [content, setContent] = useState("");
  const [completion, setCompletion] = useState("");
  const [autocompleteRevision, setAutocompleteRevision] = useState(0);
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
  const [selectedFolder, setSelectedFolder] = useState<ContentFolder>();
  const [documentActionLoading, setDocumentActionLoading] = useState<string>();
  const [sourceImages, setSourceImages] = useState<ContentDocumentSourceImage[]>([]);
  const [sourceImagesLoading, setSourceImagesLoading] = useState(false);
  const [renameName, setRenameName] = useState("");
  const [destinationAction, setDestinationAction] = useState<DestinationAction>();
  const [destinationStack, setDestinationStack] = useState<ContentFolder[]>([]);
  const [destinationFolders, setDestinationFolders] = useState<ContentFolder[]>([]);
  const [destinationLoading, setDestinationLoading] = useState(false);
  const [coverActionLoading, setCoverActionLoading] = useState(false);
  const [folderDetailsName, setFolderDetailsName] = useState("");
  const [folderDetailsDescription, setFolderDetailsDescription] = useState("");
  const [folderName, setFolderName] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [saveRetry, setSaveRetry] = useState(0);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [rootSearchQuery, setRootSearchQuery] = useState("");
  const [rootSearchResults, setRootSearchResults] = useState<ContentSearchMatch[]>();
  const [rootSearching, setRootSearching] = useState(false);
  const [folderSearchResults, setFolderSearchResults] = useState<ContentSearchMatch[]>();
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
  const selectionRef = useRef({ start: 0, end: 0 });
  const autocompleteRequest = useRef<AbortController | undefined>(undefined);
  const autocompleteGeneration = useRef(0);
  const instructionRequest = useRef<AbortController | undefined>(undefined);
  const rootSearchRequest = useRef<AbortController | undefined>(undefined);
  const folderSearchRequest = useRef<AbortController | undefined>(undefined);
  const editorDocumentScroll = useRef<ScrollView | null>(null);
  const summaryRequest = useRef<AbortController | undefined>(undefined);
  const previewFileRef = useRef<File | undefined>(undefined);
  const instructionGeneration = useRef(0);
  const restoreGeneration = useRef(0);
  const uploadGeneration = useRef(0);
  const uploadBatchRef = useRef<UploadBatchItem[]>([]);
  const documentActionGeneration = useRef(0);
  const folderActionGeneration = useRef(0);
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
  const normalizedFolderSearch = query.trim().toLocaleLowerCase();
  const folderSearchFolders = folders.filter((folder) => !normalizedFolderSearch || folder.name.toLocaleLowerCase().includes(normalizedFolderSearch) || folder.description?.toLocaleLowerCase().includes(normalizedFolderSearch));
  const folderSearchDocuments = (folderSearchResults ?? []).filter((document) => folderContentTab === "files" ? Boolean(document.extension) : !document.extension);
  const visibleUploadBatch = uploadFolderKey === currentFolder?.key
    ? uploadBatch.filter(({ status }) => status === "pending" || status === "uploading")
    : [];
  const showArchiveRoot = !libraryQuery.trim() || "archive".includes(libraryQuery.trim().toLowerCase());

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
    if (!editorEditing) return;
    const frame = requestAnimationFrame(() => editorDocumentScroll.current?.scrollTo({ animated: false, y: 0 }));
    return () => cancelAnimationFrame(frame);
  }, [editorEditing]);

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
    setSheetError(undefined);
    setActiveSheet(previous);
  };

  const closeSheet = () => {
    if (activeSheetRef.current === "destination" || activeSheetRef.current === "destinationBrowser") destinationGeneration.current += 1;
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
    autocompleteRequest.current?.abort();
    instructionRequest.current?.abort();
    previewFileRef.current?.delete();
  }, []);

  useEffect(() => {
    if (!hasContentContext || autocompleteRevision === 0) return;
    const generation = ++autocompleteGeneration.current;
    const timeout = setTimeout(() => {
      const current = contentRef.current;
      if (!current.trim()) return;
      const context = lastWords(current, 100);
      if (!context) return;
      autocompleteRequest.current?.abort();
      const controller = new AbortController();
      autocompleteRequest.current = controller;
      void autocompleteContent(context, AUTOCOMPLETE_WORD_COUNT, controller.signal).then(({ completion: next }) => {
        if (generation !== autocompleteGeneration.current || controller.signal.aborted || contentRef.current !== current) return;
        setCompletion(next);
      }).catch(() => undefined).finally(() => {
        if (autocompleteRequest.current === controller) {
          autocompleteRequest.current = undefined;
        }
      });
    }, 500);
    return () => {
      clearTimeout(timeout);
      autocompleteGeneration.current += 1;
      autocompleteRequest.current?.abort();
      autocompleteRequest.current = undefined;
    };
  }, [autocompleteRevision, hasContentContext]);

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
    if (!hasContentContext) return;
    const requestContextKey = contentContextKey;
    const changedAccount = Boolean(loadedContentContextKey.current && loadedContentContextKey.current !== contentContextKey);
    loadedContentContextKey.current = contentContextKey;
    if (changedAccount) {
      setCompletion("");
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
      setSelectedFolder(undefined);
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
  }, [contentContextKey, hasContentContext]);

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

  const clearCompletion = () => {
    autocompleteGeneration.current += 1;
    autocompleteRequest.current?.abort();
    autocompleteRequest.current = undefined;
    setCompletion("");
  };

  const acceptCompletion = () => {
    if (!completion) return;
    const separator = /\s$/.test(contentRef.current) || /^[,.;:!?)]/.test(completion) ? "" : " ";
    const next = `${contentRef.current}${separator}${completion}`;
    clearCompletion();
    contentRef.current = next;
    selectionRef.current = { start: next.length, end: next.length };
    setContent(next);
    markDirty();
    persistLocalDraft(titleRef.current, next);
  };

  const openEnhanceSheet = () => {
    clearCompletion();
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
    clearCompletion();
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
        selectionRef.current = { start: result.content.length, end: result.content.length };
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
    clearCompletion();
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
    selectionRef.current = { start: document.content.length, end: document.content.length };
    setTitle(document.name);
    setContent(document.content);
    setSaveState("saved");
    setError(undefined);
    if (localDraftFile.exists) localDraftFile.delete();
  }

  const openVersionHistory = async () => {
    const documentKey = documentKeyRef.current;
    if (!documentKey) {
      setSheetError("Save the document before opening version history.");
      return;
    }
    if (dirty.current || saveInFlight.current || saveState !== "saved") {
      setSheetError("Wait for the document to finish saving before opening version history.");
      return;
    }
    const session = editorSession.current;
    openSheet("versions");
    setVersions([]);
    setLoadingVersions(true);
    try {
      const history = await listContentDocumentVersions(documentKey);
      if (session === editorSession.current && documentKeyRef.current === documentKey) setVersions(history);
    } catch (cause) {
      if (session === editorSession.current && documentKeyRef.current === documentKey && activeSheetRef.current === "versions") setSheetError(cause instanceof Error ? cause.message : "Version history could not be loaded.");
    } finally {
      if (session === editorSession.current) setLoadingVersions(false);
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
      clearCompletion();
      createVersionOnNextSave.current = true;
      contentRef.current = snapshot.content;
      selectionRef.current = { start: snapshot.content.length, end: snapshot.content.length };
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
    clearCompletion();
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

  const openNote = async (document: ContentDocument, reportError = setError) => {
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
      setQuery("");
      setResults(undefined);
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

  const openArchiveDocument = async (document: ContentDocument, fromSheet = false) => {
    if (document.extension) {
      const generation = ++navigationGeneration.current;
      setSelectedDocument(document);
      setFilePreview(undefined);
      setFilePreviewError(undefined);
      setFilePreviewUri(undefined);
      setOpeningDocumentKey(document.key);
      workspaceModeRef.current = "viewer";
      setWorkspaceMode("viewer");
      if (fromSheet) closeSheet();
      try {
        const preview = await getContentDocumentPreview(queryClient, contentContext, document.key);
        if (generation !== navigationGeneration.current) return;
        setFilePreview(preview);
        setSelectedDocument(preview);
        if (preview.extension === "pdf") {
          const original = await downloadContentDocument(preview.key, "original");
          if (generation !== navigationGeneration.current) return;
          previewFileRef.current?.delete();
          const file = await saveTemporaryBase64File(original.fileName, original.content);
          if (generation !== navigationGeneration.current) { file.delete(); return; }
          previewFileRef.current = file;
          setFilePreviewUri(file.uri);
        }
      } catch (cause) {
        if (generation === navigationGeneration.current) setFilePreviewError(cause instanceof Error ? cause.message : "The file could not be opened.");
      } finally {
        if (generation === navigationGeneration.current) setOpeningDocumentKey(undefined);
      }
      return;
    }
    if (await openNote(document, fromSheet ? setSheetError : setError)) {
      if (fromSheet) closeSheet();
    }
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
    pushSheet("folderDetails");
  };

  const chooseFolderCover = async () => {
    if (!selectedFolder || coverActionLoading) return;
    const folderKey = selectedFolder.key;
    setCoverActionLoading(true);
    setSheetError(undefined);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) throw new Error("Photo access is required to choose a folder cover.");
      const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ["images"], allowsMultipleSelection: false, quality: 1 });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      const maxSide = Math.max(asset.width, asset.height);
      const actions: ImageManipulator.Action[] = maxSide > 2400 ? [{ resize: asset.width >= asset.height ? { width: 2400 } : { height: 2400 } }] : [];
      const output = await ImageManipulator.manipulateAsync(asset.uri, actions, { compress: 0.88, format: ImageManipulator.SaveFormat.JPEG });
      const blob = await (await fetch(output.uri)).blob();
      const upload = await uploadGalleryImages([{ clientKey: `${Date.now()}-${folderKey}`, filename: `folder-cover-${Date.now()}.jpg`, uri: output.uri, sizeBytes: blob.size }]);
      const job = upload.jobs[0];
      if (!job) throw new Error("The folder cover upload could not be started.");
      let status = job.status;
      for (let attempt = 0; status !== "completed" && status !== "failed" && attempt < 40; attempt += 1) {
        await wait(3_000);
        status = (await fetchGalleryUploadStatus([job.key])).jobs[0]?.status ?? status;
      }
      if (status !== "completed") throw new Error("The folder cover could not be processed.");
      const updated = await setContentFolderCover(folderKey, job.imageKey);
      replaceFolder(updated);
      closeSheet();
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The folder cover could not be updated.");
    } finally {
      setCoverActionLoading(false);
    }
  };

  const clearFolderCover = async () => {
    if (!selectedFolder || coverActionLoading) return;
    setCoverActionLoading(true);
    setSheetError(undefined);
    try {
      replaceFolder(await setContentFolderCover(selectedFolder.key, null));
      closeSheet();
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The folder cover could not be cleared.");
    } finally {
      setCoverActionLoading(false);
    }
  };

  const replaceFolder = (updated: ContentFolder, select = true) => {
    const replace = (folder: ContentFolder) => folder.key === updated.key ? updated : folder;
    setFolders((current) => current.map(replace));
    setRootFolders((current) => current.map(replace));
    setFolderStack((current) => current.map(replace));
    setDestinationFolders((current) => current.map(replace));
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
    const optimistic = { ...previous, name, description: folderDetailsDescription.trim() || undefined };
    replaceFolder(optimistic);
    closeSheet();
    const generation = ++folderActionGeneration.current;
    try {
      const updated = await updateContentFolder(previous.key, name, folderDetailsDescription.trim() || null);
      if (generation !== folderActionGeneration.current) return;
      replaceFolder(updated);
      void invalidateContentLocations(queryClient, contentContext, [previous.parentFolderKey]);
    } catch (cause) {
      if (generation !== folderActionGeneration.current) return;
      replaceFolder(previous);
      showToast({ title: "Folder update failed", description: cause instanceof Error ? cause.message : "The folder could not be updated." });
    }
  };

  const openFolder = async (folder: ContentFolder) => {
    if (!hasContentContext) return;
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      setError("Wait for the current document to save before opening a folder.");
      return;
    }
    clearCompletion();
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
    clearCompletion();
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
    const nextMode = folderStack.length ? "folder" : "folders";
    workspaceModeRef.current = nextMode;
    setWorkspaceMode(nextMode);
  };

  const leaveFileViewer = () => {
    navigationGeneration.current += 1;
    previewFileRef.current?.delete();
    previewFileRef.current = undefined;
    setFilePreview(undefined);
    setFilePreviewError(undefined);
    setFilePreviewUri(undefined);
    const nextMode = folderStack.length ? "folder" : "folders";
    workspaceModeRef.current = nextMode;
    setWorkspaceMode(nextMode);
  };

  useEffect(() => {
    if (Platform.OS !== "android") return;
    return BackHandler.addEventListener("hardwareBackPress", () => {
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
  }, [folderStack, hasContentContext]);

  const runSearch = async (searchQuery = query) => {
    const normalized = searchQuery.trim();
    if (!normalized || !hasContentContext) return;
    const generation = ++navigationGeneration.current;
    const folderKey = currentFolder?.key;
    clearCompletion();
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
    if (!normalized || !hasContentContext || workspaceMode !== "folder" || !folderKey) {
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
  }, [currentFolder?.key, hasContentContext, query, workspaceMode]);

  const openSearchSummary = async (document: ContentSearchMatch) => {
    summaryRequest.current?.abort();
    const controller = new AbortController();
    summaryRequest.current = controller;
    setSelectedSummary({ ...document, summary: "" });
    setSummaryLoading(true);
    setSheetError(undefined);
    openSheet("summary");
    try {
      const summary = await summarizeContentDocument(document.documentKey, controller.signal);
      if (!controller.signal.aborted) setSelectedSummary({ ...document, summary });
    } catch (cause) {
      if (!controller.signal.aborted) setSheetError(cause instanceof Error ? cause.message : "The document summary could not be created.");
    } finally {
      if (!controller.signal.aborted) setSummaryLoading(false);
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

  const openDestinationPicker = async (action: DestinationAction) => {
    if (!hasContentContext) {
      setSheetError("This action requires a connected Archive.");
      return;
    }
    const generation = ++destinationGeneration.current;
    const startsAtRoot = action !== "upload";
    setDestinationAction(action);
    setDestinationStack(startsAtRoot ? [] : folderStack);
    if (sheetOpen) pushSheet("destination");
    else openSheet("destination");
    if (action !== "upload") return;
    setDestinationLoading(true);
    try {
      const next = (await getContentLocation(queryClient, contentContext, currentFolder?.key)).folders;
      if (generation === destinationGeneration.current) setDestinationFolders(next);
    } catch (cause) {
      if (generation === destinationGeneration.current) setSheetError(cause instanceof Error ? cause.message : "Folders could not be loaded.");
    } finally {
      if (generation === destinationGeneration.current) setDestinationLoading(false);
    }
  };

  const openDestinationBrowser = async () => {
    const generation = ++destinationGeneration.current;
    setDestinationLoading(true);
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
    setSheetError(undefined);
    try {
      const next = (await getContentLocation(queryClient, contentContext, nextStack.at(-1)?.key)).folders;
      if (generation !== destinationGeneration.current) return;
      setDestinationFolders(next);
      setDestinationStack(nextStack);
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
    const folderKey = destinationFolder?.key;
    if (destinationAction === "upload") {
      destinationGeneration.current += 1;
      await pickAndUpload(folderKey);
      return;
    }
    if (destinationAction === "moveFolder") {
      if (!selectedFolder) return;
      const previous = selectedFolder;
      const sourceParentFolderKey = previous.parentFolderKey;
      if (sourceParentFolderKey === folderKey) { closeSheet(); return; }
      const movedOptimistic = { ...previous, parentFolderKey: folderKey };
      const previousFolders = folders;
      const previousRootFolders = rootFolders;
      const previousFolderStack = folderStack;
      const previousMode = workspaceModeRef.current;
      const sourceCacheKey = contentQueryKeys.location(contentContext, sourceParentFolderKey);
      const destinationCacheKey = contentQueryKeys.location(contentContext, folderKey);
      const sourceCache = queryClient.getQueryData(sourceCacheKey);
      const destinationCache = queryClient.getQueryData(destinationCacheKey);
      removeCachedContentFolder(queryClient, contentContext, sourceParentFolderKey, previous.key);
      addCachedContentFolder(queryClient, contentContext, folderKey, movedOptimistic);
      if (currentFolder?.key === sourceParentFolderKey) setFolders((current) => current.filter(({ key }) => key !== previous.key));
      if (currentFolder?.key === folderKey) setFolders((current) => [...current.filter(({ key }) => key !== previous.key), movedOptimistic]);
      if (!sourceParentFolderKey) setRootFolders((current) => current.filter(({ key }) => key !== previous.key));
      if (!folderKey) setRootFolders((current) => [...current.filter(({ key }) => key !== previous.key), movedOptimistic]);
      setSelectedFolder(movedOptimistic);
      if (folderStack.some(({ key }) => key === previous.key)) {
        setFolderStack([]);
        workspaceModeRef.current = "folders";
        setWorkspaceMode("folders");
      }
      closeSheet();
      const generation = ++destinationGeneration.current;
      try {
        const moved = await moveContentFolder(previous.key, folderKey);
        if (generation !== destinationGeneration.current) return;
        replaceFolder(moved);
        void invalidateContentLocations(queryClient, contentContext, [sourceParentFolderKey, folderKey]);
        void invalidateContentHistories(queryClient, contentContext, [sourceParentFolderKey, folderKey]);
      } catch (cause) {
        if (generation !== destinationGeneration.current) return;
        queryClient.setQueryData(sourceCacheKey, sourceCache);
        queryClient.setQueryData(destinationCacheKey, destinationCache);
        setFolders(previousFolders);
        setRootFolders(previousRootFolders);
        setFolderStack(previousFolderStack);
        workspaceModeRef.current = previousMode;
        setWorkspaceMode(previousMode);
        setSelectedFolder(previous);
        showToast({ title: "Folder move failed", description: cause instanceof Error ? cause.message : "The folder could not be moved." });
      }
      return;
    }
    if (!selectedDocument || !destinationAction) return;
    const previous = selectedDocument;
    const sourceFolderKey = previous.folderKey;
    if (destinationAction === "move" && sourceFolderKey === folderKey) { closeSheet(); return; }
    const sourceCacheKey = contentQueryKeys.location(contentContext, sourceFolderKey);
    const destinationCacheKey = contentQueryKeys.location(contentContext, folderKey);
    const sourceCache = queryClient.getQueryData(sourceCacheKey);
    const destinationCache = queryClient.getQueryData(destinationCacheKey);
    const previousDocuments = documents;
    const previousRootDocuments = rootDocuments;
    const temporaryKey = `optimistic-${createContentMutationKey()}`;
    const optimistic = destinationAction === "move" ? { ...previous, folderKey } : { ...previous, key: temporaryKey, folderKey };
    if (destinationAction === "move") removeCachedContentDocument(queryClient, contentContext, sourceFolderKey, previous.key);
    addCachedContentDocument(queryClient, contentContext, folderKey, optimistic);
    if (currentFolder?.key === sourceFolderKey && destinationAction === "move") setDocuments((current) => current.filter(({ key }) => key !== previous.key));
    if (currentFolder?.key === folderKey) setDocuments((current) => [...current.filter(({ key }) => key !== optimistic.key), optimistic]);
    if (!sourceFolderKey && destinationAction === "move") setRootDocuments((current) => current.filter(({ key }) => key !== previous.key));
    if (!folderKey) setRootDocuments((current) => [...current.filter(({ key }) => key !== optimistic.key), optimistic]);
    if (destinationAction === "move") setSelectedDocument(optimistic);
    closeSheet();
    const generation = ++destinationGeneration.current;
    try {
      if (destinationAction === "move") {
        const updated = await trackActiveDocumentMutation(previous.key, moveContentDocument(previous.key, folderKey), (result) => {
          if (result.key === documentKeyRef.current) updatedAtRef.current = result.updatedAt;
        });
        if (generation !== destinationGeneration.current) return;
        replaceCachedContentDocumentDetail(queryClient, contentContext, updated);
        replaceDocument(updated);
      } else {
        const copied = await copyContentDocument(previous.key, folderKey);
        if (generation !== destinationGeneration.current) return;
        removeCachedContentDocument(queryClient, contentContext, folderKey, temporaryKey);
        addCachedContentDocument(queryClient, contentContext, folderKey, copied);
        if (currentFolderKeyRef.current === folderKey) setDocuments((current) => [...current.filter(({ key }) => key !== temporaryKey), copied]);
        if (!folderKey) setRootDocuments((current) => [...current.filter(({ key }) => key !== temporaryKey), copied]);
      }
      void invalidateContentLocations(queryClient, contentContext, destinationAction === "move" ? [sourceFolderKey, folderKey] : [folderKey]);
      void invalidateContentHistories(queryClient, contentContext, destinationAction === "move" ? [sourceFolderKey, folderKey] : [folderKey]);
    } catch (cause) {
      if (generation !== destinationGeneration.current) return;
      queryClient.setQueryData(sourceCacheKey, sourceCache);
      queryClient.setQueryData(destinationCacheKey, destinationCache);
      setDocuments(previousDocuments);
      setRootDocuments(previousRootDocuments);
      setSelectedDocument(previous);
      showToast({ title: destinationAction === "move" ? "Document move failed" : "Document copy failed", description: cause instanceof Error ? cause.message : `The document could not be ${destinationAction === "move" ? "moved" : "copied"}.` });
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
    const close = (disabled: boolean) => <Button disabled={disabled} onPress={closeSheet} size="lg" variant="secondary">Close</Button>;
    if (activeSheet === "folderDetails") return <>
      <Button disabled={!folderDetailsName.trim()} onPress={() => void submitFolderDetails()} size="lg" variant="primary">Save folder details</Button>
      {close(false)}
    </>;
    if (activeSheet === "rename") return <>
      <Button disabled={!renameName.trim()} onPress={() => void submitRename()} size="lg" variant="primary">Rename</Button>
      {close(false)}
    </>;
    if (activeSheet === "deleteDocument") return <>
      <Button disabled={Boolean(documentActionLoading)} loading={documentActionLoading === "delete"} onPress={() => void deleteSelectedDocument()} size="lg" variant="danger">Delete</Button>
      {close(Boolean(documentActionLoading))}
    </>;
    if (activeSheet === "destinationBrowser") return <>
      <Button disabled={destinationLoading} loading={destinationLoading} onPress={() => { if (destinationAction === "upload") goBackSheet(); else void selectDestination(); }} size="lg" variant="primary">Choose folder</Button>
      {close(destinationLoading)}
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
                <TextInput accessibilityLabel="Search all Archive documents and files" onChangeText={setRootSearchQuery} placeholder="Search documents and files" style={styles.rootSearchInput} value={rootSearchQuery} />
                {rootSearchQuery.trim() ? <Button accessibilityLabel="Clear Archive search" contentMode="raw" onPress={() => setRootSearchQuery("")} size="xs" variant="icon"><CloseIcon size="sm" /></Button> : null}
              </View>
              <Button accessibilityLabel="Create in Archive" contentMode="raw" disabled={locationLoading} onPress={() => openSheet("create")} size="md" style={styles.rootCreateButton} variant="icon"><PlusIcon size="sm" /></Button>
            </View>
            {rootSearchQuery.trim() ? <View accessibilityLiveRegion="polite" style={styles.rootSearchResults}>
              {(rootSearchResults ?? []).map((document) => <Button contentMode="raw" key={document.documentKey} onPress={() => void openSearchSummary(document)} size="sm" style={styles.documentButton} variant="secondary">
                <FileIcon size="sm" />
                <Text numberOfLines={1} style={styles.documentButtonLabel}>{document.name}</Text>
              </Button>)}
              {rootSearching || !rootSearchResults ? <Text style={styles.empty}>Searching...</Text> : rootSearchResults.length === 0 ? <Text style={styles.empty}>No documents matched this search.</Text> : null}
            </View> : <View style={styles.rootContent}>
              <Tabs accessibilityRole="tablist" style={styles.folderTabs}>
                <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "folders" }} onPress={() => setFolderContentTab("folders")} size="xs" style={styles.folderTab} variant={folderContentTab === "folders" ? "secondary" : "ghost"}>Folders</Button>
                <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "documents" }} onPress={() => setFolderContentTab("documents")} size="xs" style={styles.folderTab} variant={folderContentTab === "documents" ? "secondary" : "ghost"}>Documents</Button>
                <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "files" }} onPress={() => setFolderContentTab("files")} size="xs" style={styles.folderTab} variant={folderContentTab === "files" ? "secondary" : "ghost"}>Files</Button>
              </Tabs>
              {archiveLocationLoading ? folderContentTab === "folders" ? <View accessibilityLabel="Loading folders" accessibilityRole="progressbar" style={[styles.rootFolderGrid, styles.loadingGrid]}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={[styles.rootFolderCard, styles.skeletonCard, { width: archiveCardSize, height: archiveCardSize }]} />)}</View> : <View accessibilityLabel={`Loading ${folderContentTab}`} accessibilityRole="progressbar" style={styles.rootDocuments}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={[styles.documentSkeleton, styles.skeletonCard]} />)}</View> : folderContentTab === "folders" ? (
                <View style={styles.rootFolderGrid}>
                  {rootFolders.length ? rootFolders.map((folder) => (
                    <View key={folder.key} style={[styles.rootFolderCard, folder.key.startsWith("optimistic-") && styles.optimisticCard, { width: archiveCardSize, height: archiveCardSize }]}>
                      {folder.coverUrl ? <Image contentFit="cover" source={folder.coverUrl} style={styles.folderCover} /> : null}
                      <Button contentMode="raw" disabled={folder.key.startsWith("optimistic-")} onPress={() => void (hasContentContext ? openFolder(folder) : selectFolder(folder))} size="xl" style={[styles.rootFolderMain, folder.coverUrl && styles.coveredFolderMain]} variant="ghost">{folder.coverUrl ? null : <FolderIcon size="lg" />}<Text numberOfLines={1} style={[styles.archiveCardLabel, folder.coverUrl && styles.coveredFolderLabel]}>{folder.name}</Text></Button>
                    </View>
                  )) : !error ? <View style={styles.folderEmptyState}><Text style={styles.empty}>No folders here yet.</Text><Button accessibilityLabel="Create folder" contentMode="raw" onPress={openNewFolder} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button></View> : null}
                </View>
              ) : (
                <View style={styles.rootDocuments}>
                  {folderContentTab === "files" ? visibleUploadBatch.map((item) => <Button accessibilityLabel={`Uploading ${item.name}`} contentMode="raw" disabled key={item.id} size="sm" style={[styles.documentButton, styles.uploadingFileButton]} variant="secondary"><FileIcon size="sm" variant="muted" /><Text numberOfLines={1} style={[styles.documentButtonLabel, styles.uploadingFileLabel]}>{item.name}</Text><Spinner size="small" variant="muted" /></Button>) : null}
                  {rootTabDocuments.length ? rootTabDocuments.map((document) => (
                    <Button contentMode="raw" key={document.key} onPress={() => void openArchiveDocument(document)} size="sm" style={styles.documentButton} variant="secondary">
                      <FileIcon size="sm" />
                      <Text numberOfLines={1} style={styles.documentButtonLabel}>{document.name}</Text>
                      <ScannedBadge document={document} />
                    </Button>
                  )) : visibleUploadBatch.length === 0 && !error ? <View style={styles.folderEmptyState}><Text style={styles.empty}>{folderContentTab === "files" ? "No files here yet." : "No documents here yet."}</Text><Button accessibilityLabel={folderContentTab === "files" ? "Upload files" : "Create document"} contentMode="raw" onPress={() => { if (folderContentTab === "files") void openDestinationPicker("upload"); else startNewNote(); }} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button></View> : null}
                </View>
              )}
            </View>}
          </View>
        ) : workspaceMode === "folder" ? (
          <View style={styles.archiveFolder}>
            <View style={styles.folderTitleRow}>
              <Button accessibilityLabel={`Back to ${folderStack.at(-2)?.name ?? "folders"}`} contentMode="raw" onPress={() => void goBackFolder()} size="xs" variant="icon"><ChevronLeftIcon size="sm" /></Button>
              <Text numberOfLines={1} style={styles.folderTitle}>{currentFolder?.name ?? "Archive"}</Text>
              <View style={styles.folderTitleActions}>
                {currentFolder ? <Button accessibilityLabel={`Manage ${currentFolder.name}`} contentMode="raw" onPress={() => showFolderActions(currentFolder)} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button> : null}
                <Button accessibilityLabel={`Create in ${currentFolder?.name ?? "Archive"}`} contentMode="raw" onPress={() => openSheet("create")} size="xs" variant="icon"><PlusIcon size="sm" /></Button>
              </View>
            </View>
            {error ? <Text accessibilityRole="alert" style={styles.notice}>{error}</Text> : null}
            <View style={[styles.rootSearch, styles.folderScopedSearch]}>
              <SearchIcon size="sm" variant="muted" />
              <TextInput accessibilityLabel={`Search ${currentFolder?.name ?? "folder"}`} onChangeText={setQuery} placeholder="Search documents and files" style={styles.rootSearchInput} value={query} />
              {query.trim() ? <Button accessibilityLabel="Clear folder search" contentMode="raw" onPress={() => setQuery("")} size="xs" variant="icon"><CloseIcon size="sm" /></Button> : null}
            </View>
            <Tabs accessibilityRole="tablist" style={styles.folderTabs}>
              <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "folders" }} onPress={() => setFolderContentTab("folders")} size="xs" style={styles.folderTab} variant={folderContentTab === "folders" ? "secondary" : "ghost"}>Folders</Button>
              <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "documents" }} onPress={() => setFolderContentTab("documents")} size="xs" style={styles.folderTab} variant={folderContentTab === "documents" ? "secondary" : "ghost"}>Documents</Button>
              <Button accessibilityRole="tab" accessibilityState={{ selected: folderContentTab === "files" }} onPress={() => setFolderContentTab("files")} size="xs" style={styles.folderTab} variant={folderContentTab === "files" ? "secondary" : "ghost"}>Files</Button>
            </Tabs>
            {query.trim() ? folderSearching || !folderSearchResults ? <View accessibilityLabel="Loading search results" accessibilityRole="progressbar" style={[styles.folderDocuments, styles.folderTabContent]}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={[styles.documentSkeleton, styles.skeletonCard]} />)}</View> : folderContentTab === "folders" ? (
              <View accessibilityLiveRegion="polite" style={[styles.rootFolderGrid, styles.folderTabContent]}>
                {folderSearchFolders.map((folder) => <View key={folder.key} style={[styles.rootFolderCard, { width: archiveCardSize, height: archiveCardSize }]}>
                  {folder.coverUrl ? <Image contentFit="cover" source={folder.coverUrl} style={styles.folderCover} /> : null}
                  <Button contentMode="raw" onPress={() => void openFolder(folder)} size="xl" style={[styles.rootFolderMain, folder.coverUrl && styles.coveredFolderMain]} variant="ghost">{folder.coverUrl ? null : <FolderIcon size="lg" />}<Text numberOfLines={1} style={[styles.archiveCardLabel, folder.coverUrl && styles.coveredFolderLabel]}>{folder.name}</Text></Button>
                </View>)}
                {folderSearchFolders.length === 0 ? <Text style={styles.empty}>No folders matched this search.</Text> : null}
              </View>
            ) : <View accessibilityLiveRegion="polite" style={[styles.folderDocuments, styles.folderTabContent]}>
              {folderSearchDocuments.map((document) => <Button contentMode="raw" key={document.documentKey} onPress={() => void openSearchSummary(document)} size="sm" style={styles.documentButton} variant="secondary">
                <FileIcon size="sm" />
                <Text numberOfLines={1} style={styles.documentButtonLabel}>{document.name}</Text>
              </Button>)}
              {folderSearchDocuments.length === 0 ? <Text style={styles.empty}>No {folderContentTab === "files" ? "files" : "documents"} matched this search.</Text> : null}
            </View> : archiveLocationLoading ? folderContentTab === "folders" ? <View accessibilityLabel="Loading folders" accessibilityRole="progressbar" style={[styles.rootFolderGrid, styles.folderTabContent]}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={[styles.rootFolderCard, styles.skeletonCard, { width: archiveCardSize, height: archiveCardSize }]} />)}</View> : <View accessibilityLabel={`Loading ${folderContentTab}`} accessibilityRole="progressbar" style={[styles.folderDocuments, styles.folderTabContent]}>{Array.from({ length: 3 }, (_, index) => <View key={index} style={[styles.documentSkeleton, styles.skeletonCard]} />)}</View> : folderContentTab === "folders" ? (
              <View style={[styles.rootFolderGrid, styles.folderTabContent, archiveLocationLoading && styles.loadingGrid]}>
                {folders.length ? folders.map((folder) => (
                  <View key={folder.key} style={[styles.rootFolderCard, folder.key.startsWith("optimistic-") && styles.optimisticCard, { width: archiveCardSize, height: archiveCardSize }]}>
                    {folder.coverUrl ? <Image contentFit="cover" source={folder.coverUrl} style={styles.folderCover} /> : null}
                    <Button contentMode="raw" disabled={folder.key.startsWith("optimistic-")} onPress={() => void openFolder(folder)} size="xl" style={[styles.rootFolderMain, folder.coverUrl && styles.coveredFolderMain]} variant="ghost">{folder.coverUrl ? null : <FolderIcon size="lg" />}<Text numberOfLines={1} style={[styles.archiveCardLabel, folder.coverUrl && styles.coveredFolderLabel]}>{folder.name}</Text></Button>
                  </View>
                )) : <View style={styles.folderEmptyState}><Text style={styles.empty}>No folders here yet.</Text><Button accessibilityLabel="Create folder" contentMode="raw" onPress={openNewFolder} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button></View>}
              </View>
            ) : (
              <View style={[styles.folderDocuments, styles.folderTabContent]}>
                {folderContentTab === "files" ? visibleUploadBatch.map((item) => <Button accessibilityLabel={`Uploading ${item.name}`} contentMode="raw" disabled key={item.id} size="sm" style={[styles.documentButton, styles.uploadingFileButton]} variant="secondary"><FileIcon size="sm" variant="muted" /><Text numberOfLines={1} style={[styles.documentButtonLabel, styles.uploadingFileLabel]}>{item.name}</Text><Spinner size="small" variant="muted" /></Button>) : null}
                {folderTabDocuments.length ? folderTabDocuments.map((document) => (
                  <Button contentMode="raw" key={document.key} onPress={() => void openArchiveDocument(document)} size="sm" style={styles.documentButton} variant="secondary">
                    <FileIcon size="sm" />
                    <Text numberOfLines={1} style={styles.documentButtonLabel}>{document.name}</Text>
                    <ScannedBadge document={document} />
                  </Button>
                )) : visibleUploadBatch.length === 0 ? <View style={styles.folderEmptyState}><Text style={styles.empty}>{folderContentTab === "files" ? "No files here yet." : "No documents here yet."}</Text><Button accessibilityLabel={folderContentTab === "files" ? "Upload files" : "Create document"} contentMode="raw" onPress={() => { if (folderContentTab === "files") void openDestinationPicker("upload"); else startNewNote(); }} size="md" style={styles.emptyPlusButton} variant="icon"><PlusIcon size="sm" /></Button></View> : null}
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
                : <Button accessibilityLabel="Edit document" contentMode="raw" onPress={() => setEditorEditing(true)} size="sm" variant="icon"><EditIcon size="sm" /></Button>}
              <Button accessibilityLabel="AI document actions" contentMode="raw" disabled={!content.trim()} onPress={openEnhanceSheet} size="sm" variant="icon"><BrainIcon size="sm" /></Button>
              <Button accessibilityLabel="Document version history" contentMode="raw" disabled={!activeDocument || saveState !== "saved"} onPress={() => void openVersionHistory()} size="sm" variant="icon"><ClockIcon size="sm" /></Button>
              <Button accessibilityLabel="Manage document" contentMode="raw" disabled={!activeDocument || saveState !== "saved"} onPress={() => { if (activeDocument) showDocumentActions(activeDocument); }} size="sm" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
            </View>
          </View>
          <View style={[styles.noteSheet, (editorFocused || aiInputFocused) && styles.noteSheetFocused]}>
          {openingDocumentKey ? <View accessibilityLabel={`Loading ${title}`} accessibilityRole="progressbar" style={styles.editorSkeleton}>
            <View style={styles.editorTitleSkeleton} />
            <View style={styles.editorBodySkeleton} />
          </View> : <>
          {error ? <Text accessibilityRole="alert" style={styles.notice}>{error}</Text> : null}
          {saveState === "saving" || saveState === "dirty" ? <Text accessibilityLiveRegion="polite" style={styles.saveStatus}>{saveState === "saving" ? "Saving document..." : "Changes waiting to save..."}</Text> : null}
          {saveState === "error" ? (
            <View style={styles.saveErrorRow}>
              <Text style={styles.saveErrorText}>This draft is stored on this device but has not synced.</Text>
              <Button onPress={() => setSaveRetry((current) => current + 1)} size="xs" variant="secondary">Retry save</Button>
            </View>
          ) : null}

          <ScrollView contentContainerStyle={styles.editorReadDocument} keyboardShouldPersistTaps="handled" nestedScrollEnabled ref={editorDocumentScroll} showsVerticalScrollIndicator={false} style={styles.editorReadScroll}>
            {editorEditing ? <>
              <TextInput
                accessibilityLabel="Document title"
                maxLength={255}
                multiline
                onChangeText={(value) => { titleRef.current = value; setTitle(value); markDirty(); persistLocalDraft(value, contentRef.current); }}
                onContentSizeChange={(event) => setEditorTitleHeight(Math.max(58, Math.ceil(event.nativeEvent.contentSize.height)))}
                scrollEnabled={false}
                style={[styles.titleInput, { height: editorTitleHeight }]}
                textAlignVertical="top"
                value={title}
              />
              <View style={[styles.editorFrame, (editorFocused || aiInputFocused) && styles.editorFrameFocused]}>
                {completion ? (
                  <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.editorGhost}>
                    <Text style={styles.editorGhostSpacer}>{content}</Text>
                    <Text style={styles.completionText}>{/\s$/.test(content) || /^[,.;:!?)]/.test(completion) ? "" : " "}{completion}</Text>
                  </Text>
                ) : null}
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
                    const previousContent = contentRef.current;
                    const previousLength = previousContent.length;
                    const changedAtEnd = value.startsWith(previousContent) || previousContent.startsWith(value);
                    const cursorWasAtEnd = selectionRef.current.start === previousLength && selectionRef.current.end === previousLength;
                    const shouldAutocomplete = changedAtEnd || cursorWasAtEnd;
                    if (shouldAutocomplete) {
                      selectionRef.current = { start: value.length, end: value.length };
                    }
                    contentRef.current = value;
                    clearCompletion();
                    setContent(value);
                    if (shouldAutocomplete) setAutocompleteRevision((current) => current + 1);
                    markDirty();
                    persistLocalDraft(titleRef.current, value);
                  }}
                  onContentSizeChange={(event) => setEditorContentHeight(Math.max(280, Math.ceil(event.nativeEvent.contentSize.height)))}
                  placeholder="Start writing from here..."
                  onFocus={() => setEditorFocused(true)}
                  onSelectionChange={(event) => {
                    selectionRef.current = event.nativeEvent.selection;
                    if (event.nativeEvent.selection.end !== contentRef.current.length) clearCompletion();
                  }}
                  style={[styles.editor, (editorFocused || aiInputFocused) && styles.editorFocused, { height: editorContentHeight }]}
                  textAlignVertical="top"
                  value={content}
                />
                {completion ? (
                  <Button accessibilityLabel="Accept suggested continuation" contentMode="raw" onPress={acceptCompletion} size="sm" style={styles.completionAccept} variant="icon">
                    <CheckIcon size="sm" />
                  </Button>
                ) : null}
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
              <Text selectable style={styles.editorReadTitle}>{title}</Text>
              <Text selectable style={styles.editorReadText}>{content}</Text>
            </>}
          </ScrollView>
          </>}
          </View>
        </View>
        )}
      </ScrollView>

      <CoreComposer
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
        description={activeSheet === "create" ? "Choose what to add to the current folder." : activeSheet === "versions" ? "Choose a version of this document to open or download." : activeSheet === "summary" ? "Review the match, then open its source document." : activeSheet === "deleteDocument" ? `Delete ${selectedDocument?.extension ? "file" : "document"} from Archive? It will move to trash.` : undefined}
        dismissible={!versionActionKey && !coverActionLoading && !destinationLoading && !documentActionLoading}
        footer={mutationFooter()}
        hideHeading={activeSheet === "create" || activeSheet === "documentActions" || activeSheet === "enhance"}
        mutation={activeSheet === "documents" || activeSheet === "folder" || activeSheet === "folders" || activeSheet === "versions" || activeSheet === "rename" || activeSheet === "destinationBrowser" || activeSheet === "folderDetails"}
        onOpenChange={(open) => { if (!open) closeSheet(); }}
        open={sheetOpen}
        tall={activeSheet === "library" || activeSheet === "documents" || activeSheet === "folders" || activeSheet === "scanSources"}
        title={activeSheet === "enhance" ? "AI actions" : activeSheet === "versions" ? "Version history" : activeSheet === "scanSources" ? "Scanned pages" : activeSheet === "deleteDocument" ? `Delete ${selectedDocument?.extension ? "file" : "document"}` : activeSheet === "folder" ? "Create folder" : activeSheet === "documents" ? "Documents and files" : activeSheet === "folders" ? "Folders" : activeSheet === "destinationBrowser" ? destinationFolder?.name ?? "Archive" : activeSheet === "library" ? "Browse Archive" : activeSheet === "documentActions" ? selectedDocument?.name ?? "Document actions" : activeSheet === "destination" ? destinationAction === "upload" ? "Upload files" : "Choose destination" : activeSheet === "rename" ? selectedDocument?.extension ? "Rename file" : "Rename document" : activeSheet === "summary" ? selectedSummary?.name ?? "Document summary" : activeSheet === "folderActions" ? selectedFolder?.name ?? "Folder actions" : activeSheet === "folderDetails" ? "Folder details" : "New in Archive"}
      >
        {sheetError ? <Text accessibilityRole="alert" style={styles.notice}>{sheetError}</Text> : null}
        {activeSheet === "create" ? (
          <>
            <BottomSheetItem onPress={() => { void startNewNote(); }} variant="secondary">New document</BottomSheetItem>
            <BottomSheetItem onPress={openNewFolder} variant="secondary">New folder</BottomSheetItem>
            <BottomSheetItem disabled={uploading} loading={uploading} onPress={() => void openDestinationPicker("upload")} variant="secondary">Upload files</BottomSheetItem>
            <BottomSheetItem disabled={uploading || scanBusy} onPress={startDocumentScan} variant="secondary">Scan documents</BottomSheetItem>
          </>
        ) : null}
        {activeSheet === "documentActions" && selectedDocument ? (
          <>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => void toggleFavorite()}>{selectedDocument.isFavorite ? "Remove from favorites" : "Add to favorites"}</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} loading={documentActionLoading === "download"} onPress={() => void downloadOriginal()}>{selectedDocument.extension ? "Download original" : "Download as text"}</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => { setRenameName(selectedDocument.name); pushSheet("rename"); }}>Rename</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => void openDestinationPicker("move")}>Move to folder</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} onPress={() => void openDestinationPicker("copy")}>Copy to folder</BottomSheetItem>
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
            <BottomSheetItem onPress={openFolderDetails}>Edit name and description</BottomSheetItem>
            <BottomSheetItem onPress={() => void openDestinationPicker("moveFolder")}>Move folder</BottomSheetItem>
            <BottomSheetItem disabled={coverActionLoading} loading={coverActionLoading} onPress={() => void chooseFolderCover()}>{selectedFolder.coverUrl ? "Change cover" : "Set cover"}</BottomSheetItem>
            {selectedFolder.coverUrl ? <BottomSheetItem disabled={coverActionLoading} onPress={() => void clearFolderCover()}>Remove cover</BottomSheetItem> : null}
          </>
        ) : null}
        {activeSheet === "folderDetails" && selectedFolder ? (
          <View style={styles.namingForm}>
            <TextInput accessibilityLabel="Folder name" autoFocus maxLength={255} onChangeText={setFolderDetailsName} placeholder="Folder name" value={folderDetailsName} />
            <TextInput accessibilityLabel="Folder description" maxLength={2000} multiline onChangeText={setFolderDetailsDescription} placeholder="What belongs in this folder?" style={styles.folderDescriptionInput} textAlignVertical="top" value={folderDetailsDescription} />
          </View>
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
          <ScrollView contentContainerStyle={styles.destinationFolderGrid} keyboardShouldPersistTaps="handled" style={styles.folderList}>
            {destinationStack.length > 0 ? <View style={[styles.rootFolderCard, { width: destinationCardSize, height: destinationCardSize }]}><Button accessibilityLabel={`Back to ${destinationStack.at(-2)?.name ?? "Archive"}`} contentMode="raw" disabled={destinationLoading} onPress={() => void browseDestination(undefined, true)} size="xl" style={styles.rootFolderMain} variant="ghost"><ChevronLeftIcon size="lg" /><Text numberOfLines={1} style={styles.archiveCardLabel}>{destinationStack.at(-2)?.name ?? "Archive"}</Text></Button></View> : null}
            {destinationFolders.filter((folder) => destinationAction !== "moveFolder" || folder.key !== selectedFolder?.key).map((folder) => <View key={folder.key} style={[styles.rootFolderCard, { width: destinationCardSize, height: destinationCardSize }]}>{folder.coverUrl ? <Image contentFit="cover" source={folder.coverUrl} style={styles.folderCover} /> : null}<Button contentMode="raw" disabled={destinationLoading} onPress={() => void browseDestination(folder)} size="xl" style={[styles.rootFolderMain, folder.coverUrl && styles.coveredFolderMain]} variant="ghost">{folder.coverUrl ? null : <FolderIcon size="lg" />}<Text numberOfLines={1} style={[styles.archiveCardLabel, folder.coverUrl && styles.coveredFolderLabel]}>{folder.name}</Text></Button></View>)}
            {!destinationLoading && destinationFolders.filter((folder) => destinationAction !== "moveFolder" || folder.key !== selectedFolder?.key).length === 0 ? <Text style={styles.empty}>No nested folders here.</Text> : null}
          </ScrollView>
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
              <TextInput accessibilityLabel="Search Archive folders" autoFocus onChangeText={setLibraryQuery} placeholder="Search folders" style={styles.folderSearchInput} value={libraryQuery} />
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
              <TextInput accessibilityLabel="Search Archive documents and files" autoFocus onChangeText={setLibraryQuery} placeholder="Search documents and files" style={styles.folderSearchInput} value={libraryQuery} />
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
  rootCreateButton: { height: 44, width: 44 },
  rootSearch: { minHeight: 44, flex: 1, paddingHorizontal: 12, flexDirection: "row", alignItems: "center", gap: 7, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised },
  folderScopedSearch: { flex: 0, width: "100%" },
  rootSearchInput: { minHeight: 40, flex: 1, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" },
  rootSearchResults: { gap: 7 },
  rootContent: { gap: spacing.lg },
  rootDocuments: { gap: 7 },
  rootFolderGrid: { alignContent: "flex-start", flexDirection: "row", flexWrap: "wrap", gap: 10 },
  loadingGrid: { flex: 1 },
  rootFolderCard: { position: "relative", borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised, overflow: "hidden" },
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
  scannedBadge: { paddingHorizontal: 8, paddingVertical: 3, borderWidth: 1, backgroundColor: palette.panel },
  scannedBadgeText: { color: palette.muted, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 0.4 },
  uploadingFileButton: { opacity: 0.62 },
  uploadingFileLabel: { color: palette.silver500 },
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
  saveStatus: { marginBottom: 8, color: palette.silver500, fontFamily: fonts.regular, fontSize: 11 },
  saveErrorRow: { marginBottom: 10, padding: 10, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: radii.sm, borderColor: palette.hairline, borderWidth: 1 },
  saveErrorText: { flex: 1, color: palette.silver300, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  titleInput: { minHeight: 58, width: "100%", paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", color: palette.silver50, fontFamily: fonts.medium, fontSize: 28, textAlign: "left", writingDirection: "ltr" },
  editorFrame: { minHeight: 280, width: "100%", position: "relative", overflow: "hidden" },
  editorFrameFocused: { minHeight: 280 },
  editor: { minHeight: 280, width: "100%", paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26, textAlign: "left", writingDirection: "ltr" },
  editorReadScroll: { flex: 1, minHeight: 0, width: "100%" },
  editorReadDocument: { flexGrow: 1, width: "100%", gap: spacing.md, paddingBottom: spacing.xl },
  editorReadTitle: { width: "100%", color: palette.silver50, fontFamily: fonts.medium, fontSize: 28, textAlign: "left", writingDirection: "ltr" },
  editorReadText: { width: "100%", color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26, textAlign: "left", writingDirection: "ltr" },
  editorFocused: { minHeight: 280 },
  editorGhost: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 1, paddingVertical: 10, color: "transparent", fontFamily: fonts.regular, fontSize: 16, lineHeight: 26 },
  editorGhostSpacer: { color: "transparent" },
  completionText: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 16, fontStyle: "italic", lineHeight: 26 },
  completionAccept: { bottom: 8, position: "absolute", right: 0, zIndex: 2 },
  aiComposerError: { paddingHorizontal: 8, color: "#D98B8B", fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  aiResponse: { paddingHorizontal: spacing.sm, paddingVertical: spacing.xs, gap: 3, borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panel },
  aiResponseText: { color: palette.text, fontFamily: fonts.regular, fontSize: 14, lineHeight: 20 },
  aiResponseSources: { color: palette.muted, fontFamily: fonts.regular, fontSize: 11, lineHeight: 16 },
  enhancePanel: { gap: 18 },
  enhanceIdentity: { padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panel },
  enhanceCopy: { flex: 1, gap: 4 },
  versionPanel: { gap: 10 },
  versionRow: { flexDirection: "row", alignItems: "stretch", gap: 8 },
  versionMain: { flex: 1, justifyContent: "flex-start", paddingHorizontal: 14 },
  summaryPanel: { gap: 16 },
  summaryText: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 24 },
  destinationPanel: { flex: 1, gap: 12 },
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
