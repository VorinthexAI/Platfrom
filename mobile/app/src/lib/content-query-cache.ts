import type { QueryClient } from "@tanstack/react-query";
import type { UserHiddenRecord } from "./user-hidden-client";

import {
  listContentDocumentsAtLocation,
  listContentFolderTree,
  listContentDocumentAudioVersions,
  listContentDocumentSummaries,
  getContentDocumentTopics,
  readContentDocument,
  type ContentContext,
  type ContentDocument,
  type ContentDocumentAudioVersion,
  type ContentDocumentSummary,
  type ContentFolder,
} from "./content-client";

export type ContentLocation = { folders: ContentFolder[]; documents: ContentDocument[] };
export type FolderContentTab = "folders" | "documents" | "files";

export function populatedContentTab(location: ContentLocation, selected: FolderContentTab): FolderContentTab {
  const populated: Record<FolderContentTab, boolean> = {
    folders: location.folders.length > 0,
    documents: location.documents.some(({ extension }) => !extension),
    files: location.documents.some(({ extension }) => Boolean(extension)),
  };
  return (["folders", "documents", "files"] as const).find((tab) => populated[tab]) ?? selected;
}

const contextKey = (context: ContentContext) => [context.userKey ?? "", context.organizationKey, context.scopeKey] as const;

export const contentQueryKeys = {
  all: (context: ContentContext) => ["archive", ...contextKey(context)] as const,
  folderTree: (context: ContentContext) => [...contentQueryKeys.all(context), "folder-tree"] as const,
  userHiddens: (context: ContentContext) => [...contentQueryKeys.all(context), "user-hiddens"] as const,
  locations: (context: ContentContext) => [...contentQueryKeys.all(context), "locations"] as const,
  location: (context: ContentContext, folderKey?: string) => [...contentQueryKeys.locations(context), folderKey ?? null] as const,
  document: (context: ContentContext, documentKey: string) => [...contentQueryKeys.all(context), "documents", documentKey] as const,
  audioVersions: (context: ContentContext, documentKey: string) => [...contentQueryKeys.document(context, documentKey), "audio-versions"] as const,
  summaries: (context: ContentContext, documentKey: string) => [...contentQueryKeys.document(context, documentKey), "summaries"] as const,
  topics: (context: ContentContext, documentKey: string) => [...contentQueryKeys.document(context, documentKey), "topics"] as const,
};

export function patchContentUserHiddens(queryClient: QueryClient, context: ContentContext, update: (current: UserHiddenRecord[]) => UserHiddenRecord[]) {
  const key = contentQueryKeys.userHiddens(context);
  const previous = queryClient.getQueryData<UserHiddenRecord[]>(key) ?? [];
  queryClient.setQueryData(key, update(previous));
  return previous;
}

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
    queryFn: ({ signal }) => listContentFolderTree(signal, context),
  });
}

export function getContentLocation(queryClient: QueryClient, context: ContentContext, folderKey?: string) {
  return queryClient.fetchQuery({
    queryKey: contentQueryKeys.location(context, folderKey),
    queryFn: async ({ signal }) => {
      const [tree, documents] = await Promise.all([
        getContentFolderTree(queryClient, context),
        listContentDocumentsAtLocation(folderKey, signal, context),
      ]);
      return { folders: contentFolderChildren(tree, folderKey), documents };
    },
  });
}

export async function refreshContentLocation(queryClient: QueryClient, context: ContentContext, folderKey?: string) {
  await queryClient.cancelQueries({ queryKey: contentQueryKeys.location(context, folderKey), exact: true });
  await queryClient.invalidateQueries({ queryKey: contentQueryKeys.location(context, folderKey), exact: true, refetchType: "none" });
  return getContentLocation(queryClient, context, folderKey);
}

export function getContentDocument(queryClient: QueryClient, context: ContentContext, documentKey: string) {
  return queryClient.fetchQuery({
    queryKey: contentQueryKeys.document(context, documentKey),
    queryFn: () => readContentDocument(documentKey, context),
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

export function addCachedContentDocumentAudioVersion(queryClient: QueryClient, context: ContentContext, version: ContentDocumentAudioVersion) {
  queryClient.setQueryData<ContentDocumentAudioVersion[]>(contentQueryKeys.audioVersions(context, version.documentKey), (current = []) => [
    version,
    ...current.filter(({ key }) => key !== version.key),
  ].sort((left, right) => right.version - left.version));
  return version;
}

export function updateCachedContentDocumentAudioPlayback(queryClient: QueryClient, context: ContentContext, documentKey: string, audioVersionKey: string, playbackPositionMs: number) {
  queryClient.setQueryData<ContentDocumentAudioVersion[]>(contentQueryKeys.audioVersions(context, documentKey), (current = []) => current.map((version) => ({
    ...version,
    isCurrent: version.key === audioVersionKey,
    ...(version.key === audioVersionKey ? { playbackPositionMs } : {}),
  })));
}

export function clearCachedContentDocumentAudioPlayback(queryClient: QueryClient, context: ContentContext, documentKey: string) {
  queryClient.setQueryData<ContentDocumentAudioVersion[]>(contentQueryKeys.audioVersions(context, documentKey), (current = []) => current.map((version) => ({ ...version, isCurrent: false })));
}

export function getContentDocumentSummaries(queryClient: QueryClient, context: ContentContext, documentKey: string) {
  return queryClient.fetchQuery({
    queryKey: contentQueryKeys.summaries(context, documentKey),
    queryFn: () => listContentDocumentSummaries(documentKey),
    staleTime: Infinity,
  });
}

export function addCachedContentDocumentSummary(queryClient: QueryClient, context: ContentContext, summary: ContentDocumentSummary) {
  queryClient.setQueryData<ContentDocumentSummary[]>(contentQueryKeys.summaries(context, summary.documentKey), (current = []) => [
    summary,
    ...current.filter(({ key }) => key !== summary.key),
  ].sort((left, right) => right.version - left.version));
  return queryClient.getQueryData<ContentDocumentSummary[]>(contentQueryKeys.summaries(context, summary.documentKey))?.find(({ key }) => key === summary.key) ?? summary;
}

export async function refreshContentDocumentSummaries(queryClient: QueryClient, context: ContentContext, documentKey: string) {
  await queryClient.invalidateQueries({ queryKey: contentQueryKeys.summaries(context, documentKey), exact: true, refetchType: "none" });
  return getContentDocumentSummaries(queryClient, context, documentKey);
}

export function getCachedContentDocumentTopics(queryClient: QueryClient, context: ContentContext, documentKey: string) {
  return queryClient.fetchQuery({
    queryKey: contentQueryKeys.topics(context, documentKey),
    queryFn: ({ signal }) => getContentDocumentTopics(documentKey, signal),
    gcTime: Infinity,
    staleTime: Infinity,
  });
}

export async function invalidateContentDocumentTopics(queryClient: QueryClient, context: ContentContext, documentKey: string) {
  await queryClient.cancelQueries({ queryKey: contentQueryKeys.topics(context, documentKey), exact: true });
  await queryClient.invalidateQueries({ queryKey: contentQueryKeys.topics(context, documentKey), exact: true, refetchType: "none" });
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

export function seedCachedContentFolderLocation(queryClient: QueryClient, context: ContentContext, folderKey: string) {
  queryClient.setQueryData<ContentLocation>(contentQueryKeys.location(context, folderKey), (location) => location ?? { folders: [], documents: [] });
}

export function removeCachedContentFolderLocation(queryClient: QueryClient, context: ContentContext, folderKey: string) {
  queryClient.removeQueries({ queryKey: contentQueryKeys.location(context, folderKey), exact: true });
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

export function replaceCachedContentDocumentDetail(queryClient: QueryClient, context: ContentContext, updated: ContentDocument) {
  queryClient.setQueryData<ContentDocument & { content: string }>(contentQueryKeys.document(context, updated.key), (document) => document ? { ...document, ...updated } : document);
}
