import { useNavigation } from "expo-router";
import { Directory, File, Paths } from "expo-file-system";
import { EncodingType, writeAsStringAsync } from "expo-file-system/legacy";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import {
  ArchiveIcon,
  BrainIcon,
  CheckIcon,
  ChevronLeftIcon,
  CopyIcon,
  ClockIcon,
  DownloadIcon,
  EditIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
  MoreHorizontalIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  StarIcon,
  UploadIcon,
} from "@vorinthex/shared/ui/icons-mobile";

import { ChromeIcon } from "@/components/ChromeIcon";
import { capabilityIconSource } from "@/data/capability-icons";
import {
  autocompleteContent,
  createContentDocument,
  createContentFolder,
  createContentMutationKey,
  copyContentDocument,
  downloadContentDocument,
  enhanceContent,
  isContentContextConfigured,
  listContentDocumentVersions,
  listContentLocation,
  listContentSearchHistory,
  moveContentFolder,
  moveContentDocument,
  readContentDocument,
  renameContentDocument,
  restoreContentDocumentVersion,
  saveContentDocument,
  searchContent,
  setContentDocumentFavorite,
  translateContentDocument,
  uploadContentDocument,
  updateContentFolder,
  type ContentDocument,
  type ContentDocumentVersion,
  type ContentFolder,
  type ContentSearchHistoryItem,
  type ContentSearchDocument,
  type ContentSearchResponse,
} from "@/lib/content-client";
import { applyEnhancement, resolveEnhancementTarget, type TextRange } from "@/lib/note-enhancement";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";
import { useAuthStore } from "@/state/auth";

type SaveState = "local" | "dirty" | "saving" | "saved" | "error";
type ArchiveSheet = "create" | "folder" | "destinationFolder" | "library" | "documents" | "folders" | "enhance" | "translate" | "versions" | "restoreVersion" | "documentActions" | "destination" | "rename" | "summary" | "uploads" | "folderActions" | "folderDetails";
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

export function KnowledgeWorkspace() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const userKey = useAuthStore((state) => state.user?.key ?? "");
  const organizationKey = useAuthStore((state) => typeof state.organization?.key === "string" ? state.organization.key : "");
  const scopeKey = useAuthStore((state) => typeof state.scope?.key === "string" ? state.scope.key : "");
  const agentKey = useAuthStore((state) => state.contentExecution?.agentKey ?? "");
  const reconnectContentContext = useAuthStore((state) => state.reconnectContentContext);
  const hasContentContext = isContentContextConfigured({ organizationKey, scopeKey, agentKey });
  const contentContextKey = hasContentContext ? `${organizationKey}:${scopeKey}:${agentKey}` : "";
  const draftIdentity = userKey && contentContextKey ? `${userKey}:${organizationKey}:${scopeKey}` : "";
  const localDraftFile = draftFileFor(draftIdentity || "unavailable");
  const [activeSheet, setActiveSheet] = useState<ArchiveSheet>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [canGoBackSheet, setCanGoBackSheet] = useState(false);
  const [sheetError, setSheetError] = useState<string>();
  const [editorFocused, setEditorFocused] = useState(false);
  const [title, setTitle] = useState("Untitled note");
  const [content, setContent] = useState("");
  const [completion, setCompletion] = useState("");
  const [autocompleteRevision, setAutocompleteRevision] = useState(0);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceRange, setEnhanceRange] = useState<TextRange>();
  const [targetLanguage, setTargetLanguage] = useState("");
  const [translating, setTranslating] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadBatch, setUploadBatch] = useState<UploadBatchItem[]>([]);
  const [versions, setVersions] = useState<ContentDocumentVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<ContentDocumentVersion>();
  const [loadingVersions, setLoadingVersions] = useState(false);
  const [restoringVersionKey, setRestoringVersionKey] = useState<string>();
  const [saveState, setSaveState] = useState<SaveState>(hasContentContext ? "saved" : "local");
  const [folders, setFolders] = useState<ContentFolder[]>([]);
  const [rootFolders, setRootFolders] = useState<ContentFolder[]>([]);
  const [documents, setDocuments] = useState<ContentDocument[]>([]);
  const [rootDocuments, setRootDocuments] = useState<ContentDocument[]>([]);
  const [folderStack, setFolderStack] = useState<ContentFolder[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [locationLoading, setLocationLoading] = useState(false);
  const [openingDocumentKey, setOpeningDocumentKey] = useState<string>();
  const [results, setResults] = useState<ContentSearchResponse>();
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [selectedSummary, setSelectedSummary] = useState<ContentSearchDocument>();
  const [selectedDocument, setSelectedDocument] = useState<ContentDocument>();
  const [selectedFolder, setSelectedFolder] = useState<ContentFolder>();
  const [documentActionLoading, setDocumentActionLoading] = useState<string>();
  const [renameName, setRenameName] = useState("");
  const [destinationAction, setDestinationAction] = useState<DestinationAction>();
  const [destinationStack, setDestinationStack] = useState<ContentFolder[]>([]);
  const [destinationFolders, setDestinationFolders] = useState<ContentFolder[]>([]);
  const [destinationFolderName, setDestinationFolderName] = useState("");
  const [destinationFolderDescription, setDestinationFolderDescription] = useState("");
  const [destinationLoading, setDestinationLoading] = useState(false);
  const [folderActionLoading, setFolderActionLoading] = useState(false);
  const [folderDetailsName, setFolderDetailsName] = useState("");
  const [folderDetailsDescription, setFolderDetailsDescription] = useState("");
  const [folderName, setFolderName] = useState("");
  const [folderDescription, setFolderDescription] = useState("");
  const [folderCreating, setFolderCreating] = useState(false);
  const [saveRetry, setSaveRetry] = useState(0);
  const [libraryQuery, setLibraryQuery] = useState("");
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
  const documentMetadataMutation = useRef<Promise<void> | null>(null);
  const pendingCreate = useRef<PendingCreate | undefined>(undefined);
  const navigationGeneration = useRef(0);
  const destinationGeneration = useRef(0);
  const sheetCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const activeSheetRef = useRef<ArchiveSheet | undefined>(undefined);
  const sheetBackStack = useRef<ArchiveSheet[]>([]);
  const currentFolderKeyRef = useRef<string | undefined>(undefined);
  const loadedContentContextKey = useRef<string | undefined>(undefined);
  const selectionRef = useRef({ start: 0, end: 0 });
  const autocompleteRequest = useRef<AbortController | undefined>(undefined);
  const autocompleteGeneration = useRef(0);
  const enhanceRequest = useRef<AbortController | undefined>(undefined);
  const enhanceGeneration = useRef(0);
  const translationGeneration = useRef(0);
  const restoreGeneration = useRef(0);
  const documentActionGeneration = useRef(0);
  const folderActionGeneration = useRef(0);
  const contentContextKeyRef = useRef(contentContextKey);
  const draftIdentityRef = useRef(draftIdentity);
  const folderStackRef = useRef(folderStack);
  contentContextKeyRef.current = contentContextKey;
  draftIdentityRef.current = draftIdentity;
  folderStackRef.current = folderStack;
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
  const visibleFolders = rootFolders.filter((folder) => {
    const normalized = libraryQuery.trim().toLowerCase();
    return !normalized || folder.name.toLowerCase().includes(normalized) || folder.description?.toLowerCase().includes(normalized);
  });
  const visibleDocuments = rootDocuments.filter((document) => (
    !libraryQuery.trim() || document.name.toLowerCase().includes(libraryQuery.trim().toLowerCase())
  ));
  const showArchiveRoot = !libraryQuery.trim() || "archive".includes(libraryQuery.trim().toLowerCase());

  useEffect(() => {
    if (hasContentContext) return;
    void reconnectContentContext().catch((cause: unknown) => {
      setError(cause instanceof Error ? cause.message : "Archive AI could not connect.");
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
    setCanGoBackSheet(false);
    setActiveSheet(sheet);
    setSheetOpen(true);
  };

  const pushSheet = (sheet: ArchiveSheet) => {
    const current = activeSheetRef.current;
    if (current) sheetBackStack.current.push(current);
    setCanGoBackSheet(sheetBackStack.current.length > 0);
    setSheetError(undefined);
    setActiveSheet(sheet);
  };

  const goBackSheet = () => {
    const previous = sheetBackStack.current.pop();
    if (!previous) return;
    setSheetError(undefined);
    setActiveSheet(previous);
    setCanGoBackSheet(sheetBackStack.current.length > 0);
  };

  const closeSheet = () => {
    if (activeSheet === "enhance") {
      enhanceGeneration.current += 1;
      enhanceRequest.current?.abort();
      enhanceRequest.current = undefined;
      setEnhancing(false);
    }
    if (activeSheetRef.current === "destination" || activeSheetRef.current === "destinationFolder") destinationGeneration.current += 1;
    if (activeSheetRef.current === "documentActions" || activeSheetRef.current === "rename") documentActionGeneration.current += 1;
    if (activeSheetRef.current === "folderActions" || activeSheetRef.current === "folderDetails") folderActionGeneration.current += 1;
    setSheetOpen(false);
    sheetBackStack.current = [];
    setCanGoBackSheet(false);
    if (sheetCloseTimer.current) clearTimeout(sheetCloseTimer.current);
    sheetCloseTimer.current = setTimeout(() => setActiveSheet(undefined), 240);
  };

  useEffect(() => () => {
    if (sheetCloseTimer.current) clearTimeout(sheetCloseTimer.current);
    autocompleteRequest.current?.abort();
    enhanceRequest.current?.abort();
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
    setError("Wait for the current note to save before leaving.");
  }), [hasContentContext, navigation, saveState]);

  const loadLocation = async (folderKey?: string) => {
    const location = await listContentLocation(folderKey);
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
      if (draftDocumentKey && !pendingCreateFrom(draft.pendingCreate)) {
        const remote = await readContentDocument(draftDocumentKey);
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
      documentKeyRef.current = draftDocumentKey;
      updatedAtRef.current = typeof draft.updatedAt === "string" ? draft.updatedAt : undefined;
      savedTitleRef.current = typeof draft.savedTitle === "string" ? draft.savedTitle : "Untitled note";
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
      }
    })().catch(() => {
      if (draftIdentityRef.current === expectedDraftIdentity) setError("The local draft could not be restored.");
    });
  }, [draftIdentity]);

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
      translationGeneration.current += 1;
      restoreGeneration.current += 1;
      documentMetadataMutation.current = null;
      enhanceGeneration.current += 1;
      enhanceRequest.current?.abort();
      enhanceRequest.current = undefined;
      setEnhancing(false);
      setTranslating(false);
      setTargetLanguage("");
      setVersions([]);
      setLoadingVersions(false);
      setRestoringVersionKey(undefined);
      editorSession.current += 1;
      revision.current = 0;
      dirty.current = false;
      documentKeyRef.current = undefined;
      updatedAtRef.current = undefined;
      pendingCreate.current = undefined;
      titleRef.current = "Untitled note";
      contentRef.current = "";
      savedTitleRef.current = "Untitled note";
      savedContentRef.current = "";
      setTitle("Untitled note");
      setContent("");
      setFolders([]);
      setRootFolders([]);
      setDocuments([]);
      setRootDocuments([]);
      setFolderStack([]);
      setHistory([]);
      setResults(undefined);
      setSelectedSummary(undefined);
      setSelectedDocument(undefined);
      setSelectedFolder(undefined);
      setSheetOpen(false);
      sheetBackStack.current = [];
      setCanGoBackSheet(false);
      setActiveSheet(undefined);
      setError(undefined);
      setSaveState("saved");
    }
    void Promise.all([listContentLocation(), listContentSearchHistory(undefined, true)])
      .then(([location, recent]) => {
        if (contentContextKeyRef.current !== requestContextKey) return;
        setFolders(location.folders);
        setRootFolders(location.folders);
        setDocuments(location.documents);
        setRootDocuments(location.documents);
        setHistory(recent);
      })
      .catch((cause: unknown) => {
        if (contentContextKeyRef.current === requestContextKey) setError(cause instanceof Error ? cause.message : "Knowledge could not connect.");
      });
  }, [contentContextKey, hasContentContext]);

  useEffect(() => {
    if (!hasContentContext || !dirty.current) return;
    const session = editorSession.current;
    const timeout = setTimeout(() => {
      const previous = saveInFlight.current;
      const save = (async () => {
        await previous;
        await documentMetadataMutation.current;
        if (session !== editorSession.current || !dirty.current) return;
        const savingRevision = revision.current;
        const nextTitle = titleRef.current.trim() || "Untitled note";
        const nextContent = contentRef.current;
        setSaveState("saving");
        let activeKey = documentKeyRef.current;
        let activeUpdatedAt = updatedAtRef.current;
        if (!activeKey) {
          if (!nextContent.trim()) {
            dirty.current = false;
            setSaveState("saved");
            if (localDraftFile.exists) localDraftFile.delete();
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
          const saved = await saveContentDocument(activeKey, nextContent, activeUpdatedAt!);
          if (session !== editorSession.current) return;
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
        await loadLocation(currentFolder?.key);
      })().catch((cause: unknown) => {
        if (session !== editorSession.current) return;
        setSaveState("error");
        setError(cause instanceof Error ? cause.message : "The note could not be saved.");
      });
      saveInFlight.current = save;
      void save.finally(() => {
        if (saveInFlight.current === save) saveInFlight.current = null;
      });
    }, 500);
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
    const target = resolveEnhancementTarget(contentRef.current, selectionRef.current);
    setEnhanceRange(target.range);
    clearCompletion();
    openSheet("enhance");
  };

  const runEnhancement = async () => {
    if (!hasContentContext || !contentRef.current.trim()) return;
    const original = contentRef.current;
    const target = resolveEnhancementTarget(original, enhanceRange ?? { start: 0, end: 0 });
    const generation = ++enhanceGeneration.current;
    const controller = new AbortController();
    enhanceRequest.current?.abort();
    enhanceRequest.current = controller;
    setEnhancing(true);
    setSheetError(undefined);
    try {
      const result = await enhanceContent(target.content, controller.signal);
      if (controller.signal.aborted || generation !== enhanceGeneration.current) return;
      if (contentRef.current !== original) {
        setSheetError("The note changed while it was being enhanced. Try again.");
        return;
      }
      const next = applyEnhancement(original, result.content, target.range);
      clearCompletion();
      contentRef.current = next;
      const caret = target.range ? target.range.start + result.content.length : next.length;
      selectionRef.current = { start: caret, end: caret };
      setContent(next);
      markDirty();
      persistLocalDraft(titleRef.current, next);
      closeSheet();
    } catch (cause) {
      if (!controller.signal.aborted) setSheetError(cause instanceof Error ? cause.message : "The note could not be enhanced.");
    } finally {
      if (enhanceRequest.current === controller) enhanceRequest.current = undefined;
      if (generation === enhanceGeneration.current) setEnhancing(false);
    }
  };

  const applyRemoteDocument = (document: ContentDocument & { content: string }) => {
    clearCompletion();
    revision.current += 1;
    dirty.current = false;
    pendingCreate.current = undefined;
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
  };

  const openTranslationSheet = () => {
    setTargetLanguage("");
    pushSheet("translate");
  };

  const runTranslation = async () => {
    const documentKey = documentKeyRef.current;
    const language = targetLanguage.trim();
    if (!documentKey || !language) return;
    if (dirty.current || saveInFlight.current || saveState !== "saved") {
      setSheetError("Wait for the note to finish saving before translating it.");
      return;
    }
    const session = editorSession.current;
    const generation = ++translationGeneration.current;
    const visibleFolderKey = currentFolder?.key;
    setTranslating(true);
    setSheetError(undefined);
    try {
      await translateContentDocument(documentKey, language);
      const document = await readContentDocument(documentKey);
      if (generation !== translationGeneration.current || session !== editorSession.current || documentKeyRef.current !== documentKey) return;
      applyRemoteDocument(document);
      setTargetLanguage("");
      const location = await listContentLocation(visibleFolderKey);
      if (generation !== translationGeneration.current || session !== editorSession.current || documentKeyRef.current !== documentKey) return;
      if (currentFolderKeyRef.current === visibleFolderKey) {
        setFolders(location.folders);
        setDocuments(location.documents);
        if (!visibleFolderKey) {
          setRootFolders(location.folders);
          setRootDocuments(location.documents);
        }
      }
      if (activeSheetRef.current === "translate") closeSheet();
    } catch (cause) {
      if (generation === translationGeneration.current) setSheetError(cause instanceof Error ? cause.message : "The note could not be translated.");
    } finally {
      if (generation === translationGeneration.current) setTranslating(false);
    }
  };

  const openVersionHistory = async () => {
    const documentKey = documentKeyRef.current;
    if (!documentKey) {
      setSheetError("Save the note before opening version history.");
      return;
    }
    if (dirty.current || saveInFlight.current || saveState !== "saved") {
      setSheetError("Wait for the note to finish saving before opening version history.");
      return;
    }
    const session = editorSession.current;
    pushSheet("versions");
    setVersions([]);
    setLoadingVersions(true);
    try {
      const history = await listContentDocumentVersions(documentKey);
      if (session === editorSession.current && documentKeyRef.current === documentKey) setVersions(history);
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "Version history could not be loaded.");
    } finally {
      if (session === editorSession.current) setLoadingVersions(false);
    }
  };

  const restoreVersion = async (versionKey: string) => {
    const documentKey = documentKeyRef.current;
    if (!documentKey || dirty.current || saveInFlight.current || saveState !== "saved") return;
    const session = editorSession.current;
    const generation = ++restoreGeneration.current;
    const visibleFolderKey = currentFolder?.key;
    setRestoringVersionKey(versionKey);
    setSheetError(undefined);
    try {
      await restoreContentDocumentVersion(documentKey, versionKey);
      const document = await readContentDocument(documentKey);
      if (generation !== restoreGeneration.current || session !== editorSession.current || documentKeyRef.current !== documentKey) return;
      applyRemoteDocument(document);
      const location = await listContentLocation(visibleFolderKey);
      if (generation !== restoreGeneration.current || session !== editorSession.current || documentKeyRef.current !== documentKey) return;
      if (currentFolderKeyRef.current === visibleFolderKey) {
        setFolders(location.folders);
        setDocuments(location.documents);
        if (!visibleFolderKey) {
          setRootFolders(location.folders);
          setRootDocuments(location.documents);
        }
      }
      if (activeSheetRef.current === "versions" || activeSheetRef.current === "restoreVersion") closeSheet();
    } catch (cause) {
      if (generation === restoreGeneration.current) setSheetError(cause instanceof Error ? cause.message : "The version could not be restored.");
    } finally {
      if (generation === restoreGeneration.current) setRestoringVersionKey(undefined);
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

  const resetEditor = (nextTitle = "Untitled note") => {
    clearCompletion();
    translationGeneration.current += 1;
    restoreGeneration.current += 1;
    setTranslating(false);
    setRestoringVersionKey(undefined);
    setVersions([]);
    editorSession.current += 1;
    revision.current = 0;
    dirty.current = false;
    documentKeyRef.current = undefined;
    updatedAtRef.current = undefined;
    pendingCreate.current = undefined;
    titleRef.current = nextTitle;
    contentRef.current = "";
    savedTitleRef.current = nextTitle;
    savedContentRef.current = "";
    setTitle(nextTitle);
    setContent("");
    setSelectedSummary(undefined);
    setResults(undefined);
    setSaveState(hasContentContext ? "saved" : "local");
    persistLocalDraft(nextTitle, "");
  };

  const startNewNote = (nextTitle = "Untitled note") => {
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      setSheetError("Wait for the current note to save before creating another.");
      return false;
    }
    resetEditor(nextTitle);
    closeSheet();
    return true;
  };

  const showDocumentActions = (document: ContentDocument) => {
    if (document.key === documentKeyRef.current && (dirty.current || saveInFlight.current || documentMetadataMutation.current)) {
      setError("Wait for the current note to save before managing it.");
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
    if (dirty.current || saveInFlight.current) {
      reportError("Wait for the current note to save before opening another.");
      return false;
    }
    const generation = ++navigationGeneration.current;
    translationGeneration.current += 1;
    restoreGeneration.current += 1;
    setTranslating(false);
    setRestoringVersionKey(undefined);
    setOpeningDocumentKey(document.key);
    setError(undefined);
    try {
      const opened = await readContentDocument(document.key);
      if (generation !== navigationGeneration.current) return false;
      if (opened.extension) {
        setSelectedDocument(opened);
        if (sheetOpen) pushSheet("documentActions");
        else openSheet("documentActions");
        return false;
      }
      editorSession.current += 1;
      applyRemoteDocument(opened);
      setSelectedSummary(undefined);
      setResults(undefined);
      return true;
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : "The note could not be opened.");
      return false;
    } finally {
      if (generation === navigationGeneration.current) setOpeningDocumentKey(undefined);
    }
  };

  const openArchiveDocument = async (document: ContentDocument, fromSheet = false) => {
    if (document.extension) {
      showDocumentActions(document);
      return;
    }
    if (await openNote(document, fromSheet ? setSheetError : setError)) {
      if (fromSheet) closeSheet();
    }
  };

  const showFolderActions = (folder: ContentFolder) => {
    folderActionGeneration.current += 1;
    setFolderActionLoading(false);
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

  const replaceFolder = (updated: ContentFolder, select = true) => {
    const replace = (folder: ContentFolder) => folder.key === updated.key ? updated : folder;
    setFolders((current) => current.map(replace));
    setRootFolders((current) => current.map(replace));
    setFolderStack((current) => current.map(replace));
    setDestinationFolders((current) => current.map(replace));
    if (select) setSelectedFolder(updated);
  };

  const replaceDocument = (updated: ContentDocument, select = true) => {
    const replace = (document: ContentDocument) => document.key === updated.key ? updated : document;
    setDocuments((current) => current.map(replace));
    setRootDocuments((current) => current.map(replace));
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
    if (!selectedFolder || !name || folderActionLoading) return;
    const folderKey = selectedFolder.key;
    const generation = ++folderActionGeneration.current;
    setFolderActionLoading(true);
    setSheetError(undefined);
    try {
      const updated = await updateContentFolder(selectedFolder.key, name, folderDetailsDescription.trim() || null);
      const currentAction = generation === folderActionGeneration.current && selectedFolder.key === folderKey;
      replaceFolder(updated, currentAction);
      if (currentAction && activeSheetRef.current === "folderDetails") {
        setFolderActionLoading(false);
        closeSheet();
      }
    } catch (cause) {
      if (generation === folderActionGeneration.current) setSheetError(cause instanceof Error ? cause.message : "The folder could not be updated.");
    } finally {
      if (generation === folderActionGeneration.current) setFolderActionLoading(false);
    }
  };

  const openFolder = async (folder: ContentFolder) => {
    if (!hasContentContext) return;
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      setError("Wait for the current note to save before opening a folder.");
      return;
    }
    clearCompletion();
    const generation = ++navigationGeneration.current;
    setLocationLoading(true);
    setError(undefined);
    try {
      const [location, recent] = await Promise.all([listContentLocation(folder.key), listContentSearchHistory(folder.key, true)]);
      if (generation !== navigationGeneration.current) return;
      setFolders(location.folders);
      setDocuments(location.documents);
      setFolderStack((current) => [...current, folder]);
      setResults(undefined);
      setHistory(recent);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The folder could not be opened.");
    } finally {
      if (generation === navigationGeneration.current) setLocationLoading(false);
    }
  };

  const goBackFolder = async () => {
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      setError("Wait for the current note to save before navigating.");
      return;
    }
    clearCompletion();
    if (!hasContentContext) {
      setFolders(rootFolders);
      setDocuments([]);
      setFolderStack([]);
      return;
    }
    const generation = ++navigationGeneration.current;
    const nextStack = folderStack.slice(0, -1);
    setLocationLoading(true);
    setError(undefined);
    try {
      const nextFolderKey = nextStack.at(-1)?.key;
      const [location, recent] = await Promise.all([listContentLocation(nextFolderKey), listContentSearchHistory(nextFolderKey, true)]);
      if (generation !== navigationGeneration.current) return;
      setFolders(location.folders);
      setDocuments(location.documents);
      setFolderStack(nextStack);
      setHistory(recent);
      setResults(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The folder could not be opened.");
    } finally {
      if (generation === navigationGeneration.current) setLocationLoading(false);
    }
  };

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
      const recent = await listContentSearchHistory(folderKey, true);
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

  const submitFolder = async () => {
    const name = folderName.trim();
    if (!name || folderCreating) return;
    if (!hasContentContext) {
      setSheetError("Folders require an authenticated Archive connection.");
      return;
    }
    setFolderCreating(true);
    setSheetError(undefined);
    try {
      await createContentFolder(name, currentFolder?.key, folderDescription.trim() || undefined);
      await loadLocation(currentFolder?.key);
      setFolderName("");
      setFolderDescription("");
      closeSheet();
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The folder could not be created.");
    } finally {
      setFolderCreating(false);
    }
  };

  const selectRootFolder = async () => {
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      setSheetError("Wait for the current note to save before changing folders.");
      return;
    }
    const generation = ++navigationGeneration.current;
    setLocationLoading(true);
    setSheetError(undefined);
    try {
      if (hasContentContext) {
        const [location, recent] = await Promise.all([listContentLocation(), listContentSearchHistory(undefined, true)]);
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
      setSheetError("Wait for the current note to save before changing folders.");
      return;
    }
    const generation = ++navigationGeneration.current;
    setLocationLoading(true);
    setSheetError(undefined);
    try {
      if (hasContentContext) {
        const [location, recent] = await Promise.all([listContentLocation(folder.key), listContentSearchHistory(folder.key, true)]);
        if (generation !== navigationGeneration.current) return;
        setFolders(location.folders);
        setDocuments(location.documents);
        setHistory(recent);
      } else {
        setFolders([]);
        setDocuments([]);
      }
      setFolderStack([folder]);
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
    pushSheet("folder");
  };

  const openNewDestinationFolder = () => {
    setDestinationFolderName("");
    setDestinationFolderDescription("");
    pushSheet("destinationFolder");
  };

  const openDestinationPicker = async (action: DestinationAction) => {
    if (!hasContentContext) {
      setSheetError("This action requires a connected Archive.");
      return;
    }
    const generation = ++destinationGeneration.current;
    const startsAtRoot = action === "moveFolder";
    setDestinationAction(action);
    setDestinationStack(startsAtRoot ? [] : folderStack);
    setDestinationFolderName("");
    setDestinationLoading(true);
    if (sheetOpen) pushSheet("destination");
    else openSheet("destination");
    try {
      const next = (await listContentLocation(startsAtRoot ? undefined : currentFolder?.key)).folders;
      if (generation === destinationGeneration.current) setDestinationFolders(next);
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "Folders could not be loaded.");
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
      const next = (await listContentLocation(nextStack.at(-1)?.key)).folders;
      if (generation !== destinationGeneration.current) return;
      setDestinationFolders(next);
      setDestinationStack(nextStack);
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The folder could not be opened.");
    } finally {
      if (generation === destinationGeneration.current) setDestinationLoading(false);
    }
  };

  const createDestinationFolder = async () => {
    const name = destinationFolderName.trim();
    if (!name) return;
    const parentFolderKey = destinationFolder?.key;
    const generation = ++destinationGeneration.current;
    setDestinationLoading(true);
    setSheetError(undefined);
    try {
      const folder = await createContentFolder(name, parentFolderKey, destinationFolderDescription.trim() || undefined);
      if (generation !== destinationGeneration.current) return;
      const appendFolder = (current: ContentFolder[]) => current.some((item) => item.key === folder.key) ? current : [...current, folder].sort((left, right) => left.name.localeCompare(right.name));
      if (currentFolderKeyRef.current === parentFolderKey) setFolders(appendFolder);
      if (!parentFolderKey) setRootFolders(appendFolder);
      setDestinationStack((current) => [...current, folder]);
      setDestinationFolders([]);
      setDestinationFolderName("");
      setDestinationFolderDescription("");
      goBackSheet();
    } catch (cause) {
      if (generation === destinationGeneration.current) setSheetError(cause instanceof Error ? cause.message : "The folder could not be created.");
    } finally {
      if (generation === destinationGeneration.current) setDestinationLoading(false);
    }
  };

  const pickAndUpload = async (folderKey?: string) => {
    const visibleFolderKey = currentFolder?.key;
    setSheetError(undefined);
    try {
      const picked = await File.pickFileAsync({ multipleFiles: true, mimeTypes: UPLOAD_MIME_TYPES });
      if (picked.canceled) return;
      const batch = picked.result.map((file, index): UploadBatchItem => ({ id: `${file.uri}-${index}`, file, name: file.name, status: "pending" }));
      setUploadBatch(batch);
      sheetBackStack.current = [];
      setCanGoBackSheet(false);
      setActiveSheet("uploads");
      setUploading(true);
      let cursor = 0;
      const update = (id: string, change: Partial<UploadBatchItem>) => setUploadBatch((current) => current.map((item) => item.id === id ? { ...item, ...change } : item));
      const worker = async () => {
        while (cursor < batch.length) {
          const item = batch[cursor];
          cursor += 1;
          if (!item) return;
          update(item.id, { status: "uploading" });
          try {
            if (item.file.size > MAX_MOBILE_UPLOAD_BYTES) throw new Error("Mobile uploads must be 8 MB or smaller.");
            await uploadContentDocument({ name: item.file.name, type: item.file.type, size: item.file.size, base64: await item.file.base64() }, folderKey);
            update(item.id, { status: "success" });
          } catch (cause) {
            update(item.id, { status: "error", error: cause instanceof Error ? cause.message : "Upload failed." });
          }
        }
      };
      await Promise.all(Array.from({ length: Math.min(2, batch.length) }, () => worker()));
      const location = await listContentLocation(visibleFolderKey);
      if (currentFolderKeyRef.current === visibleFolderKey) {
        setFolders(location.folders);
        setDocuments(location.documents);
        if (!visibleFolderKey) {
          setRootFolders(location.folders);
          setRootDocuments(location.documents);
        }
      }
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "Documents could not be selected.");
    } finally {
      setUploading(false);
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
      const sourceFolderKey = selectedFolder.key;
      const sourceParentFolderKey = selectedFolder.parentFolderKey;
      const visibleFolderKey = currentFolder?.key;
      const requestContextKey = contentContextKey;
      const generation = ++destinationGeneration.current;
      setDestinationLoading(true);
      setSheetError(undefined);
      try {
        const moved = await moveContentFolder(selectedFolder.key, folderKey);
        const shouldRefreshVisible = visibleFolderKey !== undefined && (visibleFolderKey === sourceParentFolderKey || visibleFolderKey === folderKey);
        const [location, recent, visibleLocation] = await Promise.all([
          listContentLocation(),
          listContentSearchHistory(undefined, true),
          shouldRefreshVisible ? listContentLocation(visibleFolderKey) : Promise.resolve(undefined),
        ]);
        if (contentContextKeyRef.current !== requestContextKey) return;
        setRootFolders(location.folders);
        setRootDocuments(location.documents);
        if (folderStackRef.current.some((folder) => folder.key === sourceFolderKey) || currentFolderKeyRef.current === undefined) {
          setFolderStack([]);
          setFolders(location.folders);
          setDocuments(location.documents);
          setHistory(recent);
          setResults(undefined);
        } else if (visibleLocation && currentFolderKeyRef.current === visibleFolderKey) {
          setFolders(visibleLocation.folders);
          setDocuments(visibleLocation.documents);
        }
        if (generation === destinationGeneration.current) {
          setSelectedFolder(moved);
          if (activeSheetRef.current === "destination") closeSheet();
        }
      } catch (cause) {
        if (generation === destinationGeneration.current) setSheetError(cause instanceof Error ? cause.message : "The folder could not be moved.");
      } finally {
        if (generation === destinationGeneration.current) setDestinationLoading(false);
      }
      return;
    }
    if (!selectedDocument || !destinationAction) return;
    const generation = ++destinationGeneration.current;
    const visibleFolderKey = currentFolder?.key;
    const requestContextKey = contentContextKey;
    setDestinationLoading(true);
    setSheetError(undefined);
    try {
      if (destinationAction === "move") {
        const movingDocumentKey = selectedDocument.key;
        const updated = await trackActiveDocumentMutation(movingDocumentKey, moveContentDocument(movingDocumentKey, folderKey), (result) => {
          if (result.key === documentKeyRef.current) updatedAtRef.current = result.updatedAt;
        });
        if (generation === destinationGeneration.current) setSelectedDocument(updated);
      } else {
        await copyContentDocument(selectedDocument.key, folderKey);
      }
      const location = await listContentLocation(visibleFolderKey);
      if (contentContextKeyRef.current === requestContextKey && currentFolderKeyRef.current === visibleFolderKey) {
        setFolders(location.folders);
        setDocuments(location.documents);
        if (!visibleFolderKey) {
          setRootFolders(location.folders);
          setRootDocuments(location.documents);
        }
      }
      if (generation === destinationGeneration.current && activeSheetRef.current === "destination") closeSheet();
    } catch (cause) {
      if (generation === destinationGeneration.current) setSheetError(cause instanceof Error ? cause.message : `The document could not be ${destinationAction === "move" ? "moved" : "copied"}.`);
    } finally {
      if (generation === destinationGeneration.current) setDestinationLoading(false);
    }
  };

  const toggleFavorite = async () => {
    if (!selectedDocument) return;
    const documentKey = selectedDocument.key;
    const generation = ++documentActionGeneration.current;
    setDocumentActionLoading("favorite");
    setSheetError(undefined);
    try {
      const updated = await trackActiveDocumentMutation(documentKey, setContentDocumentFavorite(documentKey, !selectedDocument.isFavorite), (result) => {
        if (result.key === documentKeyRef.current) updatedAtRef.current = result.updatedAt;
      });
      const currentAction = generation === documentActionGeneration.current && selectedDocument.key === documentKey;
      replaceDocument(updated, currentAction);
    } catch (cause) {
      if (generation === documentActionGeneration.current) setSheetError(cause instanceof Error ? cause.message : "The favorite could not be updated.");
    } finally {
      if (generation === documentActionGeneration.current) setDocumentActionLoading(undefined);
    }
  };

  const downloadOriginal = async () => {
    if (!selectedDocument) return;
    const generation = ++documentActionGeneration.current;
    setDocumentActionLoading("download");
    setSheetError(undefined);
    try {
      const download = await downloadContentDocument(selectedDocument.key, selectedDocument.extension ? "original" : "txt");
      const directory = await Directory.pickDirectoryAsync();
      const file = directory.createFile(download.fileName, download.mimeType);
      await writeAsStringAsync(file.uri, download.content, { encoding: EncodingType.Base64 });
      if (generation === documentActionGeneration.current && activeSheetRef.current === "documentActions") {
        setDocumentActionLoading(undefined);
        closeSheet();
      }
    } catch (cause) {
      if (generation === documentActionGeneration.current) setSheetError(cause instanceof Error ? cause.message : "The original file could not be downloaded.");
    } finally {
      if (generation === documentActionGeneration.current) setDocumentActionLoading(undefined);
    }
  };

  const submitRename = async () => {
    const name = renameName.trim();
    if (!selectedDocument || !name) return;
    const documentKey = selectedDocument.key;
    const editorTitleAtStart = titleRef.current;
    const generation = ++documentActionGeneration.current;
    setDocumentActionLoading("rename");
    setSheetError(undefined);
    try {
      const updated = await trackActiveDocumentMutation(documentKey, renameContentDocument(documentKey, name), (result) => {
        if (result.key === documentKeyRef.current) updatedAtRef.current = result.updatedAt;
      });
      const currentAction = generation === documentActionGeneration.current && selectedDocument.key === documentKey;
      replaceDocument(updated, currentAction);
      if (updated.key === documentKeyRef.current) {
        if (titleRef.current === editorTitleAtStart) {
          titleRef.current = updated.name;
          savedTitleRef.current = updated.name;
          setTitle(updated.name);
        }
      }
      if (currentAction && activeSheetRef.current === "rename") {
        setDocumentActionLoading(undefined);
        closeSheet();
      }
    } catch (cause) {
      if (generation === documentActionGeneration.current) setSheetError(cause instanceof Error ? cause.message : "The document could not be renamed.");
    } finally {
      if (generation === documentActionGeneration.current) setDocumentActionLoading(undefined);
    }
  };

  return (
    <KeyboardAvoidingView behavior="padding" style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <Button accessibilityLabel="Back to your personal AI" contentMode="raw" onPress={() => navigation.goBack()} size="md" style={styles.headerBack} variant="ghost">
          <ChevronLeftIcon size="md" variant="accent" />
        </Button>
        <View style={styles.identity}>
          <ChromeIcon glow={0.7} size={34} source={capabilityIconSource.archive} />
          <Text style={styles.headerTitle}>ARCHIVE</Text>
        </View>
      </View>

      <ScrollView
        automaticallyAdjustKeyboardInsets={Platform.OS === "ios"}
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.sm }]}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        scrollEnabled={!editorFocused}
        style={styles.scrollView}
      >
        <View style={[styles.noteSheet, editorFocused && styles.noteSheetFocused]}>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{documentKeyRef.current ? "EDIT NOTE" : "CREATE NOTE"}</Text>
            <View style={styles.noteActions}>
              <Button accessibilityLabel="Browse Archive" contentMode="raw" onPress={() => openSheet("library")} size="sm" variant="icon">
                <FileIcon size="sm" />
              </Button>
              {activeDocument ? (
                <Button accessibilityLabel="Manage current note" contentMode="raw" onPress={() => showDocumentActions(activeDocument)} size="sm" variant="icon">
                  <MoreHorizontalIcon size="sm" />
                </Button>
              ) : null}
              <Button accessibilityLabel="Create in Archive" contentMode="raw" onPress={() => openSheet("create")} size="sm" variant="icon">
                <PlusIcon size="sm" />
              </Button>
            </View>
          </View>

          {currentFolder ? (
            <View style={styles.folderContext}>
              <Button disabled={locationLoading} icon={<ChevronLeftIcon size="sm" />} loading={locationLoading} onPress={() => void goBackFolder()} size="xs" style={styles.folderContextBack} variant="ghost">Back to {folderStack.at(-2)?.name ?? "Archive"}</Button>
              <Button accessibilityLabel={`Manage ${currentFolder.name}`} contentMode="raw" onPress={() => showFolderActions(currentFolder)} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
            </View>
          ) : null}

          {error ? <Text accessibilityRole="alert" style={styles.notice}>{error}</Text> : null}
          {saveState === "saving" || saveState === "dirty" ? <Text accessibilityLiveRegion="polite" style={styles.saveStatus}>{saveState === "saving" ? "Saving note..." : "Changes waiting to save..."}</Text> : null}
          {saveState === "error" ? (
            <View style={styles.saveErrorRow}>
              <Text style={styles.saveErrorText}>This draft is stored on this device but has not synced.</Text>
              <Button onPress={() => setSaveRetry((current) => current + 1)} size="xs" variant="secondary">Retry save</Button>
            </View>
          ) : null}

          {results ? (
            <View style={styles.results}>
              <View style={styles.resultsHeader}>
                <View>
                  <Text style={styles.eyebrow}>ARCHIVE SEARCH</Text>
                  <Text style={styles.resultsTitle}>{results.query}</Text>
                  <Text style={styles.rowSubtitle}>Scope: {currentFolder ? `${currentFolder.name} and nested folders` : "All Archive documents"}</Text>
                </View>
                <Button onPress={() => setResults(undefined)} size="xs" variant="ghost">Back</Button>
              </View>
              {results.cached ? <Text style={styles.meta}>REUSED FROM SEARCH HISTORY</Text> : null}
              {results.documents.map((document) => (
                <Button contentMode="raw" key={document.documentKey} onPress={() => { setSelectedSummary(document); openSheet("summary"); }} size="lg" style={styles.resultRow} variant="secondary">
                  <FileIcon size="md" variant="accent" />
                  <View style={styles.resultText}><Text numberOfLines={1} style={styles.rowTitle}>{document.name}</Text><Text numberOfLines={2} style={styles.rowSubtitle}>{document.summary}</Text></View>
                </Button>
              ))}
              {results.documents.length === 0 ? <Text style={styles.empty}>No documents matched this search.</Text> : null}
            </View>
          ) : (
            <>
              <TextInput
                accessibilityLabel="Note title"
                maxLength={255}
                onChangeText={(value) => { titleRef.current = value; setTitle(value); markDirty(); persistLocalDraft(value, contentRef.current); }}
                style={styles.titleInput}
                value={title}
              />
              <View style={[styles.editorFrame, editorFocused && styles.editorFrameFocused]}>
                {completion ? (
                  <Text accessibilityElementsHidden importantForAccessibility="no-hide-descendants" pointerEvents="none" style={styles.editorGhost}>
                    <Text style={styles.editorGhostSpacer}>{content}</Text>
                    <Text style={styles.completionText}>{/\s$/.test(content) || /^[,.;:!?)]/.test(completion) ? "" : " "}{completion}</Text>
                  </Text>
                ) : null}
                <TextInput
                  accessibilityLabel="Note content"
                  multiline
                  onBlur={() => setEditorFocused(false)}
                  onChangeText={(value) => {
                    if (documentKeyRef.current && value.length === 0) {
                      setError("Saved notes must contain at least one character.");
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
                  placeholder="Start writing from here..."
                  onFocus={() => setEditorFocused(true)}
                  onSelectionChange={(event) => {
                    selectionRef.current = event.nativeEvent.selection;
                    if (event.nativeEvent.selection.end !== contentRef.current.length) clearCompletion();
                  }}
                  style={[styles.editor, editorFocused && styles.editorFocused]}
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
                      <Button disabled={locationLoading} icon={<FolderIcon size="sm" />} loading={locationLoading} onPress={() => void (hasContentContext ? openFolder(folder) : selectFolder(folder))} size="sm" style={styles.locationItem} variant="ghost">{folder.name}</Button>
                      <Button accessibilityLabel={`Manage ${folder.name}`} contentMode="raw" onPress={() => showFolderActions(folder)} size="xs" variant="icon"><MoreHorizontalIcon size="sm" /></Button>
                    </View>
                  ))}
                  {documents.slice(0, 3).map((document) => <Button key={document.key} loading={openingDocumentKey === document.key} onPress={() => void openArchiveDocument(document)} size="sm" variant="ghost" icon={document.isFavorite ? <StarIcon size="sm" /> : <FileIcon size="sm" />}>{document.name}</Button>)}
                </View>
              ) : null}
            </>
          )}
          {!results ? (
            <Button accessibilityLabel="Enhance note with AI" contentMode="raw" disabled={!hasContentContext || !content.trim()} onPress={openEnhanceSheet} size="lg" style={styles.enhanceFab} variant="primary">
              <BrainIcon size="md" variant="inverse" />
            </Button>
          ) : null}
        </View>

        {!editorFocused ? (
          <View style={styles.searchArea}>
            <Text style={styles.meta}>SEARCHING {currentFolder ? `${currentFolder.name.toUpperCase()} + NESTED FOLDERS` : "ALL ARCHIVE DOCUMENTS"}</Text>
            {history.length > 0 && !results ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.history}>
                {history.slice(0, 4).map((item) => <Button key={`${item.normalizedQuery}-${item.searchedAt}`} onPress={() => restoreHistory(item)} size="xs" variant="ghost" icon={<ClockIcon size="sm" />}>{item.query}</Button>)}
              </ScrollView>
            ) : null}
            <View style={styles.searchBar}>
              <SearchIcon size="sm" variant="muted" />
              <TextInput
                accessibilityLabel="Search Archive documents"
                onChangeText={setQuery}
                onSubmitEditing={() => void runSearch()}
                placeholder="Search documents..."
                returnKeyType="search"
                style={styles.searchInput}
                value={query}
              />
              <Button accessibilityLabel="Search" contentMode="raw" disabled={!query.trim() || !hasContentContext} loading={searching} onPress={() => void runSearch()} size="sm" variant="primary"><SendIcon size="sm" /></Button>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <BottomSheet
        description={activeSheet === "create" ? "Choose what to add to the current folder." : activeSheet === "folder" ? `Create a folder inside ${currentFolder?.name ?? "Archive"}.` : activeSheet === "destinationFolder" ? `Create a folder inside ${destinationFolder?.name ?? "Archive"}.` : activeSheet === "enhance" ? "Correct spelling and improve wording while preserving meaning." : activeSheet === "translate" ? "Translate the full note into any language." : activeSheet === "versions" ? "Choose an earlier snapshot to review before restoring it." : activeSheet === "restoreVersion" ? "The current text will be backed up before this version is restored." : activeSheet === "destination" ? `Choose where to ${destinationAction === "moveFolder" ? "move this folder" : destinationAction === "upload" ? "upload documents" : `${destinationAction ?? "continue"} this document`}.` : activeSheet === "summary" ? "Review the match, then open its source document." : activeSheet === "folderDetails" ? "Rename this folder or add context that describes what belongs inside." : undefined}
        dismissible={!uploading && !translating && !restoringVersionKey && !folderCreating && !folderActionLoading && !destinationLoading && !documentActionLoading}
        mutation={activeSheet === "documents" || activeSheet === "folder" || activeSheet === "destinationFolder" || activeSheet === "folders" || activeSheet === "translate" || activeSheet === "rename" || activeSheet === "destination" || activeSheet === "folderDetails"}
        onOpenChange={(open) => { if (!open) closeSheet(); }}
        open={sheetOpen}
        tall={activeSheet === "library" || activeSheet === "documents" || activeSheet === "folders" || activeSheet === "versions" || activeSheet === "destination" || activeSheet === "uploads"}
        title={activeSheet === "enhance" ? "AI actions" : activeSheet === "translate" ? "Translate note" : activeSheet === "versions" ? "Version history" : activeSheet === "restoreVersion" ? "Restore this version?" : activeSheet === "folder" || activeSheet === "destinationFolder" ? "Create folder" : activeSheet === "documents" ? "Documents" : activeSheet === "folders" ? "Folders" : activeSheet === "library" ? "Browse Archive" : activeSheet === "documentActions" ? selectedDocument?.name ?? "Document actions" : activeSheet === "destination" ? "Choose destination" : activeSheet === "rename" ? selectedDocument?.extension ? "Rename document" : "Rename note" : activeSheet === "summary" ? selectedSummary?.name ?? "Document summary" : activeSheet === "uploads" ? "Upload progress" : activeSheet === "folderActions" ? selectedFolder?.name ?? "Folder actions" : activeSheet === "folderDetails" ? "Folder details" : "New in Archive"}
      >
        {canGoBackSheet && !uploading ? <Button icon={<ChevronLeftIcon size="sm" />} onPress={goBackSheet} size="sm" style={styles.sheetBack} variant="ghost">Back</Button> : null}
        {sheetError ? <Text accessibilityRole="alert" style={styles.notice}>{sheetError}</Text> : null}
        {activeSheet === "create" ? (
          <>
            <BottomSheetItem icon={<FileIcon />} onPress={() => { void startNewNote(); }}>New document</BottomSheetItem>
            <BottomSheetItem icon={<FolderIcon />} onPress={openNewFolder}>New folder</BottomSheetItem>
            <BottomSheetItem disabled={uploading} icon={<UploadIcon />} loading={uploading} onPress={() => void openDestinationPicker("upload")}>Upload documents</BottomSheetItem>
          </>
        ) : null}
        {activeSheet === "documentActions" && selectedDocument ? (
          <>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} icon={<StarIcon />} loading={documentActionLoading === "favorite"} onPress={() => void toggleFavorite()}>{selectedDocument.isFavorite ? "Remove from favorites" : "Add to favorites"}</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} icon={<DownloadIcon />} loading={documentActionLoading === "download"} onPress={() => void downloadOriginal()}>{selectedDocument.extension ? "Download original" : "Download as text"}</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} icon={<EditIcon />} onPress={() => { setRenameName(selectedDocument.name); pushSheet("rename"); }}>Rename</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} icon={<FolderIcon />} onPress={() => void openDestinationPicker("move")}>Move to folder</BottomSheetItem>
            <BottomSheetItem disabled={Boolean(documentActionLoading)} icon={<CopyIcon />} onPress={() => void openDestinationPicker("copy")}>Copy to folder</BottomSheetItem>
          </>
        ) : null}
        {activeSheet === "folderActions" && selectedFolder ? (
          <>
            <BottomSheetItem disabled={folderActionLoading} icon={<EditIcon />} onPress={openFolderDetails}>Edit name and description</BottomSheetItem>
            <BottomSheetItem disabled={folderActionLoading} icon={<FolderIcon />} onPress={() => void openDestinationPicker("moveFolder")}>Move folder</BottomSheetItem>
          </>
        ) : null}
        {activeSheet === "folderDetails" && selectedFolder ? (
          <View style={styles.namingForm}>
            <Text style={styles.inputLabel}>Folder name</Text>
            <TextInput accessibilityLabel="Folder name" autoFocus maxLength={255} onChangeText={setFolderDetailsName} placeholder="Folder name" value={folderDetailsName} />
            <Text style={styles.inputLabel}>Description</Text>
            <TextInput accessibilityLabel="Folder description" maxLength={2000} multiline onChangeText={setFolderDetailsDescription} placeholder="What belongs in this folder?" style={styles.folderDescriptionInput} textAlignVertical="top" value={folderDetailsDescription} />
            <Button disabled={!folderDetailsName.trim() || folderActionLoading} loading={folderActionLoading} onPress={() => void submitFolderDetails()} size="md" variant="primary">Save folder details</Button>
          </View>
        ) : null}
        {activeSheet === "rename" ? (
          <View style={styles.namingForm}>
            <Text style={styles.inputLabel}>Document name</Text>
            <TextInput accessibilityLabel="Document name" autoFocus maxLength={255} onChangeText={setRenameName} onSubmitEditing={() => void submitRename()} placeholder="Document name" returnKeyType="done" value={renameName} />
            <Button disabled={!renameName.trim() || Boolean(documentActionLoading)} loading={documentActionLoading === "rename"} onPress={() => void submitRename()} size="md" variant="primary">Rename</Button>
          </View>
        ) : null}
        {activeSheet === "summary" && selectedSummary ? (
          <View style={styles.summaryPanel}>
            <View style={styles.enhanceIdentity}>
              <FileIcon size="lg" variant="accent" />
              <View style={styles.enhanceCopy}><Text style={styles.rowTitle}>{selectedSummary.name}</Text><Text style={styles.meta}>SEARCH SUMMARY</Text></View>
            </View>
            <Text style={styles.summaryText}>{selectedSummary.summary}</Text>
            <Button loading={openingDocumentKey === selectedSummary.documentKey} onPress={() => void openSummaryDocument()} size="lg" variant="primary">Open document</Button>
          </View>
        ) : null}
        {activeSheet === "destination" ? (
          <View style={styles.destinationPanel}>
            <Text style={styles.meta}>CURRENT DESTINATION: {destinationFolder?.name.toUpperCase() ?? "ARCHIVE"}</Text>
            <Button disabled={destinationLoading} icon={<CheckIcon size="sm" />} loading={destinationLoading} onPress={() => void selectDestination()} size="lg" variant="primary">{destinationAction === "upload" ? "Choose files for this folder" : destinationAction === "moveFolder" ? "Move folder here" : destinationAction === "move" ? "Move document here" : "Copy document here"}</Button>
            {destinationStack.length > 0 ? <Button disabled={destinationLoading} icon={<ChevronLeftIcon size="sm" />} onPress={() => void browseDestination(undefined, true)} size="sm" variant="ghost">Back to {destinationStack.at(-2)?.name ?? "Archive"}</Button> : null}
            <ScrollView contentContainerStyle={styles.destinationFolders} keyboardShouldPersistTaps="handled" style={styles.folderList}>
              {destinationFolders.filter((folder) => destinationAction !== "moveFolder" || folder.key !== selectedFolder?.key).map((folder) => <Button disabled={destinationLoading} icon={<FolderIcon size="md" />} key={folder.key} onPress={() => void browseDestination(folder)} size="lg" variant="secondary">{folder.name}</Button>)}
              {!destinationLoading && destinationFolders.filter((folder) => destinationAction !== "moveFolder" || folder.key !== selectedFolder?.key).length === 0 ? <Text style={styles.empty}>No nested folders here.</Text> : null}
            </ScrollView>
            <Button disabled={destinationLoading} icon={<PlusIcon size="sm" />} onPress={openNewDestinationFolder} size="md" variant="secondary">New folder here</Button>
          </View>
        ) : null}
        {activeSheet === "destinationFolder" ? (
          <View style={styles.namingForm}>
            <Text style={styles.inputLabel}>Folder name</Text>
            <TextInput accessibilityLabel="New destination folder name" autoFocus editable={!destinationLoading} maxLength={255} onChangeText={setDestinationFolderName} placeholder="Folder name" value={destinationFolderName} />
            <Text style={styles.inputLabel}>Description</Text>
            <TextInput accessibilityLabel="New destination folder description" editable={!destinationLoading} maxLength={2000} multiline onChangeText={setDestinationFolderDescription} placeholder="What belongs in this folder?" style={styles.folderDescriptionInput} textAlignVertical="top" value={destinationFolderDescription} />
            <Button disabled={!destinationFolderName.trim() || destinationLoading} loading={destinationLoading} onPress={() => void createDestinationFolder()} size="md" variant="primary">Create folder</Button>
          </View>
        ) : null}
        {activeSheet === "uploads" ? (
          <View style={styles.uploadPanel}>
            <Text style={styles.rowSubtitle}>{uploading ? "Uploading up to two files at a time." : "Upload batch complete."}</Text>
            {uploadBatch.map((item) => (
              <View key={item.id} style={styles.uploadRow}>
                {item.status === "success" ? <CheckIcon size="sm" variant="accent" /> : <FileIcon size="sm" variant={item.status === "error" ? "muted" : "accent"} />}
                <View style={styles.resultText}><Text numberOfLines={1} style={styles.rowTitle}>{item.name}</Text><Text style={styles.rowSubtitle}>{item.status === "error" ? item.error : item.status}</Text></View>
              </View>
            ))}
            {!uploading ? <Button onPress={closeSheet} size="lg" variant="primary">Close</Button> : null}
          </View>
        ) : null}
        {activeSheet === "enhance" ? (
          <View style={styles.enhancePanel}>
            <View style={styles.enhanceIdentity}>
              <BrainIcon size="lg" variant="accent" />
              <View style={styles.enhanceCopy}>
                <Text style={styles.rowTitle}>{enhanceRange ? "Selected text" : "Entire note"}</Text>
                <Text style={styles.rowSubtitle}>{enhanceRange ? "Only the highlighted passage will be replaced." : "No text is selected, so the full note will be replaced."}</Text>
              </View>
            </View>
            <Button disabled={enhancing} icon={<BrainIcon size="sm" />} loading={enhancing} onPress={() => void runEnhancement()} size="lg" variant="primary">
              {enhanceRange ? "Enhance selection" : "Enhance note"}
            </Button>
            <Button disabled={!documentKeyRef.current || saveState !== "saved"} icon={<GlobeIcon size="sm" />} onPress={openTranslationSheet} size="lg" variant="secondary">
              Translate note
            </Button>
            <Button disabled={!documentKeyRef.current || saveState !== "saved"} icon={<ClockIcon size="sm" />} onPress={() => void openVersionHistory()} size="lg" variant="secondary">
              Version history
            </Button>
            {!documentKeyRef.current || saveState !== "saved" ? <Text style={styles.rowSubtitle}>Translation and version history become available after the note is saved.</Text> : null}
          </View>
        ) : null}
        {activeSheet === "translate" ? (
          <View style={styles.enhancePanel}>
            <View style={styles.enhanceIdentity}>
              <GlobeIcon size="lg" variant="accent" />
              <View style={styles.enhanceCopy}>
                <Text style={styles.rowTitle}>Translate entire note</Text>
                <Text style={styles.rowSubtitle}>The current text will be saved as a version before the translation replaces it.</Text>
              </View>
            </View>
            <TextInput
              accessibilityLabel="Translation language"
              autoCapitalize="words"
              autoFocus
              maxLength={120}
              onChangeText={setTargetLanguage}
              onSubmitEditing={() => void runTranslation()}
              placeholder="Language, for example Spanish or Japanese"
              returnKeyType="done"
              value={targetLanguage}
            />
            <Button disabled={!targetLanguage.trim() || translating} icon={<GlobeIcon size="sm" />} loading={translating} onPress={() => void runTranslation()} size="lg" variant="primary">
              Translate
            </Button>
          </View>
        ) : null}
        {activeSheet === "versions" ? (
          <View style={styles.versionPanel}>
            <View style={styles.currentVersion}>
              <CheckIcon size="sm" variant="accent" />
              <View style={styles.enhanceCopy}>
                <Text style={styles.rowTitle}>Current document</Text>
                <Text style={styles.rowSubtitle}>Restoring history will save this current text as another version.</Text>
              </View>
            </View>
            {loadingVersions ? <Text style={styles.empty}>Loading version history...</Text> : null}
            {!loadingVersions && versions.length === 0 ? <Text style={styles.empty}>No previous versions yet. Translating this note will create one.</Text> : null}
            {versions.map((version) => (
              <Button contentMode="raw" disabled={Boolean(restoringVersionKey)} key={version.key} onPress={() => { setSelectedVersion(version); pushSheet("restoreVersion"); }} size="lg" style={styles.resultRow} variant="secondary">
                <ClockIcon size="md" variant="accent" />
                <View style={styles.resultText}>
                  <Text style={styles.rowTitle}>{version.label ?? `Version ${version.version}`}</Text>
                  <Text style={styles.rowSubtitle}>{new Date(version.createdAt).toLocaleString()}</Text>
                </View>
              </Button>
            ))}
          </View>
        ) : null}
        {activeSheet === "restoreVersion" && selectedVersion ? (
          <View style={styles.enhancePanel}>
            <View style={styles.currentVersion}>
              <ClockIcon size="md" variant="accent" />
              <View style={styles.enhanceCopy}>
                <Text style={styles.rowTitle}>{selectedVersion.label ?? `Version ${selectedVersion.version}`}</Text>
                <Text style={styles.rowSubtitle}>{new Date(selectedVersion.createdAt).toLocaleString()}</Text>
              </View>
            </View>
            <Text style={styles.summaryText}>Restore this snapshot as the current note? Your current text will remain available in version history.</Text>
            <Button disabled={Boolean(restoringVersionKey)} loading={restoringVersionKey === selectedVersion.key} onPress={() => void restoreVersion(selectedVersion.key)} size="lg" variant="primary">Restore version</Button>
            <Button disabled={Boolean(restoringVersionKey)} onPress={goBackSheet} size="lg" variant="ghost">Cancel</Button>
          </View>
        ) : null}
        {activeSheet === "folder" ? (
          <View style={styles.namingForm}>
            <Text style={styles.inputLabel}>Folder name</Text>
            <TextInput accessibilityLabel="New folder name" autoFocus editable={!folderCreating} maxLength={255} onChangeText={setFolderName} placeholder="Folder name" value={folderName} />
            <Text style={styles.inputLabel}>Description</Text>
            <TextInput accessibilityLabel="New folder description" editable={!folderCreating} maxLength={2000} multiline onChangeText={setFolderDescription} placeholder="What belongs in this folder?" style={styles.folderDescriptionInput} textAlignVertical="top" value={folderDescription} />
            <Button disabled={!folderName.trim() || folderCreating} loading={folderCreating} onPress={() => void submitFolder()} size="md" variant="primary">Create folder</Button>
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
              {showArchiveRoot ? <Button disabled={locationLoading} icon={<ArchiveIcon size="md" />} loading={locationLoading} onPress={() => void selectRootFolder()} size="lg" style={styles.folderTile} variant="secondary">Archive</Button> : null}
              {visibleFolders.map((folder) => (
                <View key={folder.key} style={styles.managedTile}>
                  <Button disabled={locationLoading} icon={<FolderIcon size="md" />} loading={locationLoading} onPress={() => void selectFolder(folder)} size="lg" style={styles.managedTileMain} variant="secondary">{folder.name}</Button>
                  <Button accessibilityLabel={`Manage ${folder.name}`} contentMode="raw" disabled={locationLoading} onPress={() => showFolderActions(folder)} size="xs" style={styles.managedTileAction} variant="icon"><MoreHorizontalIcon size="sm" /></Button>
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
              <TextInput accessibilityLabel="Search Archive documents" autoFocus onChangeText={setLibraryQuery} placeholder="Search documents" style={styles.folderSearchInput} value={libraryQuery} />
            </View>
            <ScrollView contentContainerStyle={styles.folderGrid} keyboardShouldPersistTaps="handled" style={styles.folderList}>
              {visibleDocuments.map((document) => (
                <Button icon={document.isFavorite ? <StarIcon size="md" /> : <FileIcon size="md" />} key={document.key} loading={openingDocumentKey === document.key} onPress={() => void openArchiveDocument(document, true)} size="lg" style={styles.folderTile} variant="secondary">
                  {document.name}
                </Button>
              ))}
              {visibleDocuments.length === 0 ? <Text style={styles.empty}>No documents match this search.</Text> : null}
            </ScrollView>
          </>
        ) : null}
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.md, flexDirection: "row", alignItems: "center", gap: 6, borderBottomColor: palette.hairline, borderBottomWidth: 1 },
  headerBack: { width: 42 },
  identity: { flexDirection: "row", alignItems: "center", gap: 10 },
  eyebrow: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 9, letterSpacing: tracking.micro },
  headerTitle: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 15, letterSpacing: tracking.label },
  scrollView: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  noteSheet: { flexGrow: 1, minHeight: 360, padding: spacing.md, paddingBottom: 76, borderRadius: radii.xl, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised },
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
  titleInput: { minHeight: 58, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", color: palette.silver50, fontFamily: fonts.medium, fontSize: 28 },
  editorFrame: { minHeight: 270, position: "relative" },
  editorFrameFocused: { flex: 1, minHeight: 80 },
  editor: { minHeight: 270, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26 },
  editorFocused: { flex: 1, minHeight: 80 },
  editorGhost: { bottom: 0, left: 0, position: "absolute", right: 0, top: 0, zIndex: 1, paddingVertical: 10, color: "transparent", fontFamily: fonts.regular, fontSize: 16, lineHeight: 26 },
  editorGhostSpacer: { color: "transparent" },
  completionText: { color: palette.silver500, fontFamily: fonts.regular, fontSize: 16, fontStyle: "italic", lineHeight: 26 },
  completionAccept: { bottom: 8, position: "absolute", right: 0, zIndex: 2 },
  enhanceFab: { bottom: spacing.md, position: "absolute", right: spacing.md, zIndex: 3 },
  enhancePanel: { gap: 18 },
  enhanceIdentity: { padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panel },
  enhanceCopy: { flex: 1, gap: 4 },
  versionPanel: { gap: 10 },
  summaryPanel: { gap: 16 },
  summaryText: { color: palette.silver300, fontFamily: fonts.regular, fontSize: 15, lineHeight: 24 },
  destinationPanel: { flex: 1, gap: 12 },
  sheetBack: { alignSelf: "flex-start", marginBottom: 6 },
  destinationFolders: { gap: 8, paddingVertical: 4 },
  uploadPanel: { gap: 10 },
  uploadRow: { minHeight: 54, padding: 12, flexDirection: "row", alignItems: "center", gap: 10, borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panel },
  currentVersion: { padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panel },
  locationPreview: { gap: 4, marginTop: 10 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  locationItem: { flex: 1, justifyContent: "flex-start" },
  match: { gap: 7, marginBottom: 10, padding: 12, borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panel },
  searchArea: { marginTop: spacing.md, gap: 8 },
  history: { gap: 5, paddingHorizontal: 4 },
  searchBar: { minHeight: 58, padding: 7, paddingLeft: 16, flexDirection: "row", alignItems: "center", gap: 9, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised },
  searchInput: { flex: 1, minHeight: 40, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", fontSize: 14 },
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
  managedTile: { minHeight: 86, flexBasis: "48%", position: "relative" },
  managedTileMain: { minHeight: 86, width: "100%", flexDirection: "column", gap: 8, paddingHorizontal: 10 },
  managedTileAction: { position: "absolute", right: 4, top: 4 },
});
