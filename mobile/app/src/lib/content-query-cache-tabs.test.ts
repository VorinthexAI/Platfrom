import { describe, expect, test } from "bun:test";
import { populatedContentTab, type ContentLocation, type FolderContentTab } from "./content-query-cache";

const location = (folders: number, documents: Array<{ extension?: string }>): ContentLocation => ({
  folders: Array.from({ length: folders }, (_, index) => ({ key: `folder-${index}`, name: `Folder ${index}` })) as ContentLocation["folders"],
  documents: documents.map((document, index) => ({ key: `document-${index}`, name: `Document ${index}`, isFavorite: false, updatedAt: "2026-08-31T00:00:00.000Z", ...document })) as ContentLocation["documents"],
});

describe("Archive folder tab selection", () => {
  test("chooses the first populated tab in folder, document, file order", () => {
    expect(populatedContentTab(location(1, [{}, { extension: "pdf" }]), "folders")).toBe("folders");
    expect(populatedContentTab(location(1, [{}, { extension: "pdf" }]), "documents")).toBe("folders");
    expect(populatedContentTab(location(1, [{}, { extension: "pdf" }]), "files")).toBe("folders");
  });

  test("falls back in folders, documents, files order", () => {
    expect(populatedContentTab(location(1, [{}]), "files")).toBe("folders");
    expect(populatedContentTab(location(0, [{}, { extension: "pdf" }]), "folders")).toBe("documents");
    expect(populatedContentTab(location(0, [{ extension: "pdf" }]), "documents")).toBe("files");
  });

  test("retains the selected tab when the folder is empty", () => {
    for (const selected of ["folders", "documents", "files"] as FolderContentTab[]) {
      expect(populatedContentTab(location(0, []), selected)).toBe(selected);
    }
  });
});
