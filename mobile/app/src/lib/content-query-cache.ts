import type { QueryClient } from "@tanstack/react-query";

import {
  listContentDocumentsAtLocation,
  listContentFolderTree,
  listContentDocumentAudioVersions,
  listContentSearchHistory,
  readContentDocument,
  readContentDocumentPreview,
  type ContentContext,
  type ContentDocument,
  type ContentFolder,
} from "./content-client";

export type ContentLocation = { folders: ContentFolder[]; documents: ContentDocument[] };

const contextKey = (context: ContentContext) => [context.organizationKey, context.scopeKey, context.agentKey] as const;

export const contentQueryKeys = {
  all: (context: ContentContext) => ["archive", ...contextKey(context)] as const,
  folderTree: (context: ContentContext) => [...contentQueryKeys.all(context), "folder-tree"] as const,
  locations: (context: ContentContext) => [...contentQueryKeys.all(context), "locations"] as const,
  location: (context: ContentContext, folderKey?: string) => [...contentQueryKeys.locations(context), folderKey ?? null] as const,
  document: (context: ContentContext, documentKey: string) => [...contentQueryKeys.all(context), "documents", documentKey] as const,
  preview: (context: ContentContext, documentKey: string) => [...contentQueryKeys.all(context), "previews", documentKey] as const,
  history: (context: ContentContext, folderKey?: string) => [...contentQueryKeys.all(context), "history", folderKey ?? null] as const,
  audioVersions: (context: ContentContext, documentKey: string) => [...contentQueryKeys.document(context, documentKey), "audio-versions"] as const,
};

export function contentFolderChildren(tree: readonly ContentFolder[], parentFolderKey?: string) {
  return tree.filter((folder) => folder.parentFolderKey === parentFolderKey)
    .sort((left, right) => left.name.localeCompare(right.name));
}

export function contentFolderStack(tree: readonly ContentFolder[], folderKey?: string) {
  const byKey = new Map(tree.map((folder) => [folder.key, folder]));
  const stack: ContentFolder[] = [];
  const visited = new Set<string>();
  let current = folderKey ? byKey.get(folderKey) : undefined;
  while (current && !visited.has(current.key)) {
    visited.add(current.key);
    stack.unshift(current);
    current = current.parentFolderKey ? byKey.get(current.parentFolderKey) : undefined;
  }
  return stack;
}

export function contentFolderDescendantKeys(tree: readonly ContentFolder[], folderKeys: readonly string[]) {
  const blocked = new Set(folderKeys);
  let changed = true;
  while (changed) {
    changed = false;
    tree.forEach((folder) => {
      if (folder.parentFolderKey && blocked.has(folder.parentFolderKey) && !blocked.has(folder.key)) {
        blocked.add(folder.key);
        changed = true;
      }
    });
  }
  return [...blocked];
}

export function getContentFolderTree(queryClient: QueryClient, context: ContentContext) {
  return queryClient.fetchQuery({
    queryKey: contentQueryKeys.folderTree(context),
    queryFn: listContentFolderTree,
  });
}

export function getContentLocation(queryClient: QueryClient, context: ContentContext, folderKey?: string) {
  return queryClient.fetchQuery({
    queryKey: contentQueryKeys.location(context, folderKey),
    queryFn: async () => {
      const [tree, documents] = await Promise.all([
        getContentFolderTree(queryClient, context),
        listContentDocumentsAtLocation(folderKey),
      ]);
      return { folders: contentFolderChildren(tree, folderKey), documents };
    },
  });
}

export async function refreshContentLocation(queryClient: QueryClient, context: ContentContext, folderKey?: string) {
  await queryClient.invalidateQueries({ queryKey: contentQueryKeys.location(context, folderKey), exact: true, refetchType: "none" });
  return getContentLocation(queryClient, context, folderKey);
}

export function getContentDocument(queryClient: QueryClient, context: ContentContext, documentKey: string) {
  return queryClient.fetchQuery({
    queryKey: contentQueryKeys.document(context, documentKey),
    queryFn: () => readContentDocument(documentKey),
  });
}

export function getContentDocumentPreview(queryClient: QueryClient, context: ContentContext, documentKey: string) {
  return queryClient.fetchQuery({
    queryKey: contentQueryKeys.preview(context, documentKey),
    queryFn: () => readContentDocumentPreview(documentKey),
  });
}

export async function refreshContentDocument(queryClient: QueryClient, context: ContentContext, documentKey: string) {
  await queryClient.invalidateQueries({ queryKey: contentQueryKeys.document(context, documentKey), exact: true, refetchType: "none" });
  return getContentDocument(queryClient, context, documentKey);
}

export function getContentDocumentAudioVersions(queryClient: QueryClient, context: ContentContext, documentKey: string) {
  return queryClient.fetchQuery({
    queryKey: contentQueryKeys.audioVersions(context, documentKey),
    queryFn: () => listContentDocumentAudioVersions(documentKey),
    staleTime: 0,
  });
}

export async function refreshContentDocumentAudioVersions(queryClient: QueryClient, context: ContentContext, documentKey: string) {
  await queryClient.invalidateQueries({ queryKey: contentQueryKeys.audioVersions(context, documentKey), exact: true, refetchType: "none" });
  return getContentDocumentAudioVersions(queryClient, context, documentKey);
}

export function getContentHistory(queryClient: QueryClient, context: ContentContext, folderKey?: string) {
  return queryClient.fetchQuery({
    queryKey: contentQueryKeys.history(context, folderKey),
    queryFn: () => listContentSearchHistory(folderKey, true),
  });
}

export async function refreshContentHistory(queryClient: QueryClient, context: ContentContext, folderKey?: string) {
  await queryClient.invalidateQueries({ queryKey: contentQueryKeys.history(context, folderKey), exact: true, refetchType: "none" });
  return getContentHistory(queryClient, context, folderKey);
}

export function replaceCachedContentDocument(queryClient: QueryClient, context: ContentContext, updated: ContentDocument) {
  replaceCachedContentDocuments(queryClient, context, [updated]);
}

export function replaceCachedContentDocuments(queryClient: QueryClient, context: ContentContext, updated: readonly ContentDocument[]) {
  const updates = new Map(updated.map((document) => [document.key, document]));
  queryClient.setQueriesData<ContentLocation>({ queryKey: contentQueryKeys.locations(context) }, (location) => location ? {
    ...location,
    documents: location.documents.map((document) => updates.get(document.key) ?? document),
  } : location);
  updated.forEach((document) => queryClient.setQueryData<ContentDocument & { content: string }>(contentQueryKeys.document(context, document.key), (cached) => cached ? { ...cached, ...document } : cached));
}

export function addCachedContentDocument(queryClient: QueryClient, context: ContentContext, folderKey: string | undefined, document: ContentDocument) {
  queryClient.setQueryData<ContentLocation>(contentQueryKeys.location(context, folderKey), (location) => location ? {
    ...location,
    documents: [...location.documents.filter((current) => current.key !== document.key), document]
      .sort((left, right) => left.name.localeCompare(right.name)),
  } : location);
}

export function addCachedContentFolder(queryClient: QueryClient, context: ContentContext, parentFolderKey: string | undefined, folder: ContentFolder) {
  queryClient.setQueryData<ContentFolder[]>(contentQueryKeys.folderTree(context), (tree) => tree ? [
    ...tree.filter((current) => current.key !== folder.key),
    folder,
  ] : tree);
  queryClient.setQueryData<ContentLocation>(contentQueryKeys.location(context, parentFolderKey), (location) => location ? {
    ...location,
    folders: [...location.folders.filter((current) => current.key !== folder.key), folder]
      .sort((left, right) => left.name.localeCompare(right.name)),
  } : location);
}

export function removeCachedContentDocument(queryClient: QueryClient, context: ContentContext, folderKey: string | undefined, documentKey: string) {
  queryClient.setQueryData<ContentLocation>(contentQueryKeys.location(context, folderKey), (location) => location ? {
    ...location,
    documents: location.documents.filter((document) => document.key !== documentKey),
  } : location);
}

export function removeCachedContentDocumentEverywhere(queryClient: QueryClient, context: ContentContext, documentKey: string) {
  removeCachedContentDocumentsEverywhere(queryClient, context, [documentKey]);
}

export function removeCachedContentDocumentsEverywhere(queryClient: QueryClient, context: ContentContext, documentKeys: readonly string[]) {
  const removed = new Set(documentKeys);
  queryClient.setQueriesData<ContentLocation>({ queryKey: contentQueryKeys.locations(context) }, (location) => location ? {
    ...location,
    documents: location.documents.filter((document) => !removed.has(document.key)),
  } : location);
  documentKeys.forEach((documentKey) => {
    queryClient.removeQueries({ queryKey: contentQueryKeys.document(context, documentKey) });
    queryClient.removeQueries({ queryKey: contentQueryKeys.preview(context, documentKey), exact: true });
  });
}

export function removeCachedContentFolder(queryClient: QueryClient, context: ContentContext, parentFolderKey: string | undefined, folderKey: string) {
  queryClient.setQueryData<ContentFolder[]>(contentQueryKeys.folderTree(context), (tree) => tree?.filter((folder) => folder.key !== folderKey));
  queryClient.setQueryData<ContentLocation>(contentQueryKeys.location(context, parentFolderKey), (location) => location ? {
    ...location,
    folders: location.folders.filter((folder) => folder.key !== folderKey),
  } : location);
}

export function removeCachedContentFoldersEverywhere(queryClient: QueryClient, context: ContentContext, folderKeys: readonly string[]) {
  if (!folderKeys.length) return;
  queryClient.setQueryData<ContentFolder[]>(contentQueryKeys.folderTree(context), (tree) => {
    if (!tree) return tree;
    const removed = new Set(contentFolderDescendantKeys(tree, folderKeys));
    return tree.filter((folder) => !removed.has(folder.key));
  });
  queryClient.removeQueries({ queryKey: contentQueryKeys.locations(context) });
}

export function replaceCachedContentFolder(queryClient: QueryClient, context: ContentContext, updated: ContentFolder) {
  replaceCachedContentFolders(queryClient, context, [updated]);
}

export function replaceCachedContentFolders(queryClient: QueryClient, context: ContentContext, updated: readonly ContentFolder[]) {
  const updates = new Map(updated.map((folder) => [folder.key, folder]));
  queryClient.setQueryData<ContentFolder[]>(contentQueryKeys.folderTree(context), (tree) => tree?.map((folder) => updates.get(folder.key) ?? folder));
  queryClient.setQueriesData<ContentLocation>({ queryKey: contentQueryKeys.locations(context) }, (location) => location ? {
    ...location,
    folders: location.folders.map((folder) => updates.get(folder.key) ?? folder),
  } : location);
}

export async function invalidateContentLocations(queryClient: QueryClient, context: ContentContext, folderKeys: (string | undefined)[]) {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: contentQueryKeys.folderTree(context), exact: true, refetchType: "none" }),
    ...[...new Set(folderKeys)].map((folderKey) => queryClient.invalidateQueries({
      queryKey: contentQueryKeys.location(context, folderKey),
      exact: true,
      refetchType: "none",
    })),
  ]);
}

export async function invalidateContentHistories(queryClient: QueryClient, context: ContentContext, folderKeys: (string | undefined)[]) {
  await Promise.all([...new Set(folderKeys)].map((folderKey) => queryClient.invalidateQueries({
    queryKey: contentQueryKeys.history(context, folderKey),
    exact: true,
    refetchType: "none",
  })));
}

export function replaceCachedContentDocumentDetail(queryClient: QueryClient, context: ContentContext, updated: ContentDocument) {
  queryClient.setQueryData<ContentDocument & { content: string }>(contentQueryKeys.document(context, updated.key), (document) => document ? { ...document, ...updated } : document);
}
