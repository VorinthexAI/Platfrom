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
