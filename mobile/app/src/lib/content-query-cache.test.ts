import { expect, test } from "bun:test";
import { QueryClient } from "@tanstack/react-query";

import {
  addCachedContentDocument,
  addCachedContentFolder,
  contentFolderChildren,
  contentFolderDescendantKeys,
  contentFolderStack,
  contentQueryKeys,
  invalidateContentHistories,
  invalidateContentLocations,
  replaceCachedContentDocument,
  replaceCachedContentDocuments,
  replaceCachedContentDocumentDetail,
  replaceCachedContentFolder,
  replaceCachedContentFolders,
  removeCachedContentDocument,
  removeCachedContentDocumentEverywhere,
  removeCachedContentDocumentsEverywhere,
  removeCachedContentFolder,
  removeCachedContentFoldersEverywhere,
} from "./content-query-cache";
import type { ContentContext } from "./content-client";

const context: ContentContext = {
  organizationKey: "organization-a",
  scopeKey: "scope-a",
  agentKey: "agent-a",
};

const otherContext: ContentContext = {
  organizationKey: "organization-b",
  scopeKey: "scope-b",
  agentKey: "agent-b",
};

test("scopes Archive cache keys by the complete content context", () => {
  expect(contentQueryKeys.folderTree(context)).not.toEqual(contentQueryKeys.folderTree(otherContext));
  expect(contentQueryKeys.location(context, "folder-a")).not.toEqual(contentQueryKeys.location(otherContext, "folder-a"));
  expect(contentQueryKeys.document(context, "document-a")).not.toEqual(contentQueryKeys.document(otherContext, "document-a"));
  expect(contentQueryKeys.location(context)).not.toEqual(contentQueryKeys.location(context, "folder-a"));
  expect(contentQueryKeys.audioVersions(context, "document-a").slice(0, -1)).toEqual(contentQueryKeys.document(context, "document-a"));
});

test("derives folder children, ancestry, and descendants from one tree", () => {
  const tree = [
    { key: "root", name: "Root" },
    { key: "child", name: "Child", parentFolderKey: "root" },
    { key: "leaf", name: "Leaf", parentFolderKey: "child" },
    { key: "other", name: "Other" },
  ];

  expect(contentFolderChildren(tree)).toEqual([tree[3], tree[0]]);
  expect(contentFolderChildren(tree, "root")).toEqual([tree[1]]);
  expect(contentFolderStack(tree, "leaf")).toEqual([tree[0], tree[1], tree[2]]);
  expect(contentFolderDescendantKeys(tree, ["root"])).toEqual(["root", "child", "leaf"]);
});

test("patches cached document and folder metadata without evicting note content", () => {
  const client = new QueryClient();
  const locationKey = contentQueryKeys.location(context, "folder-a");
  const documentKey = contentQueryKeys.document(context, "document-a");
  client.setQueryData(locationKey, {
    folders: [{ key: "folder-b", name: "Before" }],
    documents: [{ key: "document-a", name: "Before", isFavorite: false, updatedAt: "before" }],
  });
  client.setQueryData(documentKey, { key: "document-a", name: "Before", isFavorite: false, updatedAt: "before", content: "Cached body" });

  replaceCachedContentDocument(client, context, { key: "document-a", name: "After", isFavorite: true, updatedAt: "after" });
  replaceCachedContentFolder(client, context, { key: "folder-b", name: "Renamed" });

  expect(client.getQueryData<any>(locationKey)).toEqual({
    folders: [{ key: "folder-b", name: "Renamed" }],
    documents: [{ key: "document-a", name: "After", isFavorite: true, updatedAt: "after" }],
  });
  expect(client.getQueryData<any>(documentKey).content).toBe("Cached body");
});

test("patches and removes multiple mixed-selection cache records in one pass", () => {
  const client = new QueryClient();
  const locationKey = contentQueryKeys.location(context, "folder-a");
  client.setQueryData(locationKey, {
    folders: [{ key: "folder-a", name: "Before A" }, { key: "folder-b", name: "Before B" }],
    documents: [
      { key: "document-a", name: "Before A", isFavorite: false, updatedAt: "before" },
      { key: "document-b", name: "Before B", isFavorite: false, updatedAt: "before" },
    ],
  });
  client.setQueryData(contentQueryKeys.document(context, "document-b"), { key: "document-b", name: "Before B", isFavorite: false, updatedAt: "before", content: "Body" });

  replaceCachedContentFolders(client, context, [{ key: "folder-a", name: "After A", isFavorite: true }, { key: "folder-b", name: "After B", isFavorite: true }]);
  replaceCachedContentDocuments(client, context, [
    { key: "document-a", name: "After A", isFavorite: true, updatedAt: "after" },
    { key: "document-b", name: "After B", isFavorite: true, updatedAt: "after" },
  ]);
  removeCachedContentDocumentsEverywhere(client, context, ["document-a", "document-b"]);

  expect(client.getQueryData<any>(locationKey)).toEqual({
    folders: [{ key: "folder-a", name: "After A", isFavorite: true }, { key: "folder-b", name: "After B", isFavorite: true }],
    documents: [],
  });
  expect(client.getQueryData(contentQueryKeys.document(context, "document-b"))).toBeUndefined();
});

test("invalidates only the affected source and destination locations", async () => {
  const client = new QueryClient();
  const source = contentQueryKeys.location(context, "source");
  const destination = contentQueryKeys.location(context, "destination");
  const unrelated = contentQueryKeys.location(context, "unrelated");
  client.setQueryData(source, { folders: [], documents: [] });
  client.setQueryData(destination, { folders: [], documents: [] });
  client.setQueryData(unrelated, { folders: [], documents: [] });

  await invalidateContentLocations(client, context, ["source", "destination", "source"]);

  expect(client.getQueryState(source)?.isInvalidated).toBe(true);
  expect(client.getQueryState(destination)?.isInvalidated).toBe(true);
  expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
});

test("adds completed uploads to only their destination and deduplicates retries", () => {
  const client = new QueryClient();
  const destination = contentQueryKeys.location(context, "folder-a");
  const unrelated = contentQueryKeys.location(context, "folder-b");
  client.setQueryData(destination, { folders: [], documents: [{ key: "document-a", name: "Alpha", isFavorite: false, updatedAt: "before" }] });
  client.setQueryData(unrelated, { folders: [], documents: [] });
  const uploaded = { key: "file-a", name: "Brief.pdf", folderKey: "folder-a", extension: "pdf", isFavorite: false, updatedAt: "after" };

  addCachedContentDocument(client, context, "folder-a", uploaded);
  addCachedContentDocument(client, context, "folder-a", uploaded);

  expect(client.getQueryData<any>(destination).documents).toEqual([
    { key: "document-a", name: "Alpha", isFavorite: false, updatedAt: "before" },
    uploaded,
  ]);
  expect(client.getQueryData<any>(unrelated).documents).toEqual([]);
});

test("optimistically adds and removes documents and folders in exact locations", () => {
  const client = new QueryClient();
  const source = contentQueryKeys.location(context, "source");
  const destination = contentQueryKeys.location(context, "destination");
  const document = { key: "document-a", name: "Document", folderKey: "source", isFavorite: false, updatedAt: "before" };
  const folder = { key: "folder-a", name: "Folder", parentFolderKey: "source" };
  client.setQueryData(contentQueryKeys.folderTree(context), [folder]);
  client.setQueryData(source, { folders: [folder], documents: [document] });
  client.setQueryData(destination, { folders: [], documents: [] });

  removeCachedContentDocument(client, context, "source", document.key);
  removeCachedContentFolder(client, context, "source", folder.key);
  addCachedContentDocument(client, context, "destination", { ...document, folderKey: "destination" });
  addCachedContentFolder(client, context, "destination", { ...folder, parentFolderKey: "destination" });

  expect(client.getQueryData<any>(source)).toEqual({ folders: [], documents: [] });
  expect(client.getQueryData<any>(destination)).toEqual({
    folders: [{ ...folder, parentFolderKey: "destination" }],
    documents: [{ ...document, folderKey: "destination" }],
  });
  expect(client.getQueryData<any>(contentQueryKeys.folderTree(context))).toEqual([{ ...folder, parentFolderKey: "destination" }]);
});

test("removes deleted documents and evicts detail, preview, and nested audio queries", () => {
  const client = new QueryClient();
  const first = contentQueryKeys.location(context, "first");
  const second = contentQueryKeys.location(context, "second");
  const document = { key: "document-a", name: "Scan", isFavorite: false, updatedAt: "before" };
  client.setQueryData(first, { folders: [], documents: [document] });
  client.setQueryData(second, { folders: [], documents: [document] });
  client.setQueryData(contentQueryKeys.document(context, document.key), { ...document, content: "Body" });
  client.setQueryData(contentQueryKeys.preview(context, document.key), { ...document, blocks: [] });
  client.setQueryData(contentQueryKeys.audioVersions(context, document.key), [{ key: "audio-a" }]);
  removeCachedContentDocumentEverywhere(client, context, document.key);
  expect(client.getQueryData<any>(first).documents).toEqual([]);
  expect(client.getQueryData<any>(second).documents).toEqual([]);
  expect(client.getQueryData(contentQueryKeys.document(context, document.key))).toBeUndefined();
  expect(client.getQueryData(contentQueryKeys.preview(context, document.key))).toBeUndefined();
  expect(client.getQueryData(contentQueryKeys.audioVersions(context, document.key))).toBeUndefined();
});

test("evicts all scoped locations when archived folders may contain cached descendants", () => {
  const client = new QueryClient();
  const root = contentQueryKeys.location(context);
  const selected = contentQueryKeys.location(context, "folder-a");
  const descendant = contentQueryKeys.location(context, "folder-child");
  const stale = contentQueryKeys.location(context, "unrelated-stale");
  const other = contentQueryKeys.location(otherContext, "folder-a");
  client.setQueryData(root, { folders: [{ key: "folder-a", name: "Folder" }], documents: [] });
  client.setQueryData(selected, { folders: [{ key: "folder-child", name: "Child" }], documents: [] });
  client.setQueryData(descendant, { folders: [], documents: [] });
  client.setQueryData(stale, { folders: [], documents: [] });
  client.setQueryData(other, { folders: [], documents: [] });
  client.setQueryData(contentQueryKeys.folderTree(context), [
    { key: "folder-a", name: "Folder" },
    { key: "folder-child", parentFolderKey: "folder-a", name: "Child" },
    { key: "unrelated", name: "Unrelated" },
  ]);

  removeCachedContentFoldersEverywhere(client, context, ["folder-a"]);

  expect(client.getQueryData(root)).toBeUndefined();
  expect(client.getQueryData(selected)).toBeUndefined();
  expect(client.getQueryData(descendant)).toBeUndefined();
  expect(client.getQueryData(stale)).toBeUndefined();
  expect(client.getQueryData(other)).toEqual({ folders: [], documents: [] });
  expect(client.getQueryData(contentQueryKeys.folderTree(context))).toEqual([{ key: "unrelated", name: "Unrelated" }]);
});

test("invalidates affected histories and patches moved document detail without corrupting locations", async () => {
  const client = new QueryClient();
  const source = contentQueryKeys.location(context, "source");
  const sourceHistory = contentQueryKeys.history(context, "source");
  const destinationHistory = contentQueryKeys.history(context, "destination");
  const documentKey = contentQueryKeys.document(context, "document-a");
  client.setQueryData(source, { folders: [], documents: [{ key: "document-a", name: "Note", folderKey: "source", isFavorite: false, updatedAt: "before" }] });
  client.setQueryData(sourceHistory, []);
  client.setQueryData(destinationHistory, []);
  client.setQueryData(documentKey, { key: "document-a", name: "Note", folderKey: "source", isFavorite: false, updatedAt: "before", content: "Body" });

  replaceCachedContentDocumentDetail(client, context, { key: "document-a", name: "Note", folderKey: "destination", isFavorite: false, updatedAt: "after" });
  await invalidateContentHistories(client, context, ["source", "destination"]);

  expect(client.getQueryData<any>(source).documents[0].folderKey).toBe("source");
  expect(client.getQueryData<any>(documentKey)).toMatchObject({ folderKey: "destination", content: "Body" });
  expect(client.getQueryState(sourceHistory)?.isInvalidated).toBe(true);
  expect(client.getQueryState(destinationHistory)?.isInvalidated).toBe(true);
});
