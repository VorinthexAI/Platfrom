import type { QueryClient } from "@tanstack/react-query";
import { appendCursorItems } from "@vorinthex/shared/lib/pagination";

import {
  FILE_LOCATION_PAGE_SIZE,
  listContentFilePage,
  listContentFolderPage,
  type ContentContext,
  type ContentFile,
  type ContentFolder,
} from "./content-client";

export type ContentLocation = { folders: ContentFolder[]; files: ContentFile[]; folderCursor?: string; fileCursor?: string };

const contextKey = (context: ContentContext) => [context.userKey ?? "", context.scopeKey] as const;

export const contentQueryKeys = {
  all: (context: ContentContext) => ["files", ...contextKey(context)] as const,
  locations: (context: ContentContext) => [...contentQueryKeys.all(context), "locations"] as const,
  location: (context: ContentContext, folderKey?: string) => [...contentQueryKeys.locations(context), folderKey ?? null] as const,
  file: (context: ContentContext, fileKey: string) => [...contentQueryKeys.all(context), "files", fileKey] as const,
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

export function getContentLocation(queryClient: QueryClient, context: ContentContext, folderKey?: string) {
  return queryClient.fetchQuery({
    queryKey: contentQueryKeys.location(context, folderKey),
    queryFn: async ({ signal }) => {
      const [foldersPage, filesPage] = await Promise.all([
        listContentFolderPage(folderKey, signal, context),
        listContentFilePage(folderKey, signal, context),
      ]);
      return { folders: foldersPage.folders, files: filesPage.files, folderCursor: foldersPage.cursor, fileCursor: filesPage.cursor };
    },
    staleTime: 30_000,
  });
}

export async function refreshContentLocation(queryClient: QueryClient, context: ContentContext, folderKey?: string) {
  await queryClient.cancelQueries({ queryKey: contentQueryKeys.location(context, folderKey), exact: true });
  await queryClient.invalidateQueries({ queryKey: contentQueryKeys.location(context, folderKey), exact: true, refetchType: "none" });
  return getContentLocation(queryClient, context, folderKey);
}

export async function fillContentLocationFiles(location: ContentLocation, input: { folderKey?: string; context: ContentContext; minCount: number; signal?: AbortSignal }) {
  let next = location;
  let cursor = next.fileCursor;
  let started = false;
  while (next.files.length < input.minCount) {
    if (started && !cursor) break;
    started = true;
    const page = await listContentFilePage(input.folderKey, input.signal, input.context, cursor, FILE_LOCATION_PAGE_SIZE);
    next = { ...next, files: appendCursorItems(next.files, page.files, ({ key }) => key), fileCursor: page.cursor };
    cursor = page.cursor;
  }
  return next;
}

export function addCachedContentFile(queryClient: QueryClient, context: ContentContext, folderKey: string | undefined, file: ContentFile) {
  queryClient.setQueryData<ContentLocation>(contentQueryKeys.location(context, folderKey), (location) => location ? {
    ...location,
    files: [...location.files.filter((current) => current.key !== file.key), file].sort((left, right) => left.name.localeCompare(right.name)),
  } : location);
}

export function addCachedContentFolder(queryClient: QueryClient, context: ContentContext, parentFolderKey: string | undefined, folder: ContentFolder) {
  queryClient.setQueryData<ContentLocation>(contentQueryKeys.location(context, parentFolderKey), (location) => location ? {
    ...location,
    folders: [...location.folders.filter((current) => current.key !== folder.key), folder].sort((left, right) => left.name.localeCompare(right.name)),
  } : location);
}

export function replaceCachedContentFile(queryClient: QueryClient, context: ContentContext, updated: ContentFile) {
  queryClient.setQueriesData<ContentLocation>({ queryKey: contentQueryKeys.locations(context) }, (location) => location ? {
    ...location,
    files: location.files.map((file) => file.key === updated.key ? updated : file),
  } : location);
}

export function replaceCachedContentFolder(queryClient: QueryClient, context: ContentContext, updated: ContentFolder) {
  queryClient.setQueriesData<ContentLocation>({ queryKey: contentQueryKeys.locations(context) }, (location) => location ? {
    ...location,
    folders: location.folders.map((folder) => folder.key === updated.key ? updated : folder),
  } : location);
}

export function removeCachedContentFile(queryClient: QueryClient, context: ContentContext, fileKey: string) {
  queryClient.setQueriesData<ContentLocation>({ queryKey: contentQueryKeys.locations(context) }, (location) => location ? {
    ...location,
    files: location.files.filter((file) => file.key !== fileKey),
  } : location);
}

export function removeCachedContentFolder(queryClient: QueryClient, context: ContentContext, folderKey: string) {
  queryClient.setQueriesData<ContentLocation>({ queryKey: contentQueryKeys.locations(context) }, (location) => location ? {
    ...location,
    folders: location.folders.filter((folder) => folder.key !== folderKey),
  } : location);
}

export async function invalidateContentLocations(queryClient: QueryClient, context: ContentContext, folderKeys: (string | undefined)[]) {
  await Promise.all([...new Set(folderKeys)].map((folderKey) => queryClient.invalidateQueries({
    queryKey: contentQueryKeys.location(context, folderKey),
    exact: true,
    refetchType: "none",
  })));
}
