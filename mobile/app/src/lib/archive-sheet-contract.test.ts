import { expect, test } from "bun:test";

const source = await Bun.file(new URL("../components/capability/KnowledgeWorkspace.tsx", import.meta.url)).text();

test("centers confirmed empty states across Archive sheets", () => {
  expect(source).toContain('styles.searchHistoryList, !historyLoading && history.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('styles.summaryTopicPanel, !loadingSummaryTopics && !sheetError && summaryTopics.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('styles.versionPanel, !loadingVersions && !pendingDocumentVersionLabel && versions.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('styles.audioVersionList, !loadingAudioVersions && !generatingAudioVersion && audioVersions.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('styles.audioVersionList, !loadingSummaries && summaries.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('styles.sourceGrid, !sourceImagesLoading && !sheetError && sourceImages.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('styles.destinationFolderGrid, !destinationLoading && !sheetError && destinationFolders.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('styles.folderGrid, !showArchiveRoot && visibleFolders.length === 0 && styles.sheetEmptyContent');
  expect(source).toContain('styles.folderGrid, visibleDocuments.length === 0 && styles.sheetEmptyContent');
});

test("provides messages for previously blank Archive sheet states", () => {
  expect(source).toContain("No scanned pages found.");
  expect(source).toContain("No subfolders here.");
  expect(source).toContain("No summary available.");
});

test("shows a top-right check badge on selected Archive folders", () => {
  expect(source.match(/selected \? <View pointerEvents="none" style=\{styles\.selectionBadge\}/g)).toHaveLength(4);
  expect(source).toContain('selectionBadge: { position: "absolute", top: 4, right: 4');
});

test("guards confirmed favorite folder, document, and file deletion with title-only notices", () => {
  expect(source).toContain('notify("Can\'t delete favorite folder")');
  expect(source).toContain('notify(`Can\'t delete favorite ${target.extension ? "file" : "document"}`)');
  expect(source.indexOf("if (directFolder.isFavorite)")).toBeLessThan(source.indexOf("removeCachedContentFolder(queryClient, contentContext, parentKey, directFolder.key)"));
  expect(source.indexOf("if (target.isFavorite)")).toBeLessThan(source.indexOf("await archiveContentSelection({ folderKeys: [], documentKeys: [target.key] })"));
  expect(source).not.toContain('showToast({ title, description:');
  expect(source).not.toContain('message.startsWith("Unfavorite")');
});

test("partitions bulk favorites before normalization and mutation while retaining them", () => {
  const partition = source.indexOf("partitionFavoriteContentSelection(selectedFoldersSnapshot, selectedDocumentsSnapshot)");
  const normalize = source.indexOf("resolveStructuralResources(eligibleFolders, eligibleDocuments)");
  const mutation = source.indexOf("archiveContentSelection(operationSelection)");
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
