import { useNavigation } from "expo-router";
import { File, Paths } from "expo-file-system";
import { useEffect, useRef, useState } from "react";
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button } from "@vorinthex/shared/ui/button";
import { TextInput } from "@vorinthex/shared/ui/text-input";
import {
  ArchiveIcon,
  CheckIcon,
  ChevronLeftIcon,
  ClockIcon,
  FileIcon,
  FolderIcon,
  GlobeIcon,
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
  enhanceContent,
  getContentContext,
  isContentContextConfigured,
  listContentDocumentVersions,
  listContentLocation,
  listContentSearchHistory,
  readContentDocument,
  renameContentDocument,
  restoreContentDocumentVersion,
  saveContentDocument,
  searchContent,
  translateContentDocument,
  uploadContentDocument,
  type ContentDocument,
  type ContentDocumentVersion,
  type ContentFolder,
  type ContentSearchHistoryItem,
  type ContentSearchResponse,
} from "@/lib/content-client";
import { applyEnhancement, resolveEnhancementTarget, type TextRange } from "@/lib/note-enhancement";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";
import { useAuthStore } from "@/state/auth";

type SaveState = "local" | "dirty" | "saving" | "saved" | "error";
type ArchiveSheet = "create" | "document" | "folder" | "library" | "documents" | "folders" | "enhance" | "translate" | "versions";

const localDraftFile = new File(Paths.document, "knowledge-draft.json");
const localFoldersFile = new File(Paths.document, "archive-local-folders.json");
const MAX_MOBILE_UPLOAD_BYTES = 8 * 1024 * 1024;
const AUTOCOMPLETE_WORD_COUNT = 8;

function lastWords(value: string, count: number) {
  return value.trim().split(/\s+/).filter(Boolean).slice(-count).join(" ");
}

export function KnowledgeWorkspace() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const organizationKey = useAuthStore((state) => typeof state.organization?.key === "string" ? state.organization.key : "");
  const scopeKey = useAuthStore((state) => typeof state.scope?.key === "string" ? state.scope.key : "");
  const agentKey = useAuthStore((state) => state.contentExecution?.agentKey ?? "");
  const reconnectContentContext = useAuthStore((state) => state.reconnectContentContext);
  const hasContentContext = isContentContextConfigured({ organizationKey, scopeKey, agentKey });
  const contentContextKey = hasContentContext ? `${organizationKey}:${scopeKey}:${agentKey}` : "";
  const [activeSheet, setActiveSheet] = useState<ArchiveSheet>();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [sheetError, setSheetError] = useState<string>();
  const [editorFocused, setEditorFocused] = useState(false);
  const [title, setTitle] = useState("Untitled note");
  const [content, setContent] = useState("");
  const [completion, setCompletion] = useState("");
  const [autocompletePending, setAutocompletePending] = useState(false);
  const [autocompleteRevision, setAutocompleteRevision] = useState(0);
  const [enhancing, setEnhancing] = useState(false);
  const [enhanceRange, setEnhanceRange] = useState<TextRange>();
  const [targetLanguage, setTargetLanguage] = useState("");
  const [translating, setTranslating] = useState(false);
  const [versions, setVersions] = useState<ContentDocumentVersion[]>([]);
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
  const [results, setResults] = useState<ContentSearchResponse>();
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [matchSummary, setMatchSummary] = useState<string>();
  const [folderName, setFolderName] = useState("");
  const [documentName, setDocumentName] = useState("");
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
  const pendingCreateKey = useRef<string | undefined>(undefined);
  const navigationGeneration = useRef(0);
  const sheetCloseTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const loadedContentContextKey = useRef<string | undefined>(undefined);
  const selectionRef = useRef({ start: 0, end: 0 });
  const autocompleteRequest = useRef<AbortController | undefined>(undefined);
  const autocompleteGeneration = useRef(0);
  const enhanceRequest = useRef<AbortController | undefined>(undefined);
  const enhanceGeneration = useRef(0);
  const currentFolder = folderStack.at(-1);
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

  const openSheet = (sheet: ArchiveSheet) => {
    if (sheetCloseTimer.current) clearTimeout(sheetCloseTimer.current);
    setSheetError(undefined);
    setActiveSheet(sheet);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    if (activeSheet === "enhance") {
      enhanceGeneration.current += 1;
      enhanceRequest.current?.abort();
      enhanceRequest.current = undefined;
      setEnhancing(false);
    }
    setSheetOpen(false);
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
      setAutocompletePending(true);
      void autocompleteContent(context, AUTOCOMPLETE_WORD_COUNT, controller.signal).then(({ completion: next }) => {
        if (generation !== autocompleteGeneration.current || controller.signal.aborted || contentRef.current !== current) return;
        setCompletion(next);
      }).catch(() => undefined).finally(() => {
        if (autocompleteRequest.current === controller) {
          autocompleteRequest.current = undefined;
          setAutocompletePending(false);
        }
      });
    }, 500);
    return () => {
      clearTimeout(timeout);
      autocompleteGeneration.current += 1;
      autocompleteRequest.current?.abort();
      autocompleteRequest.current = undefined;
      setAutocompletePending(false);
    };
  }, [autocompleteRevision, hasContentContext]);

  useEffect(() => navigation.addListener("beforeRemove", (event) => {
    if (!hasContentContext || saveState === "saved") return;
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
    if (!localDraftFile.exists) return;
    const initialRevision = revision.current;
    void localDraftFile.text().then((value) => {
      if (revision.current !== initialRevision) return;
      const draft = JSON.parse(value) as { title?: unknown; content?: unknown };
      if (typeof draft.title === "string") {
        titleRef.current = draft.title;
        setTitle(draft.title);
      }
      if (typeof draft.content === "string") {
        contentRef.current = draft.content;
        setContent(draft.content);
      }
      if (isContentContextConfigured(getContentContext()) && typeof draft.content === "string" && draft.content.trim()) {
        dirty.current = true;
        setSaveState("dirty");
      }
    }).catch(() => setError("The local draft could not be restored."));
  }, []);

  useEffect(() => {
    if (hasContentContext || !localFoldersFile.exists) return;
    void localFoldersFile.text().then((value) => {
      const parsed = JSON.parse(value) as { folders?: unknown };
      if (!Array.isArray(parsed.folders)) return;
      const localFolders = parsed.folders.filter((folder): folder is ContentFolder => (
        typeof folder === "object" && folder !== null && typeof (folder as ContentFolder).key === "string" && typeof (folder as ContentFolder).name === "string"
      ));
      setRootFolders(localFolders);
      setFolders(localFolders);
    }).catch(() => setError("Local folders could not be restored."));
  }, [hasContentContext]);

  useEffect(() => {
    if (!hasContentContext) return;
    const changedAccount = Boolean(loadedContentContextKey.current && loadedContentContextKey.current !== contentContextKey);
    loadedContentContextKey.current = contentContextKey;
    if (changedAccount) {
      setCompletion("");
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
      setMatchSummary(undefined);
      setError(undefined);
      setSaveState("saved");
    }
    void Promise.all([listContentLocation(), listContentSearchHistory()])
      .then(([location, recent]) => {
        setFolders(location.folders);
        setRootFolders(location.folders);
        setDocuments(location.documents);
        setRootDocuments(location.documents);
        setHistory(recent);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Knowledge could not connect."));
  }, [contentContextKey, hasContentContext]);

  useEffect(() => {
    if (!hasContentContext || !dirty.current) return;
    const session = editorSession.current;
    const timeout = setTimeout(() => {
      const previous = saveInFlight.current;
      const save = (async () => {
        await previous;
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
          pendingCreateKey.current ??= createContentMutationKey();
          const created = await createContentDocument(nextTitle, nextContent, currentFolder?.key, pendingCreateKey.current);
          if (session !== editorSession.current) return;
          pendingCreateKey.current = undefined;
          activeKey = created.key;
          activeUpdatedAt = created.updatedAt;
          documentKeyRef.current = created.key;
          updatedAtRef.current = created.updatedAt;
          savedTitleRef.current = nextTitle;
          savedContentRef.current = nextContent;
        } else if (nextContent !== savedContentRef.current) {
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
  }, [content, contentContextKey, currentFolder?.key, hasContentContext, title]);

  const markDirty = () => {
    revision.current += 1;
    dirty.current = true;
    setSaveState(hasContentContext ? "dirty" : "local");
  };

  const clearCompletion = () => {
    autocompleteGeneration.current += 1;
    autocompleteRequest.current?.abort();
    autocompleteRequest.current = undefined;
    setAutocompletePending(false);
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
    pendingCreateKey.current = undefined;
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
    setActiveSheet("translate");
    setSheetError(undefined);
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
    setTranslating(true);
    setSheetError(undefined);
    try {
      await translateContentDocument(documentKey, language);
      const document = await readContentDocument(documentKey);
      if (session !== editorSession.current || documentKeyRef.current !== documentKey) return;
      applyRemoteDocument(document);
      setTargetLanguage("");
      await loadLocation(currentFolder?.key);
      closeSheet();
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The note could not be translated.");
    } finally {
      if (session === editorSession.current) setTranslating(false);
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
    setActiveSheet("versions");
    setSheetError(undefined);
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
    setRestoringVersionKey(versionKey);
    setSheetError(undefined);
    try {
      await restoreContentDocumentVersion(documentKey, versionKey);
      const document = await readContentDocument(documentKey);
      if (session !== editorSession.current || documentKeyRef.current !== documentKey) return;
      applyRemoteDocument(document);
      await loadLocation(currentFolder?.key);
      closeSheet();
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The version could not be restored.");
    } finally {
      if (session === editorSession.current) setRestoringVersionKey(undefined);
    }
  };

  const persistLocalDraft = (nextTitle: string, nextContent: string) => {
    if (hasContentContext) return;
    try {
      localDraftFile.write(JSON.stringify({ title: nextTitle, content: nextContent }));
    } catch {
      setError("The local draft could not be saved.");
    }
  };

  const resetEditor = (nextTitle = "Untitled note") => {
    clearCompletion();
    setVersions([]);
    editorSession.current += 1;
    revision.current = 0;
    dirty.current = false;
    documentKeyRef.current = undefined;
    updatedAtRef.current = undefined;
    pendingCreateKey.current = undefined;
    titleRef.current = nextTitle;
    contentRef.current = "";
    savedTitleRef.current = nextTitle;
    savedContentRef.current = "";
    setTitle(nextTitle);
    setContent("");
    setMatchSummary(undefined);
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

  const openDocument = async (key: string, summary?: string, reportError = setError) => {
    if (!hasContentContext) return false;
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      reportError("Wait for the current note to save before opening another.");
      return false;
    }
    clearCompletion();
    const generation = ++navigationGeneration.current;
    setSearching(true);
    setError(undefined);
    try {
      const document = await readContentDocument(key);
      if (generation !== navigationGeneration.current) return;
      editorSession.current += 1;
      clearCompletion();
      revision.current = 0;
      dirty.current = false;
      documentKeyRef.current = document.key;
      updatedAtRef.current = document.updatedAt;
      titleRef.current = document.name;
      contentRef.current = document.content;
      savedTitleRef.current = document.name;
      savedContentRef.current = document.content;
      setTitle(document.name);
      setContent(document.content);
      setMatchSummary(summary);
      setResults(undefined);
      setSaveState("saved");
      return true;
    } catch (cause) {
      reportError(cause instanceof Error ? cause.message : "The note could not be opened.");
      return false;
    } finally {
      if (generation === navigationGeneration.current) setSearching(false);
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
    setSearching(true);
    try {
      const location = await listContentLocation(folder.key);
      if (generation !== navigationGeneration.current) return;
      setFolders(location.folders);
      setDocuments(location.documents);
      setFolderStack((current) => [...current, folder]);
      setResults(undefined);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The folder could not be opened.");
    } finally {
      if (generation === navigationGeneration.current) setSearching(false);
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
    setSearching(true);
    try {
      const location = await listContentLocation(nextStack.at(-1)?.key);
      if (generation !== navigationGeneration.current) return;
      setFolders(location.folders);
      setDocuments(location.documents);
      setFolderStack(nextStack);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The folder could not be opened.");
    } finally {
      if (generation === navigationGeneration.current) setSearching(false);
    }
  };

  const runSearch = async (searchQuery = query) => {
    const normalized = searchQuery.trim();
    if (!normalized || !hasContentContext) return;
    clearCompletion();
    setSearching(true);
    setError(undefined);
    try {
      const response = await searchContent(normalized);
      setQuery(response.query);
      setResults(response);
      setHistory(await listContentSearchHistory());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed.");
    } finally {
      setSearching(false);
    }
  };

  const submitFolder = async () => {
    const name = folderName.trim();
    if (!name) return;
    if (!hasContentContext) {
      if (currentFolder) {
        setSheetError("Nested local folders require a connected Archive.");
        return;
      }
      const folder = { key: `local-folder-${createContentMutationKey()}`, name };
      const nextFolders = [...rootFolders, folder];
      try {
        localFoldersFile.write(JSON.stringify({ folders: nextFolders }));
      } catch {
        setSheetError("The local folder could not be saved.");
        return;
      }
      setRootFolders(nextFolders);
      setFolders((current) => [...current, folder]);
      setFolderName("");
      closeSheet();
      return;
    }
    try {
      await createContentFolder(name, currentFolder?.key);
      await loadLocation(currentFolder?.key);
      setFolderName("");
      closeSheet();
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The folder could not be created.");
    }
  };

  const submitDocument = () => {
    const name = documentName.trim();
    if (!name) return;
    if (startNewNote(name)) setDocumentName("");
  };

  const selectRootFolder = async () => {
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      setSheetError("Wait for the current note to save before changing folders.");
      return;
    }
    const generation = ++navigationGeneration.current;
    setSearching(true);
    try {
      if (hasContentContext) {
        const location = await listContentLocation();
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
      if (hasContentContext) resetEditor();
      closeSheet();
    } catch (cause) {
      if (generation === navigationGeneration.current) setSheetError(cause instanceof Error ? cause.message : "Archive could not change folders.");
    } finally {
      if (generation === navigationGeneration.current) setSearching(false);
    }
  };

  const selectFolder = async (folder: ContentFolder) => {
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      setSheetError("Wait for the current note to save before changing folders.");
      return;
    }
    const generation = ++navigationGeneration.current;
    setSearching(true);
    try {
      if (hasContentContext) {
        const location = await listContentLocation(folder.key);
        if (generation !== navigationGeneration.current) return;
        setFolders(location.folders);
        setDocuments(location.documents);
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
      if (generation === navigationGeneration.current) setSearching(false);
    }
  };

  const selectDocument = async (document: ContentDocument) => {
    if (await openDocument(document.key, undefined, setSheetError)) {
      setFolderStack([]);
      setFolders(rootFolders);
      setDocuments(rootDocuments);
      closeSheet();
    }
  };

  const uploadDocument = async () => {
    try {
      const picked = await File.pickFileAsync({ mimeTypes: ["text/plain", "text/markdown", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] });
      if (picked.canceled) return;
      const file = picked.result;
      if (file.size > MAX_MOBILE_UPLOAD_BYTES) throw new Error("Mobile uploads must be 8 MB or smaller.");
      if (!hasContentContext) {
        setSheetError("Uploads require a connected Archive.");
        return;
      }
      await uploadContentDocument({ name: file.name, type: file.type, size: file.size, base64: await file.base64() }, currentFolder?.key);
      await loadLocation(currentFolder?.key);
      closeSheet();
    } catch (cause) {
      setSheetError(cause instanceof Error ? cause.message : "The document could not be uploaded.");
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : undefined} style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
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
            <Text style={styles.meta}>CREATE NOTE</Text>
            <View style={styles.noteActions}>
              <Button accessibilityLabel="Open AI actions" contentMode="raw" disabled={!hasContentContext || !content.trim() || Boolean(results)} onPress={openEnhanceSheet} size="sm" variant="icon">
                <StarIcon size="sm" />
              </Button>
              <Button accessibilityLabel="Browse Archive" contentMode="raw" onPress={() => openSheet("library")} size="sm" variant="icon">
                <FileIcon size="sm" />
              </Button>
              <Button accessibilityLabel="Create in Archive" contentMode="raw" onPress={() => openSheet("create")} size="sm" variant="icon">
                <PlusIcon size="sm" />
              </Button>
            </View>
          </View>

          {currentFolder ? (
            <Button icon={<ChevronLeftIcon size="sm" />} onPress={() => void goBackFolder()} size="xs" variant="ghost">
              {currentFolder.name}
            </Button>
          ) : null}

          {error ? <Text accessibilityRole="alert" style={styles.notice}>{error}</Text> : null}

          {results ? (
            <View style={styles.results}>
              <View style={styles.resultsHeader}>
                <View>
                  <Text style={styles.eyebrow}>SEMANTIC RETRIEVAL</Text>
                  <Text style={styles.resultsTitle}>{results.query}</Text>
                </View>
                <Button onPress={() => setResults(undefined)} size="xs" variant="ghost">Back</Button>
              </View>
              {results.cached ? <Text style={styles.meta}>REUSED FROM SEARCH HISTORY</Text> : null}
              {results.folders.map((folder) => (
                <Button contentMode="raw" key={folder.key} onPress={() => void openFolder(folder)} size="lg" style={styles.resultRow} variant="secondary">
                  <FolderIcon size="md" variant="accent" />
                  <View style={styles.resultText}><Text numberOfLines={1} style={styles.rowTitle}>{folder.name}</Text><Text numberOfLines={2} style={styles.rowSubtitle}>{folder.description ?? "Relevant knowledge folder"}</Text></View>
                </Button>
              ))}
              {results.documents.map((document) => (
                <Button contentMode="raw" key={document.documentKey} onPress={() => void openDocument(document.documentKey, document.summary)} size="lg" style={styles.resultRow} variant="secondary">
                  <FileIcon size="md" variant="accent" />
                  <View style={styles.resultText}><Text numberOfLines={1} style={styles.rowTitle}>{document.name}</Text><Text numberOfLines={2} style={styles.rowSubtitle}>{document.summary}</Text></View>
                </Button>
              ))}
              {results.folders.length + results.documents.length === 0 ? <Text style={styles.empty}>No knowledge cleared the relevance threshold.</Text> : null}
            </View>
          ) : (
            <>
              {matchSummary ? <View style={styles.match}><Text style={styles.eyebrow}>WHY THIS MATCHES</Text><Text style={styles.rowSubtitle}>{matchSummary}</Text></View> : null}
              <TextInput
                accessibilityLabel="Note title"
                maxLength={255}
                onChangeText={(value) => { titleRef.current = value; setTitle(value); markDirty(); persistLocalDraft(value, contentRef.current); }}
                style={styles.titleInput}
                value={title}
              />
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
              {autocompletePending || completion ? (
                <View style={styles.completionRow}>
                  <Text accessibilityLabel={completion ? "Suggested continuation" : undefined} style={styles.completionText}>{completion || "Thinking ahead..."}</Text>
                  {completion ? (
                    <Button accessibilityLabel="Accept suggested continuation" contentMode="raw" onPress={acceptCompletion} size="sm" variant="icon">
                      <CheckIcon size="sm" />
                    </Button>
                  ) : null}
                </View>
              ) : null}
              {!content && (folders.length > 0 || documents.length > 0) ? (
                <View style={styles.locationPreview}>
                  <Text style={styles.eyebrow}>IN THIS LOCATION</Text>
                  {folders.slice(0, 3).map((folder) => <Button key={folder.key} onPress={() => void (hasContentContext ? openFolder(folder) : selectFolder(folder))} size="sm" variant="ghost" icon={<FolderIcon size="sm" />}>{folder.name}</Button>)}
                  {documents.slice(0, 3).map((document) => <Button key={document.key} onPress={() => void openDocument(document.key)} size="sm" variant="ghost" icon={<FileIcon size="sm" />}>{document.name}</Button>)}
                </View>
              ) : null}
            </>
          )}
        </View>

        {!editorFocused ? (
          <View style={styles.searchArea}>
            {history.length > 0 && !results ? (
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.history}>
                {history.slice(0, 4).map((item) => <Button key={`${item.normalizedQuery}-${item.searchedAt}`} onPress={() => void runSearch(item.query)} size="xs" variant="ghost" icon={<SearchIcon size="sm" />}>{item.query}</Button>)}
              </ScrollView>
            ) : null}
            <View style={styles.searchBar}>
              <SearchIcon size="sm" variant="muted" />
              <TextInput
                accessibilityLabel="Search Archive by meaning"
                onChangeText={setQuery}
                onSubmitEditing={() => void runSearch()}
                placeholder="Search by what you remember..."
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
        description={activeSheet === "create" ? "Add something to your current Archive folder." : activeSheet === "enhance" ? "Correct spelling and improve wording while preserving meaning." : activeSheet === "translate" ? "Translate the full note into any language." : activeSheet === "versions" ? "Restore an earlier snapshot without losing the current one." : undefined}
        mutation={activeSheet === "document" || activeSheet === "documents" || activeSheet === "folder" || activeSheet === "folders" || activeSheet === "translate"}
        onOpenChange={(open) => { if (!open) closeSheet(); }}
        open={sheetOpen}
        tall={activeSheet === "library" || activeSheet === "documents" || activeSheet === "folders" || activeSheet === "versions"}
        title={activeSheet === "enhance" ? "AI actions" : activeSheet === "translate" ? "Translate note" : activeSheet === "versions" ? "Version history" : activeSheet === "document" ? "Create document" : activeSheet === "folder" ? "Create folder" : activeSheet === "documents" ? "Documents" : activeSheet === "folders" ? "Folders" : activeSheet === "library" ? "Browse Archive" : "Create in Archive"}
      >
        {sheetError ? <Text accessibilityRole="alert" style={styles.notice}>{sheetError}</Text> : null}
        {activeSheet === "create" ? (
          <>
            <BottomSheetItem icon={<FolderIcon />} onPress={() => { setSheetError(undefined); setActiveSheet("folder"); }}>Create folder</BottomSheetItem>
            <BottomSheetItem icon={<FileIcon />} onPress={() => { setSheetError(undefined); setActiveSheet("document"); }}>Create document</BottomSheetItem>
            <BottomSheetItem icon={<UploadIcon />} onPress={() => void uploadDocument()}>Upload documents</BottomSheetItem>
          </>
        ) : null}
        {activeSheet === "enhance" ? (
          <View style={styles.enhancePanel}>
            <View style={styles.enhanceIdentity}>
              <StarIcon size="lg" variant="accent" />
              <View style={styles.enhanceCopy}>
                <Text style={styles.rowTitle}>{enhanceRange ? "Selected text" : "Entire note"}</Text>
                <Text style={styles.rowSubtitle}>{enhanceRange ? "Only the highlighted passage will be replaced." : "No text is selected, so the full note will be replaced."}</Text>
              </View>
            </View>
            <Button disabled={enhancing} icon={<StarIcon size="sm" />} loading={enhancing} onPress={() => void runEnhancement()} size="lg" variant="primary">
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
              <Button contentMode="raw" disabled={Boolean(restoringVersionKey)} key={version.key} loading={restoringVersionKey === version.key} onPress={() => void restoreVersion(version.key)} size="lg" style={styles.resultRow} variant="secondary">
                <ClockIcon size="md" variant="accent" />
                <View style={styles.resultText}>
                  <Text style={styles.rowTitle}>{version.label ?? `Version ${version.version}`}</Text>
                  <Text style={styles.rowSubtitle}>{new Date(version.createdAt).toLocaleString()}</Text>
                </View>
              </Button>
            ))}
          </View>
        ) : null}
        {activeSheet === "folder" ? (
          <View style={styles.namingForm}>
            <TextInput accessibilityLabel="New folder name" autoFocus maxLength={255} onChangeText={setFolderName} onSubmitEditing={() => void submitFolder()} placeholder="Folder name" returnKeyType="done" value={folderName} />
            <Button disabled={!folderName.trim()} onPress={() => void submitFolder()} size="md" variant="primary">Create folder</Button>
          </View>
        ) : null}
        {activeSheet === "document" ? (
          <View style={styles.namingForm}>
            <TextInput accessibilityLabel="New document name" autoFocus maxLength={255} onChangeText={setDocumentName} onSubmitEditing={submitDocument} placeholder="Document name" returnKeyType="done" value={documentName} />
            <Button disabled={!documentName.trim()} onPress={submitDocument} size="md" variant="primary">Create document</Button>
          </View>
        ) : null}
        {activeSheet === "library" ? (
          <View style={styles.libraryChoices}>
            <Button icon={<FileIcon size="lg" />} onPress={() => { setLibraryQuery(""); setActiveSheet("documents"); }} size="lg" style={styles.libraryChoice} variant="secondary">Documents</Button>
            <Button icon={<FolderIcon size="lg" />} onPress={() => { setLibraryQuery(""); setActiveSheet("folders"); }} size="lg" style={styles.libraryChoice} variant="secondary">Folders</Button>
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
                <Button icon={<FolderIcon size="md" />} key={folder.key} onPress={() => void selectFolder(folder)} size="lg" style={styles.folderTile} variant="secondary">
                  {folder.name}
                </Button>
              ))}
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
                <Button icon={<FileIcon size="md" />} key={document.key} onPress={() => void selectDocument(document)} size="lg" style={styles.folderTile} variant="secondary">
                  {document.name}
                </Button>
              ))}
            </ScrollView>
          </>
        ) : null}
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.page },
  header: { minHeight: 64, paddingBottom: 8, paddingHorizontal: spacing.lg, flexDirection: "row", alignItems: "center", borderBottomColor: palette.hairline, borderBottomWidth: 1 },
  identity: { flexDirection: "row", alignItems: "center", gap: 10 },
  eyebrow: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 9, letterSpacing: tracking.micro },
  headerTitle: { color: palette.silver100, fontFamily: fonts.medium, fontSize: 15, letterSpacing: tracking.label },
  scrollView: { flex: 1 },
  scroll: { flexGrow: 1, paddingHorizontal: spacing.md, paddingTop: spacing.md },
  noteSheet: { flexGrow: 1, minHeight: 360, padding: spacing.md, borderRadius: radii.xl, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised },
  noteSheetFocused: { flex: 1, minHeight: 0 },
  metaRow: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  noteActions: { flexDirection: "row", gap: 8 },
  meta: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1.5 },
  notice: { marginBottom: 12, padding: 10, borderRadius: radii.sm, color: palette.silver300, backgroundColor: "rgba(120, 76, 40, 0.24)", fontFamily: fonts.regular, fontSize: 12 },
  titleInput: { minHeight: 58, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", color: palette.silver50, fontFamily: fonts.medium, fontSize: 28 },
  editor: { minHeight: 270, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26 },
  editorFocused: { flex: 1, minHeight: 80 },
  completionRow: { minHeight: 42, marginTop: -8, paddingLeft: 12, flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 10, borderLeftColor: palette.silver500, borderLeftWidth: 1 },
  completionText: { flex: 1, color: palette.silver500, fontFamily: fonts.regular, fontSize: 16, fontStyle: "italic", lineHeight: 24 },
  enhancePanel: { gap: 18 },
  enhanceIdentity: { padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panel },
  enhanceCopy: { flex: 1, gap: 4 },
  versionPanel: { gap: 10 },
  currentVersion: { padding: 14, flexDirection: "row", alignItems: "center", gap: 12, borderRadius: radii.md, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panel },
  locationPreview: { gap: 4, marginTop: 10 },
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
  libraryChoices: { gap: 10 },
  libraryChoice: { minHeight: 72, width: "100%", gap: 10 },
  folderSearch: { minHeight: 48, paddingHorizontal: 14, flexDirection: "row", alignItems: "center", gap: 8, borderRadius: 999, borderColor: palette.hairline, borderWidth: 1, backgroundColor: palette.panelRaised },
  folderSearchInput: { flex: 1, minHeight: 40, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent" },
  folderGrid: { paddingTop: 14, flexDirection: "row", flexWrap: "wrap", gap: 10 },
  folderList: { flex: 1 },
  folderTile: { minHeight: 86, flexBasis: "48%", flexDirection: "column", gap: 8, paddingHorizontal: 10 },
});
