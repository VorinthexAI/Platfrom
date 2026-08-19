import { expect, test } from "bun:test";

import { normalizeStructurallyCoveredResources, partitionFavoriteContentSelection, removeFoldersCoveredBySelectedAncestors } from "./content-selection-ancestry";

test("partitions directly selected favorites before structural normalization", () => {
  const favoriteFolder = { key: "favorite-folder", isFavorite: true };
  const eligibleFolder = { key: "eligible-folder", isFavorite: false };
  const favoriteDocument = { key: "favorite-document", folderKey: eligibleFolder.key, isFavorite: true };
  const eligibleDocument = { key: "eligible-document", folderKey: favoriteFolder.key, isFavorite: false };

  expect(partitionFavoriteContentSelection([favoriteFolder, eligibleFolder], [favoriteDocument, eligibleDocument])).toEqual({
    favoriteFolders: [favoriteFolder],
    favoriteDocuments: [favoriteDocument],
    eligibleFolders: [eligibleFolder],
    eligibleDocuments: [eligibleDocument],
  });
});

test("partitions before normalization without reversing ancestor coverage", () => {
  const favoriteAncestor = { key: "favorite-ancestor", isFavorite: true };
  const eligibleDescendant = { key: "eligible-descendant", parentFolderKey: favoriteAncestor.key, isFavorite: false };
  const eligibleAncestor = { key: "eligible-ancestor", isFavorite: false };
  const favoriteDescendant = { key: "favorite-descendant", parentFolderKey: eligibleAncestor.key, isFavorite: true };
  const partition = partitionFavoriteContentSelection(
    [favoriteAncestor, eligibleDescendant, eligibleAncestor, favoriteDescendant],
    [],
  );
  const parentByKey = new Map<string, string | undefined>([
    [favoriteAncestor.key, undefined],
    [eligibleDescendant.key, favoriteAncestor.key],
    [eligibleAncestor.key, undefined],
    [favoriteDescendant.key, eligibleAncestor.key],
  ]);

  expect(normalizeStructurallyCoveredResources(partition.eligibleFolders, partition.eligibleDocuments, parentByKey)).toEqual({
    folders: [eligibleDescendant, eligibleAncestor],
    documents: [],
  });
  expect(partition.favoriteFolders).toEqual([favoriteAncestor, favoriteDescendant]);
});

test("removes a selected descendant when unselected intermediate folders connect it to a selected ancestor", () => {
  const folders = [
    { key: "ancestor", name: "Ancestor" },
    { key: "descendant", parentFolderKey: "intermediate", name: "Descendant" },
  ];
  const parentByKey = new Map<string, string | undefined>([
    ["ancestor", undefined],
    ["intermediate", "ancestor"],
    ["descendant", "intermediate"],
  ]);

  expect(removeFoldersCoveredBySelectedAncestors(folders, parentByKey)).toEqual([folders[0]]);
});

test("keeps unrelated selected roots and tolerates defensive parent cycles", () => {
  const folders = [{ key: "first" }, { key: "second", parentFolderKey: "cycle-a" }];
  const parentByKey = new Map<string, string | undefined>([["cycle-a", "cycle-b"], ["cycle-b", "cycle-a"]]);

  expect(removeFoldersCoveredBySelectedAncestors(folders, parentByKey)).toEqual(folders);
});

test("removes a document directly contained by a selected folder", () => {
  const folders = [{ key: "selected-folder" }];
  const documents = [{ key: "document", folderKey: "selected-folder" }];

  expect(normalizeStructurallyCoveredResources(folders, documents, new Map())).toEqual({ folders, documents: [] });
});

test("removes a document deeply contained by a selected folder through unselected folders", () => {
  const folders = [{ key: "selected-folder" }];
  const documents = [{ key: "document", folderKey: "deep-folder" }];
  const parentByKey = new Map<string, string | undefined>([["deep-folder", "middle-folder"], ["middle-folder", "selected-folder"]]);

  expect(normalizeStructurallyCoveredResources(folders, documents, parentByKey)).toEqual({ folders, documents: [] });
});

test("keeps documents outside selected folder subtrees", () => {
  const folders = [{ key: "selected-folder" }];
  const documents = [{ key: "document", folderKey: "other-folder" }, { key: "root-document" }];
  const parentByKey = new Map<string, string | undefined>([["other-folder", undefined]]);

  expect(normalizeStructurallyCoveredResources(folders, documents, parentByKey)).toEqual({ folders, documents });
});
