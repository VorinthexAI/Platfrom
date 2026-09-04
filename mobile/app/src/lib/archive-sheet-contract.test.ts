import { expect, test } from "bun:test";

const source = await Bun.file(new URL("../components/capability/KnowledgeWorkspace.tsx", import.meta.url)).text();
const searchHistorySheet = await Bun.file(new URL("../components/SearchHistorySheet.tsx", import.meta.url)).text();
const searchHistoryPill = await Bun.file(new URL("../../../../shared/packages/ui/components/search-history-pill/search-history-pill.mobile.tsx", import.meta.url)).text();

test("uses persisted app presentation metadata for generated folder covers", () => {
  expect(source).toContain("folder.parentFolderKey ? undefined : folder.presentation");
  expect(source).toContain("contentPresentationIconSource[presentation]");
  expect(source).toContain("style={styles.managedFolderLogo}");
  expect(source).toContain("<FolderCover folder={folder} />");
  expect(source).toContain('`${folder.name} app folder`');
  expect(source).not.toMatch(/folder\.name\s*===\s*["'](?:Compass|Signal|Ascend)/);
});

test("opens routed cached folders without flashing Archive root", () => {
  expect(source).toContain("const cachedTargetFolderKey = cachedInitialDocument?.folderKey ?? initialFolderKey");
  expect(source).toContain("const cachedInitialTree = cachedTargetFolderKey ? queryClient.getQueryData<ContentFolder[]>");
  expect(source).toContain("const cachedInitialStack = cachedTargetFolderKey && cachedInitialTree ? contentFolderPath");
  expect(source).toContain('useState<WorkspaceMode>(cachedInitialFolder ? "folder" : "folders")');
  expect(source).toContain("useState<ContentFolder[]>(cachedInitialStack)");
});

test("opens a routed document once through the canonical Archive path in its containing folder", async () => {
  const route = await Bun.file(new URL("../app/capability/[slug].tsx", import.meta.url)).text();
  expect(route).toContain("initialDocumentKey={params.documentKey}");
  expect(source).toContain("const initialDocumentOpened = useRef<string | undefined>(undefined)");
  expect(source).toContain("const initialDocument = initialDocumentKey ? await getContentDocument(queryClient, contentContext, initialDocumentKey)");
  expect(source).toContain("const targetFolderKey = initialDocument?.folderKey ?? initialFolderKey");
  expect(source).toContain("initialDocumentOpened.current = requestKey");
  expect(source).toMatch(/getContentDocument\(queryClient, contentContext, initialDocumentKey\)[\s\S]*?\.then\(\(document\) => openArchiveDocument\(document\)\)/);
  expect(source).toContain("const openInitialDocument = useEffectEvent(() =>");
});

test("uses the root header spacing rhythm inside folders", () => {
  expect(source.match(/<View style=\{styles\.rootActions\}>/g)).toHaveLength(2);
});

test("keeps root and folder tab-to-content spacing aligned", () => {
  expect(source).toContain("archiveFolder: { flexGrow: 1, gap: spacing.md }");
  expect(source).toContain('rootContent: { width: "100%", gap: spacing.md }');
});

test("keeps empty Archive views scrollable for pull-to-refresh", () => {
  expect(source).toContain('refreshControl={<PullToRefresh enabled={refreshEnabled}');
  expect(source).not.toContain("const archiveEmpty = workspaceMode");
  expect(source).not.toContain('scrollEnabled={!archiveEmpty}');
});

test("fences pull-to-refresh results to the initiating Archive view", () => {
  const refresh = source.slice(source.indexOf("const refreshArchive = async"), source.indexOf("useEffect(() => { if (userHiddensQuery.data)", source.indexOf("const refreshArchive = async")));
  expect(source).toContain("refreshViewKey.current = JSON.stringify([contentContextKey, workspaceMode, currentFolder?.key, folderContentTab, query.trim(), rootSearchQuery.trim(), selectedTagKeys, documentKeyRef.current])");
  expect(refresh).toContain("const navigationRequest = navigationGeneration.current");
  expect(refresh).toContain("refreshViewKey.current === viewKey && navigationGeneration.current === navigationRequest");
  expect(refresh).toContain("if (!isCurrent()) return;");
  expect(refresh).toContain("refreshContentLocation(queryClient, contentContext, folderKey)");
  expect(refresh.indexOf("if (!isCurrent()) return;", refresh.indexOf("await Promise.all"))).toBeLessThan(refresh.indexOf("setFolders(location.folders)"));
  expect(refresh).toContain("if (isCurrent()) setError(");
});

test("keeps newly created folder cards fully interactive with their canonical optimistic key", () => {
  const createFlow = source.slice(source.indexOf("const submitFolder"), source.indexOf("const selectRootFolder"));
  expect(createFlow).toContain("const folderKey = createContentRecordKey()");
  expect(createFlow).toContain("seedCachedContentFolderLocation(queryClient, contentContext, folderKey)");
  expect(createFlow).toContain("pendingFolderCreates.current.set(folderKey, creation)");
  expect(createFlow).toContain("createContentFolder(name, parentFolderKey, optimistic.description, folderKey, mutationKey)");
  expect(createFlow).not.toContain("temporaryKey");
  expect(source).toContain("if (pendingFolderCreates.current.has(folder.key))");
  expect(source).not.toContain('disabled={folder.key.startsWith("optimistic-")}');
  expect(source).not.toContain("styles.optimisticCard");
});

test("lets document AI actions flush autosave and reports empty content without disabled-menu loading", () => {
  const request = source.slice(source.indexOf("const requestDocumentAiAction"), source.indexOf("const generateDocumentTransformation"));
  const menu = source.slice(source.indexOf('{activeSheet === "enhance"'), source.indexOf('{activeSheet === "transform"'));
  expect(request).toContain('notify("Enter some text before using an AI action.")');
  expect(request).toContain("await flushDocumentSave()");
  expect(request.indexOf("await flushDocumentSave()")).toBeLessThan(request.indexOf("openSummarizeSheet()"));
  expect(menu).toContain('requestDocumentAiAction("summarize")');
  expect(menu).toContain('requestDocumentAiAction("enhance")');
  expect(menu).toContain('requestDocumentAiAction("translate")');
  expect(menu).not.toContain("saveState");
  expect(menu).not.toContain("loading=");
  expect(source).toContain('accessibilityLabel="AI document actions" contentMode="raw" onPress={openEnhanceSheet}');
  expect(source).toContain('leadingDisabled={!hasContentContext || instructing}');
  expect(source).toContain('accessibilityLabel="Finish editing document"');
  expect(source).not.toContain('accessibilityLabel="Save and lock document"');
  expect(source).toContain("selectedDocumentKeyRef.current = undefined");
  expect(source).toContain("setSelectedDocument(undefined)");
});

test("centers settled empty Archive searches without changing ordinary empty states", () => {
  expect(source).toContain("rootSearchEmpty && styles.searchRootContent");
  expect(source).toContain("rootSearchFolders.length === 0 && styles.searchEmptyContent");
  expect(source).toContain("rootSearchDocuments.length === 0 && styles.searchEmptyContent");
  expect(source).toContain("folderSearchFolders.length === 0 && styles.searchEmptyContent");
  expect(source).toContain("folderSearchDocuments.length === 0 && styles.searchEmptyContent");
  expect(source).toContain('searchEmptyContent: { flexGrow: 1, width: "100%", flexDirection: "column", alignContent: "center", alignItems: "center", justifyContent: "center" }');
  expect(source).toContain('filteredRootFolders.length === 0 && !archiveLocationLoading && styles.emptyTabContent');
  expect(source).toContain('filteredFolders.length === 0 && !archiveLocationLoading && styles.emptyTabContent');
  expect(source).toContain('emptyTabContent: { flexDirection: "column", flexWrap: "nowrap", alignContent: "stretch" }');
  expect(source).toContain('folderEmptyState: { flexGrow: 1, minHeight: 360, width: "100%", alignItems: "center", justifyContent: "center"');
  expect(source).toContain('<View style={styles.folderEmptyState}>');
});

test("keeps scanned originals complete and ignores stale source-page requests", () => {
  expect(source).toContain('<Image contentFit="contain" source={source.url} style={styles.sourceImage} />');
  expect(source).toContain("const sourceImagesGeneration = useRef(0)");
  expect(source).toContain('activeSheetRef.current === "scanSources"');
  expect(source).toContain("generation === sourceImagesGeneration.current && selectedDocumentKeyRef.current === document.key");
});

test("uses explicit original availability rather than file extension for original actions", () => {
  expect(source).toContain("document.originalAvailable ? \"original\" : \"txt\"");
  expect(source).toContain("selectedDocument.extension && selectedDocument.originalAvailable");
  expect(source).toContain('selectedDocument.originalAvailable ? "Download original" : "Download text"');
});

test("uses folder cards while root and nested folder searches load", () => {
  const folderSearchSkeleton = /folderContentTab === "folders" \? <View accessibilityLabel="Loading folder search results" accessibilityRole="progressbar" style=\{\[styles\.rootFolderGrid,[^}]+\}>\{Array\.from\(\{ length: 3 \}, \(_, index\) => <Skeleton key=\{index\} style=\{\[styles\.rootFolderCard, styles\.skeletonCard, \{ width: archiveCardSize, height: archiveCardSize \}]} \/>\)}<\/View>/g;
  expect(source.match(folderSearchSkeleton)).toHaveLength(2);
});

test("keeps folder empty states hidden until the visible location resolves", () => {
  expect(source).toContain('archiveLocationLoading && (folderContentTab !== "folders" || filteredRootFolders.length === 0)');
  expect(source).toContain('archiveLocationLoading && (folderContentTab !== "folders" || filteredFolders.length === 0)');
  expect(source).not.toContain("archiveFolderTreeReady");
});

test("uses canonical app search for Archive folder and document pickers", () => {
  expect(source).toContain("const [librarySearchResults, setLibrarySearchResults] = useState<ContentSearchResponse>()");
  expect(source).toContain("searchContentMatches(normalized, controller.signal, undefined, false)");
  expect(source).toContain('activeSheet !== "folders" && activeSheet !== "documents"');
  expect(source).toContain('accessibilityLabel="Loading Archive folder picker search"');
  expect(source).toContain('accessibilityLabel="Loading Archive document picker search"');
});

test("integrates global tag filters only into primary Archive root and folder results", () => {
  expect(source).toContain("const tagContextKey = tagFilterContextKey(contentContext)");
  expect(source).toContain("state.selectedTagsByContext[tagContextKey] ?? EMPTY_SELECTED_TAGS");
  expect(source.match(/<TagFilterLane context=\{contentContext\} \/>/g)).toHaveLength(2);
  expect(source).toContain('<TagFilterSheet context={contentContext} onClose={() => setTagFilterOpen(false)} open={tagFilterOpen} />');
  expect(source).toContain('<BottomSheetItem onPress={openTagFilters} style={styles.sheetAction} variant="secondary">Tags</BottomSheetItem>');
  expect(source).toContain("closeSheet();\n    requestAnimationFrame(() => setTagFilterOpen(true));");
  expect(source).toContain("const rootSearchActive = Boolean(rootSearchQuery.trim() || selectedTags.length)");
  expect(source).toContain("const folderSearchActive = Boolean(query.trim() || selectedTags.length)");
  expect(source).toContain("searchContentMatches(normalized, controller.signal, undefined, false, { tagKeys: selectedTagKeys })");
  expect(source).toContain("searchContentMatches(normalized, controller.signal, folderKey, false, { tagKeys: selectedTagKeys })");
  expect(source).toContain("[hasContentContext, rootSearchQuery, rootSearchRevision, selectedTagKeys]");
  expect(source).toContain("[currentFolder?.key, folderSearchRevision, hasContentContext, query, selectedTagKeys]");
  expect(source).toContain("searchContentMatches(normalized, controller.signal, undefined, false).then((matches)");
});

test("appends processing documents and generated versions as full-pill skeletons", () => {
  expect(source).toContain('import { Skeleton } from "@vorinthex/shared/ui/skeleton";');
  const processingButton = source.slice(source.indexOf("function ProcessingDocumentButton"), source.indexOf("export function KnowledgeWorkspace"));
  expect(processingButton).toContain('<Skeleton accessibilityLabel={`Processing ${name}`} accessibilityRole="progressbar" style={styles.documentSkeleton} />');
  expect(processingButton).not.toContain("Spinner");
  expect(source).toContain('setVersions((history) => [...history.filter(({ key }) => key !== version.key), version])');
  const versionList = source.slice(source.indexOf('{versions.map((version)'), source.indexOf('</View>\n        ) : null}', source.indexOf('{versions.map((version)')));
  expect(versionList.indexOf('{versions.map((version)')).toBeLessThan(versionList.indexOf('<Skeleton accessibilityLabel={pendingDocumentVersionLabel}'));
  expect(source).toContain('versionSkeleton: { width: "100%", height: 42, borderRadius: 999 }');
  const rootDocuments = source.indexOf('<View style={styles.rootDocuments}>');
  const rootPills = source.indexOf('rootTabDocuments.map', rootDocuments);
  expect(rootPills).toBeLessThan(source.indexOf('visibleUploadBatch.map', rootPills));
  const folderDocuments = source.lastIndexOf('<View style={[styles.folderDocuments, styles.folderTabContent]}>');
  const folderPills = source.indexOf('folderTabDocuments.map', folderDocuments);
  expect(folderPills).toBeLessThan(source.indexOf('visibleUploadBatch.map', folderPills));
});

test("keeps transformation sheets dismissible and background errors out of the editor", () => {
  expect(source).toContain('documentActionLoading === "enhance" || documentActionLoading === "translate"');
  expect(source).toContain('>{documentTransformation === "enhance" ? "Enhance" : "Translate"}</Button>');
  const openTransformation = source.slice(source.indexOf("const openDocumentTransformation"), source.indexOf("const updateTranslationTargetLanguage"));
  expect(openTransformation.indexOf("setLoadingVersions(true)")).toBeLessThan(openTransformation.indexOf('pushSheet("versions")'));
  expect(openTransformation.indexOf('pushSheet("versions")')).toBeLessThan(openTransformation.indexOf("await listContentDocumentVersions"));
  expect(openTransformation.indexOf('pushSheet("versions")')).toBeLessThan(openTransformation.indexOf("requestAnimationFrame"));
  expect(source).toContain('await openDocumentVersion(version, generated.text, true)');
  expect(source).toContain('if (propagateError) throw cause');
  expect(source).toContain('if (activeSheetRef.current === "versions") setSheetError(message);\n      else notify(message);');
  const versionFooter = source.slice(source.indexOf('if (activeSheet === "versions")'), source.indexOf('if (activeSheet === "documentVersions")'));
  expect(versionFooter).toContain('{close(false)}');
  expect(versionFooter).not.toContain('close(Boolean(documentActionLoading))');
});

test("keeps managed documents read-only without hiding read and history controls", () => {
  expect(source).toContain('{!activeDocument?.managed && (editorEditing');
  expect(source).toContain('{!activeDocument?.managed ? <Button accessibilityLabel="AI document actions"');
  expect(source).not.toContain('workspaceMode !== "editor" || !activeDocument?.managed');
  expect(source).toContain('<CoreComposer');
  expect(source).toContain('!managedDocument && !loadingSummaries && summaries.length === 0');
  expect(source).toContain('activeSheet === "summarize" && !selectedDocument?.managed');
  expect(source).toContain('activeSheet === "enhance" && !activeDocument?.managed');
  expect(source).toContain('if (activeDocument?.managed) return;');
  expect(source).toContain('if (!document?.key || document.managed || generatingSummary) return;');
  expect(source).toContain('accessibilityLabel="Search in document"');
  expect(source).toContain('accessibilityLabel="Document versions and history"');
  expect(source).toContain('onPress={() => void listenToSelectedDocument()}');
});

test("normalizes Archive scans and folder covers as PNG", () => {
  expect(source).toContain('normalizeCapturedPng(coverChange');
  expect(source).toContain('filename: `folder-cover-${Date.now()}.png`');
  expect(source).toContain('name: `scan-page-${index + 1}.png`');
});

test("keeps folder actions titleless and cover removal circular", () => {
  expect(source).toContain('activeSheet === "filter" || activeSheet === "folderActions" || activeSheet === "bulkActions"');
  expect(source).toContain('accessibilityLabel="Remove folder cover" contentMode="raw" iconOnly');
  expect(source).toContain('folderDetailsCoverRemove: { width: 42, height: 42, minHeight: 42');
});

test("centers confirmed empty states across Archive sheets", () => {
  expect(searchHistorySheet).toContain('styles.list, !loading && history.length === 0 && styles.emptyContent');
  expect(source).toContain('styles.summaryTopicPanel, !loadingSummaryTopics && !sheetError && summaryTopics.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('styles.versionPanel, !loadingVersions && !pendingDocumentVersionLabel && versions.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('styles.audioVersionList, !loadingAudioVersions && audioVersions.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('await generateContentDocumentAudio(document.key)');
  expect(source).toContain('>Generate audio</Button>');
  expect(source).toContain('await playAudioVersion(version, 0, true, false)');
  expect(source).toContain('styles.audioVersionList, !loadingSummaries && summaries.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('styles.sourceGrid, !sourceImagesLoading && !sheetError && sourceImages.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('styles.destinationFolderGrid, !destinationLoading && !sheetError && destinationFolders.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('styles.folderGrid, !showArchiveRoot && visibleFolders.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('styles.folderGrid, visibleDocuments.length === 0 && styles.sheetEmptyContent');
});

test("uses the single shared search history sheet", async () => {
  const gallery = await Bun.file(new URL("../components/capability/GalleryWorkspace.tsx", import.meta.url)).text();
  const compass = await Bun.file(new URL("../components/capability/TravelWorkspace.tsx", import.meta.url)).text();
  for (const workspace of [source, gallery, compass]) expect(workspace).toContain('import { SearchHistorySheet } from "@/components/SearchHistorySheet";');
  expect(searchHistorySheet).toContain('<SearchHistoryPill');
  expect(source).not.toContain('<SearchHistoryPill');
  expect(gallery).not.toContain('<SearchHistoryPill');
  expect(compass).not.toContain('<SearchHistoryPill');
});

test("keeps search history removal local to one inset control", () => {
  expect(searchHistorySheet).toContain("disabled={removingQuery === item.normalizedQuery}");
  expect(searchHistorySheet).not.toContain("disabled={Boolean(removingQuery)}");
  expect(searchHistoryPill).toContain("marginLeft: 6");
});

test("provides messages for previously blank Archive sheet states", () => {
  expect(source).toContain("No scanned pages found.");
  expect(source).toContain("No subfolders here.");
  expect(source).toContain("No summary available.");
});

test("centers full-height Archive load errors instead of rendering empty sheet bodies", () => {
  expect(source).toContain('const [sheetLoadError, setSheetLoadError] = useState<string>();');
  expect(source).toContain('{sheetLoadError ? <View style={styles.sheetEmptyContent}><Text accessibilityRole="alert" style={styles.notice}>{sheetLoadError}</Text></View> : <>');
  expect(source).toContain('setSheetLoadError(cause instanceof Error ? cause.message : "Search history could not be loaded.")');
  expect(source).toContain('setSheetLoadError(cause instanceof Error ? cause.message : "Similar Archive content could not be loaded.")');
  expect(source).toContain('setSheetLoadError(cause instanceof Error ? cause.message : "The scanned pages could not be opened.")');
  expect(source).toContain('setSheetLoadError(cause instanceof Error ? cause.message : "Document topics could not be generated.")');
  expect(source).toContain('setSheetLoadError(cause instanceof Error ? cause.message : "Summary versions could not be loaded.")');
  expect(source).toContain('setSheetLoadError(cause instanceof Error ? cause.message : "The document summary could not be created.")');
  expect(source).toContain('setSheetLoadError(cause instanceof Error ? cause.message : "Document versions could not be loaded.")');
  expect(source).toContain('setSheetLoadError(cause instanceof Error ? cause.message : "Versions could not be loaded.")');
  expect(source).toContain('setSheetLoadError(cause instanceof Error ? cause.message : "Audio versions could not be loaded.")');
  expect(source).toContain('setSheetLoadError(cause instanceof Error ? cause.message : "The folder could not be opened.")');
  expect(source).toContain('{sheetLoadError ? <Button disabled={loadingSummaryTopics || generatingSummary}');
});

test("keeps compact and actionable Archive errors inline", () => {
  expect(source).toContain('if (action === "upload") setSheetError(message);');
  expect(source).toContain('setSheetError(cause instanceof Error ? cause.message : "The search could not be removed.")');
  expect(source).toContain('if (activeSheetRef.current === "versions") setSheetError(message);');
  expect(source).toContain('setSheetError(cause instanceof Error ? cause.message : "Files could not be selected.")');
});

test("uses only intrinsic and full-height Archive sheets", () => {
  const sheetStart = source.indexOf("<BottomSheet");
  const sheetEnd = source.indexOf("\n      >", sheetStart);
  const sheet = source.slice(sheetStart, sheetEnd);
  expect(sheet).toContain('height={activeSheet === "documents"');
  expect(sheet).toContain('? "full" : undefined}');
  expect(sheet).not.toContain("mutation=");
  expect(sheet).not.toContain("tall=");
});

test("uses standard-sized actions in compact Archive confirmations", () => {
  const compactDeleteStart = source.indexOf("{compactDelete ?");
  const compactDeleteEnd = source.indexOf("{activeSheet === \"create\"", compactDeleteStart);
  const compactDelete = source.slice(compactDeleteStart, compactDeleteEnd);
  expect(compactDelete.match(/size="md"/g)).toHaveLength(2);
  expect(compactDelete).not.toContain('size="lg"');
});

test("shows concise count-aware question titles for Archive confirmations", () => {
  expect(source).toContain('const deleteConfirmationTitle = activeSheet === "deleteDocument"');
  expect(source).toContain('`Delete ${selectedDocument?.extension ? "file" : "document"}?`');
  expect(source).toContain('`Delete ${selectedCount} ${bulkDeleteNoun}${selectedCount === 1 ? "" : "s"}?`');
  expect(source).toContain("title={compactDelete ? deleteConfirmationTitle");
  expect(source).not.toContain('|| compactDelete}');
});

test("offers folder-first creation from the Archive root and current folder", () => {
  expect(source.match(/openSheet\("create"\)/g)).toHaveLength(2);
  const start = source.indexOf('{activeSheet === "create" ? (');
  const menu = source.slice(start, source.indexOf('activeSheet === "bulkActions"', start));
  expect(menu).toContain('>Create folder</BottomSheetItem>');
  expect(menu).toContain('>Create document</BottomSheetItem>');
  expect(menu.indexOf('>Create folder</BottomSheetItem>')).toBeLessThan(menu.indexOf('>Create document</BottomSheetItem>'));
});

test("shows a top-right check badge on selected Archive folders", () => {
  expect(source.match(/selected \? <View pointerEvents="none" style=\{styles\.selectionBadge\}/g)).toHaveLength(4);
  expect(source).toContain('selectionBadge: { position: "absolute", top: 4, right: 4');
});

test("guards confirmed favorite folder, document, and file deletion with title-only notices", () => {
  expect(source).toContain('notify("Can\'t delete favorite folder")');
  expect(source).toContain('notify(`Can\'t delete favorite ${target.extension ? "file" : "document"}`)');
  expect(source.indexOf("if (directFolder.isFavorite)")).toBeLessThan(source.indexOf("removeCachedContentFolder(queryClient, contentContext, parentKey, directFolder.key)"));
  expect(source.indexOf("if (target.isFavorite)")).toBeLessThan(source.indexOf("await hardDeleteContentSelection({ folderKeys: [], documentKeys: [target.key] })"));
  expect(source).not.toContain('showToast({ title, description:');
  expect(source).not.toContain('message.startsWith("Unfavorite")');
});

test("partitions bulk favorites before normalization and mutation while retaining them", () => {
  const partition = source.indexOf("partitionFavoriteContentSelection(selectedFoldersSnapshot, selectedDocumentsSnapshot)");
  const normalize = source.indexOf("resolveStructuralResources(eligibleFolders, eligibleDocuments)");
  const mutation = source.indexOf("hardDeleteContentSelection(operationSelection)");
  expect(partition).toBeGreaterThan(-1);
  expect(partition).toBeLessThan(normalize);
  expect(normalize).toBeLessThan(mutation);
  expect(source).toContain("if (localFavoriteCount > 0 && eligibleFolders.length === 0 && eligibleDocuments.length === 0)");
  expect(source.indexOf("if (localFavoriteCount > 0 && eligibleFolders.length === 0 && eligibleDocuments.length === 0)")).toBeLessThan(source.indexOf("bulkMutationLocked.current = true", partition));
  expect(source).toMatch(/if \(localFavoriteCount > 0 && eligibleFolders\.length === 0 && eligibleDocuments\.length === 0\) \{\s+closeSheet\(true\);\s+notify\(`Can't delete \$\{localFavoriteCount\} favorite item\$\{localFavoriteCount === 1 \? "" : "s"\}`\);\s+return;\s+\}/);
  expect(source).toContain('setSelectedFolders([...favoriteFolders, ...operationFolders.filter(({ key }) => failedFolders.has(key))])');
  expect(source).toContain('setSelectedDocuments([...favoriteDocuments, ...operationDocuments.filter(({ key }) => failedDocuments.has(key))])');
  expect(source).toContain('const archivedFolderKeys = operationFolders.map(({ key }) => key).filter((key) => !failedFolders.has(key))');
  expect(source).toContain('const archivedDocumentKeys = operationDocuments.map(({ key }) => key).filter((key) => !failedDocuments.has(key))');
});

test("maps stale single and bulk conflicts to exact favorite notices", () => {
  expect(source).toContain('if (outcome.succeeded === 0) throw outcome.failures[0] ?? new Error("The folder could not be deleted.")');
  expect(source).toContain('notify(isFavoriteContentConflict(cause) ? "Can\'t delete favorite folder" : "Folder deletion failed")');
  expect(source).toContain('if (outcome.failures.some(isFavoriteContentConflict))');
  expect(source).toContain('const serverFavoriteFailures = new Set(outcome.failures.filter(isFavoriteContentConflict).map(({ kind, key }) => `${kind}:${key}`))');
  expect(source).toContain("const favoriteCount = localFavoriteCount > 0 ? localFavoriteCount : serverFavoriteFailures.size");
  expect(source).toContain('`Can\'t delete ${favoriteCount} favorite item${favoriteCount === 1 ? "" : "s"}`');
});

test("makes post-archive invalidation best effort", () => {
  expect(source).toContain('void queryClient.invalidateQueries({ queryKey: contentQueryKeys.locations(contentContext), refetchType: "none" }).catch(() => undefined)');
  expect(source).toContain('void invalidateContentLocations(queryClient, contentContext, [target.folderKey]).catch(() => undefined)');
  expect(source).not.toContain("invalidateContentHistories");
});

test("retains known favorite state on provisional selected search documents", () => {
  expect(source.match(/isFavorite: document\.isFavorite/g)).toHaveLength(2);
});

test("suppresses structural Archive actions for managed resources while retaining favorite and hide", () => {
  expect(source).toContain("const selectionHasManaged = [...selectedFolders, ...selectedDocuments].some((item) => item.managed)");
  expect(source).toContain("!currentFolder?.managed ? <Button");
  expect(source).toContain("!selectionHasManaged ? <Button");
  expect(source).toContain("!selectedDocument.managed ? <BottomSheetItem");
  expect(source).toContain("!selectedFolder.managed ? <BottomSheetItem");
  const bulkStart = source.lastIndexOf('{activeSheet === "bulkActions"');
  const bulk = source.slice(bulkStart, source.indexOf('{activeSheet === "historyChooser"', bulkStart));
  expect(bulk).toContain("updateSelectionFavorite()");
  expect(bulk).toContain("!selectionHasManaged");
  const documentActionsStart = source.lastIndexOf('{activeSheet === "documentActions" && selectedDocument');
  const documentActions = source.slice(documentActionsStart, source.indexOf('{activeSheet === "scanSources"', documentActionsStart));
  expect(documentActions).toContain('setHiddenOptimistically("document"');
  const folderActionsStart = source.lastIndexOf('{activeSheet === "folderActions" && selectedFolder');
  const folderActions = source.slice(folderActionsStart, source.indexOf('{activeSheet === "folderDetails"', folderActionsStart));
  expect(folderActions).toContain('setHiddenOptimistically("folder"');
});

test("opens bulk Archive tag assignment with the full content context and preserves selection", () => {
  expect(source).toContain('import { ResourceTagsSheet } from "@/components/ResourceTagsSheet";');
  expect(source).toContain('selectedFolders.map(({ key }) => ({ type: "folder" as const, key }))');
  expect(source).toContain('selectedDocuments.map(({ key }) => ({ type: "document" as const, key }))');
  expect(source).toContain('closeSheet(true);\n    requestAnimationFrame(() => setResourceTagsOpen(true));');
  expect(source).toContain('<Button disabled={bulkLoading} onPress={openResourceTags} size="md" variant="secondary">Tags</Button>');
  expect(source).toContain('<ResourceTagsSheet context={contentContext} onClose={() => setResourceTagsOpen(false)} open={resourceTagsOpen} targets={resourceTagTargets} />');
});
