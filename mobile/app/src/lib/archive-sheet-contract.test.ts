import { expect, test } from "bun:test";

const source = await Bun.file(new URL("../components/capability/KnowledgeWorkspace.tsx", import.meta.url)).text();
const searchHistorySheet = await Bun.file(new URL("../components/SearchHistorySheet.tsx", import.meta.url)).text();
const searchHistoryPill = await Bun.file(new URL("../../../../shared/packages/ui/components/search-history-pill/search-history-pill.mobile.tsx", import.meta.url)).text();

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

test("appends processing documents and generated versions as full-pill skeletons", () => {
  expect(source).toContain('import { Skeleton } from "@vorinthex/shared/ui/skeleton";');
  const processingButton = source.slice(source.indexOf("function ProcessingDocumentButton"), source.indexOf("export function KnowledgeWorkspace"));
  expect(processingButton).toContain('<Skeleton accessibilityLabel={`Processing ${name}`} accessibilityRole="progressbar" style={styles.documentSkeleton} />');
  expect(processingButton).not.toContain("Spinner");
  expect(source).toContain('setVersions((history) => [...history.filter(({ key }) => key !== version.key), version])');
  const versionList = source.slice(source.indexOf('{versions.map((version)'), source.indexOf('</View>\n        ) : null}', source.indexOf('{versions.map((version)')));
  expect(versionList.indexOf('{versions.map((version)')).toBeLessThan(versionList.indexOf('<Skeleton accessibilityLabel={pendingDocumentVersionLabel}'));
  const rootDocuments = source.indexOf('<View style={styles.rootDocuments}>');
  const rootPills = source.indexOf('rootTabDocuments.map', rootDocuments);
  expect(rootPills).toBeLessThan(source.indexOf('visibleUploadBatch.map', rootPills));
  const folderDocuments = source.lastIndexOf('<View style={[styles.folderDocuments, styles.folderTabContent]}>');
  const folderPills = source.indexOf('folderTabDocuments.map', folderDocuments);
  expect(folderPills).toBeLessThan(source.indexOf('visibleUploadBatch.map', folderPills));
});

test("keeps transformation sheets dismissible and background errors out of the editor", () => {
  expect(source).toContain('documentActionLoading === "enhance" || documentActionLoading === "translate"');
  expect(source).toContain('await openDocumentVersion(version, generated.text, true)');
  expect(source).toContain('if (propagateError) throw cause');
  expect(source).toContain('if (activeSheetRef.current === "versions") setSheetError(message);\n      else notify(message);');
  const versionFooter = source.slice(source.indexOf('if (activeSheet === "versions")'), source.indexOf('if (activeSheet === "documentVersions")'));
  expect(versionFooter).toContain('{close(false)}');
  expect(versionFooter).not.toContain('close(Boolean(documentActionLoading))');
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
  expect(source).toContain('void invalidateContentHistories(queryClient, contentContext, [currentFolder?.key, undefined]).catch(() => undefined)');
  expect(source).toContain('void invalidateContentLocations(queryClient, contentContext, [target.folderKey]).catch(() => undefined)');
  expect(source).toContain('void invalidateContentHistories(queryClient, contentContext, [target.folderKey, undefined]).catch(() => undefined)');
});

test("retains known favorite state on provisional selected search documents", () => {
  expect(source.match(/isFavorite: document\.isFavorite/g)).toHaveLength(2);
});
