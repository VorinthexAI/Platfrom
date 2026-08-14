import { expect, test } from "bun:test";

import { normalizeStructurallyCoveredResources, removeFoldersCoveredBySelectedAncestors } from "./content-selection-ancestry";

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
