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
  ChevronLeftIcon,
  FileIcon,
  FolderIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  UploadIcon,
} from "@vorinthex/shared/ui/icons-mobile";

import {
  createContentDocument,
  createContentFolder,
  createContentMutationKey,
  hasContentContext,
  listContentLocation,
  listContentSearchHistory,
  readContentDocument,
  renameContentDocument,
  saveContentDocument,
  searchContent,
  uploadContentDocument,
  type ContentDocument,
  type ContentFolder,
  type ContentSearchHistoryItem,
  type ContentSearchResponse,
} from "@/lib/content-client";
import { fonts, palette, radii, spacing, tracking } from "@/theme/tokens";

type SaveState = "local" | "dirty" | "saving" | "saved" | "error";

const localDraftFile = new File(Paths.document, "knowledge-draft.json");
const MAX_MOBILE_UPLOAD_BYTES = 8 * 1024 * 1024;

export function KnowledgeWorkspace() {
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const [menuOpen, setMenuOpen] = useState(false);
  const [title, setTitle] = useState("Untitled note");
  const [content, setContent] = useState("");
  const [saveState, setSaveState] = useState<SaveState>(hasContentContext ? "saved" : "local");
  const [folders, setFolders] = useState<ContentFolder[]>([]);
  const [documents, setDocuments] = useState<ContentDocument[]>([]);
  const [folderStack, setFolderStack] = useState<ContentFolder[]>([]);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [results, setResults] = useState<ContentSearchResponse>();
  const [history, setHistory] = useState<ContentSearchHistoryItem[]>([]);
  const [matchSummary, setMatchSummary] = useState<string>();
  const [folderName, setFolderName] = useState("");
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
  const currentFolder = folderStack.at(-1);

  useEffect(() => navigation.addListener("beforeRemove", (event) => {
    if (!hasContentContext || saveState === "saved") return;
    event.preventDefault();
    setError("Wait for the current note to save before leaving.");
  }), [navigation, saveState]);

  const loadLocation = async (folderKey?: string) => {
    const location = await listContentLocation(folderKey);
    setFolders(location.folders);
    setDocuments(location.documents);
  };

  useEffect(() => {
    if (hasContentContext || !localDraftFile.exists) return;
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
    }).catch(() => setError("The local draft could not be restored."));
  }, []);

  useEffect(() => {
    if (!hasContentContext) return;
    void Promise.all([listContentLocation(), listContentSearchHistory()])
      .then(([location, recent]) => {
        setFolders(location.folders);
        setDocuments(location.documents);
        setHistory(recent);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Knowledge could not connect."));
  }, []);

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
  }, [content, currentFolder?.key, title]);

  const markDirty = () => {
    revision.current += 1;
    dirty.current = true;
    setSaveState(hasContentContext ? "dirty" : "local");
  };

  const persistLocalDraft = (nextTitle: string, nextContent: string) => {
    if (hasContentContext) return;
    try {
      localDraftFile.write(JSON.stringify({ title: nextTitle, content: nextContent }));
    } catch {
      setError("The local draft could not be saved.");
    }
  };

  const startNewNote = () => {
    if (hasContentContext && (dirty.current || saveInFlight.current)) {
      setError("Wait for the current note to save before creating another.");
      return;
    }
    editorSession.current += 1;
    revision.current = 0;
    dirty.current = false;
    documentKeyRef.current = undefined;
    updatedAtRef.current = undefined;
    pendingCreateKey.current = undefined;
    titleRef.current = "Untitled note";
    contentRef.current = "";
    savedTitleRef.current = "Untitled note";
    savedContentRef.current = "";
    setTitle("Untitled note");
    setContent("");
    setMatchSummary(undefined);
    setResults(undefined);
    setSaveState(hasContentContext ? "saved" : "local");
    persistLocalDraft("Untitled note", "");
    setMenuOpen(false);
  };

  const openDocument = async (key: string, summary?: string) => {
    if (!hasContentContext) return;
    if (dirty.current || saveInFlight.current) {
      setError("Wait for the current note to save before opening another.");
      return;
    }
    const generation = ++navigationGeneration.current;
    setSearching(true);
    setError(undefined);
    try {
      const document = await readContentDocument(key);
      if (generation !== navigationGeneration.current) return;
      editorSession.current += 1;
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
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The note could not be opened.");
    } finally {
      if (generation === navigationGeneration.current) setSearching(false);
    }
  };

  const openFolder = async (folder: ContentFolder) => {
    if (!hasContentContext) return;
    if (dirty.current || saveInFlight.current) {
      setError("Wait for the current note to save before opening a folder.");
      return;
    }
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
    if (dirty.current || saveInFlight.current) {
      setError("Wait for the current note to save before navigating.");
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
    if (!folderName.trim() || !hasContentContext) return;
    try {
      await createContentFolder(folderName.trim(), currentFolder?.key);
      await loadLocation(currentFolder?.key);
      setFolderName("");
      setMenuOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The folder could not be created.");
    }
  };

  const uploadDocument = async () => {
    if (!hasContentContext) return;
    try {
      const picked = await File.pickFileAsync({ mimeTypes: ["text/plain", "text/markdown", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"] });
      if (picked.canceled) return;
      const file = picked.result;
      if (file.size > MAX_MOBILE_UPLOAD_BYTES) throw new Error("Mobile uploads must be 8 MB or smaller.");
      await uploadContentDocument({ name: file.name, type: file.type, size: file.size, base64: await file.base64() }, currentFolder?.key);
      await loadLocation(currentFolder?.key);
      setMenuOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The document could not be uploaded.");
    }
  };

  return (
    <KeyboardAvoidingView behavior={Platform.OS === "ios" ? "padding" : "height"} style={styles.root}>
      <View style={[styles.header, { paddingTop: insets.top + 6 }]}>
        <View style={styles.identity}>
          <ArchiveIcon size="md" variant="accent" />
          <Text style={styles.headerTitle}>ARCHIVE</Text>
        </View>
      </View>

      <ScrollView
        automaticallyAdjustKeyboardInsets
        contentContainerStyle={[styles.scroll, { paddingBottom: insets.bottom + spacing.sm }]}
        keyboardDismissMode={Platform.OS === "ios" ? "interactive" : "on-drag"}
        keyboardShouldPersistTaps="handled"
        style={styles.scrollView}
      >
        <View style={styles.noteSheet}>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>CREATE NOTE</Text>
            <Button accessibilityLabel="Create in Archive" contentMode="raw" onPress={() => setMenuOpen(true)} size="sm" variant="icon">
              <PlusIcon size="sm" />
            </Button>
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
                onChangeText={(value) => {
                  if (documentKeyRef.current && value.length === 0) {
                    setError("Saved notes must contain at least one character.");
                    return;
                  }
                  contentRef.current = value;
                  setContent(value);
                  markDirty();
                  persistLocalDraft(titleRef.current, value);
                }}
                placeholder="Start writing from here..."
                style={styles.editor}
                textAlignVertical="top"
                value={content}
              />
              {!content && (folders.length > 0 || documents.length > 0) ? (
                <View style={styles.locationPreview}>
                  <Text style={styles.eyebrow}>IN THIS LOCATION</Text>
                  {folders.slice(0, 3).map((folder) => <Button key={folder.key} onPress={() => void openFolder(folder)} size="sm" variant="ghost" icon={<FolderIcon size="sm" />}>{folder.name}</Button>)}
                  {documents.slice(0, 3).map((document) => <Button key={document.key} onPress={() => void openDocument(document.key)} size="sm" variant="ghost" icon={<FileIcon size="sm" />}>{document.name}</Button>)}
                </View>
              ) : null}
            </>
          )}
        </View>

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
              editable={hasContentContext}
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
      </ScrollView>

      <BottomSheet description="Add something to your current knowledge location." onOpenChange={setMenuOpen} open={menuOpen} title="Create in Archive">
        <BottomSheetItem icon={<ArchiveIcon />} onPress={startNewNote}>New note</BottomSheetItem>
        <BottomSheetItem disabled={!hasContentContext} icon={<UploadIcon />} onPress={() => void uploadDocument()}>Upload document</BottomSheetItem>
        <View style={styles.folderForm}>
          <TextInput accessibilityLabel="New folder name" editable={hasContentContext} onChangeText={setFolderName} placeholder="Folder name" value={folderName} />
          <Button disabled={!folderName.trim() || !hasContentContext} onPress={() => void submitFolder()} size="md" variant="secondary" icon={<FolderIcon />}>Create folder</Button>
        </View>
        {!hasContentContext ? <Text style={styles.sheetHint}>Sign in and select a knowledge scope to sync notes, folders, and search.</Text> : null}
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
  metaRow: { minHeight: 34, flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  meta: { color: palette.silver500, fontFamily: fonts.medium, fontSize: 9, letterSpacing: 1.5 },
  notice: { marginBottom: 12, padding: 10, borderRadius: radii.sm, color: palette.silver300, backgroundColor: "rgba(120, 76, 40, 0.24)", fontFamily: fonts.regular, fontSize: 12 },
  titleInput: { minHeight: 58, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", color: palette.silver50, fontFamily: fonts.medium, fontSize: 28 },
  editor: { minHeight: 270, paddingHorizontal: 0, borderWidth: 0, backgroundColor: "transparent", color: palette.silver100, fontFamily: fonts.regular, fontSize: 16, lineHeight: 26 },
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
  folderForm: { gap: 8, marginTop: 6 },
  sheetHint: { padding: 8, color: palette.silver500, fontFamily: fonts.regular, fontSize: 12, lineHeight: 18 },
});
