import type { QueryClient } from "@tanstack/react-query";

import {
  listContentLocation,
  listContentSearchHistory,
  readContentDocument,
  type ContentContext,
  type ContentDocument,
  type ContentFolder,
} from "./content-client";

export type ContentLocation = Awaited<ReturnType<typeof listContentLocation>>;

const contextKey = (context: ContentContext) => [context.organizationKey, context.scopeKey, context.agentKey] as const;

export const contentQueryKeys = {
  all: (context: ContentContext) => ["archive", ...contextKey(context)] as const,
  locations: (context: ContentContext) => [...contentQueryKeys.all(context), "locations"] as const,
  location: (context: ContentContext, folderKey?: string) => [...contentQueryKeys.locations(context), folderKey ?? null] as const,
  document: (context: ContentContext, documentKey: string) => [...contentQueryKeys.all(context), "documents", documentKey] as const,
  history: (context: ContentContext, folderKey?: string) => [...contentQueryKeys.all(context), "history", folderKey ?? null] as const,
};

export function getContentLocation(queryClient: QueryClient, context: ContentContext, folderKey?: string) {
  return queryClient.fetchQuery({
    queryKey: contentQueryKeys.location(context, folderKey),
    queryFn: () => listContentLocation(folderKey),
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

export async function refreshContentDocument(queryClient: QueryClient, context: ContentContext, documentKey: string) {
  await queryClient.invalidateQueries({ queryKey: contentQueryKeys.document(context, documentKey), exact: true, refetchType: "none" });
  return getContentDocument(queryClient, context, documentKey);
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
  queryClient.setQueriesData<ContentLocation>({ queryKey: contentQueryKeys.locations(context) }, (location) => location ? {
    ...location,
    documents: location.documents.map((document) => document.key === updated.key ? updated : document),
  } : location);
  queryClient.setQueryData<ContentDocument & { content: string }>(contentQueryKeys.document(context, updated.key), (document) => document ? { ...document, ...updated } : document);
}

export function replaceCachedContentFolder(queryClient: QueryClient, context: ContentContext, updated: ContentFolder) {
  queryClient.setQueriesData<ContentLocation>({ queryKey: contentQueryKeys.locations(context) }, (location) => location ? {
    ...location,
    folders: location.folders.map((folder) => folder.key === updated.key ? updated : folder),
  } : location);
}

export async function invalidateContentLocations(queryClient: QueryClient, context: ContentContext, folderKeys: (string | undefined)[]) {
  await Promise.all([...new Set(folderKeys)].map((folderKey) => queryClient.invalidateQueries({
    queryKey: contentQueryKeys.location(context, folderKey),
    exact: true,
    refetchType: "none",
  })));
}
