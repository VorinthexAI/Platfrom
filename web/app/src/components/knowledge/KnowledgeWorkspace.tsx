"use client";

import Image from "next/image";
import { useEffect, useRef, useState, type CSSProperties, type FormEvent } from "react";
import { BottomSheet, BottomSheetItem } from "@vorinthex/shared/ui/bottom-sheet";
import { Button, Card, FileUpload, TextInput, Textarea } from "@vorinthex/shared/ui/components";
import {
  ArchiveIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  FileIcon,
  FolderIcon,
  PlusIcon,
  SearchIcon,
  SendIcon,
  UploadIcon,
} from "@vorinthex/shared/ui/icons";
import {
  createDocument,
  createFolder,
  hasContentContext,
  listLocation,
  listSearchHistory,
  readDocument,
  renameDocument,
  saveDocument,
  searchContent,
  uploadDocument,
  type ContentDocument,
  type ContentFolder,
  type SearchHistoryItem,
  type SearchResponse,
} from "@/lib/knowledge-api";
import styles from "./KnowledgeWorkspace.module.css";

type Capability = { id: string; name: string; icon: string; description: string };
type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";
type ResultView = "overview" | "folders" | "documents";

const saveLabels: Record<SaveState, string> = {
  idle: "Local draft",
  dirty: "Unsaved",
  saving: "Saving...",
  saved: "Saved",
  error: "Save failed",
};

export function KnowledgeWorkspace({ capabilities }: { capabilities: Capability[] }) {
  const [capabilityIndex, setCapabilityIndex] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchFocused, setSearchFocused] = useState(false);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchResponse | null>(null);
  const [resultView, setResultView] = useState<ResultView>("overview");
  const [history, setHistory] = useState<SearchHistoryItem[]>([]);
  const [folders, setFolders] = useState<ContentFolder[]>([]);
  const [documents, setDocuments] = useState<ContentDocument[]>([]);
  const [folderStack, setFolderStack] = useState<ContentFolder[]>([]);
  const [documentKey, setDocumentKey] = useState<string>();
  const [title, setTitle] = useState("Untitled note");
  const [content, setContent] = useState("");
  const [matchSummary, setMatchSummary] = useState<string>();
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [error, setError] = useState<string>();
  const [newFolderName, setNewFolderName] = useState("");
  const [viewport, setViewport] = useState<{ height: number; top: number }>();
  const dirtyRef = useRef(false);
  const savedTitleRef = useRef(title);
  const savedContentRef = useRef(content);
  const documentKeyRef = useRef<string | undefined>(undefined);
  const documentUpdatedAtRef = useRef<string | undefined>(undefined);
  const editorSessionRef = useRef(0);
  const saveInFlightRef = useRef<Promise<void> | null>(null);
  const saveGeneration = useRef(0);
  const navigationGenerationRef = useRef(0);
  const activeCapability = capabilities[capabilityIndex] ?? capabilities[0]!;
  const currentFolder = folderStack.at(-1);
  const isKnowledgeApp = activeCapability.id === "archive";

  useEffect(() => {
    const viewport = window.visualViewport;
    const update = () => setViewport({ height: viewport?.height ?? window.innerHeight, top: viewport?.offsetTop ?? 0 });
    update();
    viewport?.addEventListener("resize", update);
    viewport?.addEventListener("scroll", update);
    window.addEventListener("resize", update);
    return () => {
      viewport?.removeEventListener("resize", update);
      viewport?.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, []);

  useEffect(() => {
    if (!hasContentContext) return;
    void Promise.all([listLocation(), listSearchHistory()])
      .then(([location, recentHistory]) => {
        setFolders(location.folders);
        setDocuments(location.documents);
        setHistory(recentHistory);
      })
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Archive could not connect."));
  }, []);

  useEffect(() => {
    if (!dirtyRef.current || !hasContentContext) return;
    const generation = ++saveGeneration.current;
    const session = editorSessionRef.current;
    const timeout = window.setTimeout(() => {
      const previous = saveInFlightRef.current;
      const save = (async () => {
        await previous;
        if (session !== editorSessionRef.current || generation !== saveGeneration.current) return;
        setSaveState("saving");
        let activeKey = documentKeyRef.current;
        if (!activeKey) {
          if (!content.trim()) {
            dirtyRef.current = false;
            setSaveState("idle");
            return;
          }
          const created = await createDocument(title.trim() || "Untitled note", content, currentFolder?.key);
          if (session !== editorSessionRef.current) return;
          activeKey = created.key;
          documentKeyRef.current = created.key;
          documentUpdatedAtRef.current = created.updatedAt;
          savedTitleRef.current = created.name;
          savedContentRef.current = content;
          setDocumentKey(created.key);
        } else {
          if (!content.trim() && content !== savedContentRef.current) {
            throw new Error("An empty note remains local until it contains text.");
          }
          if (content !== savedContentRef.current) {
            const updated = await saveDocument(activeKey, content, documentUpdatedAtRef.current!);
            if (session !== editorSessionRef.current) return;
            documentUpdatedAtRef.current = updated.updatedAt;
            savedContentRef.current = content;
          }
          if (title.trim() && title.trim() !== savedTitleRef.current) {
            const renamed = await renameDocument(activeKey, title.trim());
            if (session !== editorSessionRef.current) return;
            documentUpdatedAtRef.current = renamed.updatedAt;
            savedTitleRef.current = renamed.name;
          }
        }
        if (session !== editorSessionRef.current || generation !== saveGeneration.current) return;
        dirtyRef.current = false;
        setSaveState("saved");
      })().catch((cause: unknown) => {
        if (session !== editorSessionRef.current || generation !== saveGeneration.current) return;
        setSaveState("error");
        setError(cause instanceof Error ? cause.message : "Documentet kunde inte sparas.");
      });
      saveInFlightRef.current = save;
      void save.finally(() => {
        if (saveInFlightRef.current === save) saveInFlightRef.current = null;
      });
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [content, currentFolder?.key, documentKey, title]);

  const markDirty = () => {
    dirtyRef.current = true;
    setSaveState(hasContentContext ? "dirty" : "idle");
  };

  const startNewNote = (discard = false) => {
    if (!discard && (dirtyRef.current || saveState === "saving")) {
      setError("Wait for the current note to save before leaving it.");
      return;
    }
    saveGeneration.current += 1;
    editorSessionRef.current += 1;
    dirtyRef.current = false;
    documentKeyRef.current = undefined;
    documentUpdatedAtRef.current = undefined;
    savedContentRef.current = "";
    setDocumentKey(undefined);
    setTitle("Untitled note");
    setContent("");
    setMatchSummary(undefined);
    setSearchResults(null);
    setSaveState("idle");
    setMenuOpen(false);
  };

  const openDocument = async (key: string, summary?: string) => {
    if (dirtyRef.current || saveState === "saving") {
      setError("Wait for the current note to save before opening another document.");
      return;
    }
    const generation = ++navigationGenerationRef.current;
    setSearching(true);
    setError(undefined);
    try {
      const document = await readDocument(key);
      if (generation !== navigationGenerationRef.current) return;
      saveGeneration.current += 1;
      editorSessionRef.current += 1;
      dirtyRef.current = false;
      documentKeyRef.current = document.key;
      documentUpdatedAtRef.current = document.updatedAt;
      savedContentRef.current = document.content;
      setDocumentKey(document.key);
      setTitle(document.name);
      savedTitleRef.current = document.name;
      setContent(document.content);
      setMatchSummary(summary);
      setSearchResults(null);
      setSaveState("saved");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Documentet kunde inte oppnas.");
    } finally {
      if (generation === navigationGenerationRef.current) setSearching(false);
    }
  };

  const openFolder = async (folder: ContentFolder) => {
    if (dirtyRef.current || saveState === "saving") {
      setError("Wait for the current note to save before opening a folder.");
      return;
    }
    const generation = ++navigationGenerationRef.current;
    setSearching(true);
    setError(undefined);
    try {
      const location = await listLocation(folder.key);
      if (generation !== navigationGenerationRef.current) return;
      setFolderStack((current) => [...current, folder]);
      setFolders(location.folders);
      setDocuments(location.documents);
      setSearchResults(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mappen kunde inte oppnas.");
    } finally {
      if (generation === navigationGenerationRef.current) setSearching(false);
    }
  };

  const goBackFolder = async () => {
    if (dirtyRef.current || saveState === "saving") {
      setError("Wait for the current note to save before navigating.");
      return;
    }
    const generation = ++navigationGenerationRef.current;
    const nextStack = folderStack.slice(0, -1);
    setSearching(true);
    try {
      const location = await listLocation(nextStack.at(-1)?.key);
      if (generation !== navigationGenerationRef.current) return;
      setFolderStack(nextStack);
      setFolders(location.folders);
      setDocuments(location.documents);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Archive could not navigate back.");
    } finally {
      if (generation === navigationGenerationRef.current) setSearching(false);
    }
  };

  const runSearch = async (searchQuery: string) => {
    const normalized = searchQuery.trim();
    if (!normalized) return;
    if (!hasContentContext) {
      setError("Search is ready, but authentication and content scope are not configured yet.");
      return;
    }
    const generation = ++navigationGenerationRef.current;
    setSearching(true);
    setError(undefined);
    try {
      const result = await searchContent(normalized);
      if (generation !== navigationGenerationRef.current) return;
      setQuery(result.query);
      setSearchResults(result);
      setResultView("overview");
      setHistory(await listSearchHistory());
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed.");
    } finally {
      if (generation === navigationGenerationRef.current) setSearching(false);
    }
  };

  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    void runSearch(query);
  };

  const submitFolder = async (event: FormEvent) => {
    event.preventDefault();
    if (!newFolderName.trim() || !hasContentContext) return;
    try {
      await createFolder(newFolderName.trim(), currentFolder?.key);
      const location = await listLocation(currentFolder?.key);
      setFolders(location.folders);
      setDocuments(location.documents);
      setNewFolderName("");
      setMenuOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Mappen kunde inte skapas.");
    }
  };

  const handleUpload = async (file?: File) => {
    if (!file || !hasContentContext) return;
    try {
      await uploadDocument(file, currentFolder?.key);
      const location = await listLocation(currentFolder?.key);
      setDocuments(location.documents);
      setFolders(location.folders);
      setMenuOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Dokumentet kunde inte laddas upp.");
    }
  };

  const cycleCapability = (direction: -1 | 1) => {
    if (dirtyRef.current || saveState === "saving") {
      setError("Wait for the current note to save before switching apps.");
      return;
    }
    setCapabilityIndex((current) => (current + direction + capabilities.length) % capabilities.length);
  };

  const changeContent = (value: string) => {
    if (documentKeyRef.current && value.length === 0) {
      setError("Saved documents must contain at least one character.");
      return;
    }
    setContent(value);
    markDirty();
  };

  const workspaceStyle = viewport ? ({ "--workspace-height": `${viewport.height}px`, "--workspace-top": `${viewport.top}px` } as CSSProperties) : undefined;

  return (
    <main className={styles.workspace} data-search-focused={searchFocused || undefined} style={workspaceStyle}>
      <header className={styles.header}>
        <Button aria-label="Previous app" onClick={() => cycleCapability(-1)} size="sm" variant="icon" icon={<ChevronLeftIcon />}>
          Previous app
        </Button>
        <div className={styles.appIdentity} aria-live="polite">
          <Image alt="" className={styles.appLogo} height={38} src={activeCapability.icon} width={38} />
          <div>
            <span className={styles.eyebrow}>Core application</span>
            <h1>{activeCapability.name}</h1>
          </div>
        </div>
        <span className="sr-only">Available applications: {capabilities.map(({ name }) => name).join(", ")}</span>
        <Button aria-label="Next app" onClick={() => cycleCapability(1)} size="sm" variant="icon" icon={<ChevronRightIcon />}>
          Next app
        </Button>
        <Button className={styles.addButton} onClick={() => setMenuOpen(true)} size="sm" variant="icon" icon={<PlusIcon />}>
          Create or upload
        </Button>
      </header>

      <section className={styles.stage}>
        <div className={styles.noteSheet}>
          {isKnowledgeApp ? (
            <>
              <div className={styles.sheetMeta}>
                <div className={styles.location}>
                  {currentFolder ? (
                    <Button onClick={() => void goBackFolder()} size="xs" variant="ghost" icon={<ChevronLeftIcon size="sm" />}>
                      {currentFolder.name}
                    </Button>
                  ) : (
                    <span>My knowledge</span>
                  )}
                </div>
                <span className={styles.saveState} data-state={saveState}>{saveLabels[saveState]}</span>
              </div>

              {error ? <div className={styles.notice} role="status">{error}</div> : null}

              {searchResults ? (
                <SearchResults
                  onClose={() => setSearchResults(null)}
                  onOpenDocument={openDocument}
                  onOpenFolder={openFolder}
                  onViewChange={setResultView}
                  results={searchResults}
                  view={resultView}
                />
              ) : (
                <>
                  {matchSummary ? (
                    <Card className={styles.matchSummary}>
                      <span className={styles.eyebrow}>Why this matches</span>
                      <p>{matchSummary}</p>
                    </Card>
                  ) : null}
                  <TextInput
                    aria-label="Document title"
                    className={styles.titleInput}
                    maxLength={255}
                    onChange={(event) => { setTitle(event.target.value); markDirty(); }}
                    value={title}
                  />
                  <Textarea
                    aria-label="Document content"
                    className={styles.editor}
                    onChange={(event) => changeContent(event.target.value)}
                    placeholder="Start writing from here..."
                    value={content}
                  />
                  {!content && (folders.length > 0 || documents.length > 0) ? (
                    <div className={styles.locationPreview}>
                      <span className={styles.eyebrow}>In this location</span>
                      <div className={styles.previewActions}>
                        {folders.slice(0, 3).map((folder) => (
                          <Button key={folder.key} onClick={() => void openFolder(folder)} size="xs" variant="ghost" icon={<FolderIcon size="sm" />}>
                            {folder.name}
                          </Button>
                        ))}
                        {documents.slice(0, 3).map((document) => (
                          <Button key={document.key} onClick={() => void openDocument(document.key)} size="xs" variant="ghost" icon={<FileIcon size="sm" />}>
                            {document.name}
                          </Button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </>
              )}
            </>
          ) : (
            <div className={styles.comingSoon}>
              <Image alt="" height={72} src={activeCapability.icon} width={72} />
              <span className={styles.eyebrow}>{activeCapability.name}</span>
              <h2>{activeCapability.description}</h2>
              <p>This workspace is next in the Core sequence. Use the arrows to return to Archive.</p>
            </div>
          )}
        </div>

        {isKnowledgeApp ? (
          <div className={styles.searchDock}>
            {!searchResults && history.length > 0 && !searchFocused ? (
              <div className={styles.history} aria-label="Recent searches">
                {history.slice(0, 4).map((item) => (
                  <Button key={`${item.normalizedQuery}-${item.searchedAt}`} onClick={() => void runSearch(item.query)} size="xs" variant="ghost" icon={<SearchIcon size="sm" />}>
                    {item.query}
                  </Button>
                ))}
              </div>
            ) : null}
            <form className={styles.searchForm} onSubmit={submitSearch}>
              <SearchIcon className={styles.searchIcon} size="md" />
              <TextInput
                aria-label="Search Archive by meaning"
                className={styles.searchInput}
                onBlur={() => setSearchFocused(false)}
                onChange={(event) => setQuery(event.target.value)}
                onFocus={() => setSearchFocused(true)}
                placeholder="Search by what you remember..."
                value={query}
              />
              <Button disabled={!query.trim()} loading={searching} size="sm" type="submit" variant="primary" icon={<SendIcon />}>
                Search
              </Button>
            </form>
          </div>
        ) : null}
      </section>

      <BottomSheet
        description="Add something to your current knowledge location."
        onOpenChange={setMenuOpen}
        open={menuOpen}
        title="Create in Archive"
      >
        <BottomSheetItem icon={<ArchiveIcon />} onClick={() => startNewNote(true)}>New note</BottomSheetItem>
        <form className={styles.folderForm} onSubmit={submitFolder}>
          <TextInput
            aria-label="New folder name"
            onChange={(event) => setNewFolderName(event.target.value)}
            placeholder="Folder name"
            value={newFolderName}
          />
          <Button disabled={!hasContentContext || !newFolderName.trim()} size="md" type="submit" variant="secondary" icon={<FolderIcon />}>
            Create folder
          </Button>
        </form>
        <label className={styles.uploadField}>
          <span><UploadIcon /> Upload TXT, Markdown, Word or PDF</span>
          <FileUpload
            accept=".txt,.md,.doc,.docx,.pdf"
            disabled={!hasContentContext}
            onChange={(event) => void handleUpload(event.target.files?.[0])}
          />
        </label>
        {!hasContentContext ? <p className={styles.sheetHint}>Authentication and content context are required for server actions.</p> : null}
      </BottomSheet>
    </main>
  );
}

function SearchResults({
  onClose,
  onOpenDocument,
  onOpenFolder,
  onViewChange,
  results,
  view,
}: {
  onClose: () => void;
  onOpenDocument: (key: string, summary?: string) => Promise<void>;
  onOpenFolder: (folder: ContentFolder) => Promise<void>;
  onViewChange: (view: ResultView) => void;
  results: SearchResponse;
  view: ResultView;
}) {
  const showFolders = view !== "documents";
  const showDocuments = view !== "folders";
  return (
    <div className={styles.results}>
      <div className={styles.resultsHeader}>
        <div>
          <span className={styles.eyebrow}>Semantic retrieval</span>
          <h2>{results.query}</h2>
        </div>
        <Button onClick={view === "overview" ? onClose : () => onViewChange("overview")} size="xs" variant="ghost">
          {view === "overview" ? "Back to note" : "Back to overview"}
        </Button>
      </div>
      {results.cached ? <span className={styles.cacheLabel}>Reused from your search history</span> : null}
      {showFolders ? (
        <Card className={styles.resultGroup}>
          <div className={styles.groupHeader}>
            <span><FolderIcon /> Matching folders</span>
            <Button onClick={() => onViewChange("folders")} size="xs" variant="ghost">View all {results.folders.length}</Button>
          </div>
          <div className={styles.resultGrid}>
            {results.folders.map((folder) => (
              <Button className={styles.resultItem} key={folder.key} onClick={() => void onOpenFolder(folder)} size="lg" variant="ghost" icon={<FolderIcon />}>
                <span><strong>{folder.name}</strong><small>{folder.description ?? "A relevant knowledge folder"}</small></span>
              </Button>
            ))}
            {results.folders.length === 0 ? <p className={styles.emptyResults}>No folders cleared the relevance threshold.</p> : null}
          </div>
        </Card>
      ) : null}
      {showDocuments ? (
        <Card className={styles.resultGroup}>
          <div className={styles.groupHeader}>
            <span><FileIcon /> Matching documents</span>
            <Button onClick={() => onViewChange("documents")} size="xs" variant="ghost">View all {results.documents.length}</Button>
          </div>
          <div className={styles.resultGrid}>
            {results.documents.map((document) => (
              <Button className={styles.resultItem} key={document.documentKey} onClick={() => void onOpenDocument(document.documentKey, document.summary)} size="lg" variant="ghost" icon={<FileIcon />}>
                <span><strong>{document.name}</strong><small>{document.summary}</small></span>
              </Button>
            ))}
            {results.documents.length === 0 ? <p className={styles.emptyResults}>No documents cleared the relevance threshold.</p> : null}
          </div>
        </Card>
      ) : null}
    </div>
  );
}
