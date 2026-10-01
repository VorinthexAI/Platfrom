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

export type ContentLocation = { folders: ContentFolder[]; files: ContentFile[]; folderCursor?: string; fileCursor?: string; folderDone?: boolean; fileDone?: boolean };

const contextKey = (context: ContentContext) => [context.userKey ?? "", context.scopeKey] as const;

export const contentQueryKeys = {
  all: (context: ContentContext) => ["files", ...contextKey(context)] as const,
  locations: (context: ContentContext) => [...contentQueryKeys.all(context), "locations"] as const,
  location: (context: ContentContext, folderKey?: string) => [...contentQueryKeys.locations(context), folderKey ?? null] as const,
  file: (context: ContentContext, fileKey: string) => [...contentQueryKeys.all(context), "files", fileKey] as const,
};

export const STORAGE_PAGE_SIZE = 25;

export function hasMoreContentLocationPages(location?: ContentLocation) {
  return Boolean(location && (location.folderDone === false || location.fileDone === false));
}

export async function loadContentLocationPage(context: ContentContext, folderKey: string | undefined, filters: { favoritesOnly?: boolean; includeHidden?: boolean }, extensions: readonly string[], previous?: ContentLocation, signal?: AbortSignal): Promise<ContentLocation> {
  const folderPage = previous?.folderDone ? undefined : await listContentFolderPage(folderKey, signal, context, previous?.folderCursor, STORAGE_PAGE_SIZE, filters);
  const folders = folderPage?.folders ?? [];
  const remaining = STORAGE_PAGE_SIZE - folders.length;
  const filePage = remaining > 0 && previous?.fileDone !== true
    ? await listContentFilePage(folderKey, signal, context, previous?.fileCursor, remaining, extensions, filters)
    : undefined;
  return {
    folders: appendCursorItems(previous?.folders ?? [], folders, ({ key }) => key),
    files: appendCursorItems(previous?.files ?? [], filePage?.files ?? [], ({ key }) => key),
    folderCursor: folderPage?.cursor,
    fileCursor: filePage ? filePage.cursor : previous?.fileCursor,
    folderDone: folderPage ? !folderPage.cursor : previous?.folderDone ?? false,
    fileDone: filePage ? !filePage.cursor : previous?.fileDone ?? false,
  };
}

export function contentLocationQueryOptions(context: ContentContext, folderKey?: string, filters: { favoritesOnly?: boolean; includeHidden?: boolean } = {}, options: { allFiles?: boolean; paged?: boolean; extensions?: readonly string[] } = {}) {
  return {
    queryKey: [...contentQueryKeys.location(context, folderKey), ...(options.paged ? ["paged", options.extensions?.join(",") ?? ""] : []), Boolean(filters.favoritesOnly), Boolean(filters.includeHidden), ...(options.allFiles ? ["all-files"] : [])] as const,
    queryFn: async ({ signal }: { signal: AbortSignal }): Promise<ContentLocation> => {
      if (options.paged) return loadContentLocationPage(context, folderKey, filters, options.extensions ?? [], undefined, signal);
      const [folders, filePage] = await Promise.all([
        (async () => {
          const results: ContentFolder[] = [];
          let cursor: string | undefined;
          do {
            const page = await listContentFolderPage(folderKey, signal, context, cursor, 100, filters);
            results.push(...page.folders);
            cursor = page.cursor;
          } while (cursor);
          return results;
        })(),
        (async () => {
          if (!options.allFiles) return listContentFilePage(folderKey, signal, context, undefined, FILE_LOCATION_PAGE_SIZE, undefined, filters);
          const files: ContentFile[] = [];
          let cursor: string | undefined;
          do {
            const page = await listContentFilePage(folderKey, signal, context, cursor, 100, undefined, filters);
            files.push(...page.files);
            cursor = page.cursor;
          } while (cursor);
          return { files };
        })(),
      ]);
      return { folders, files: filePage.files, fileCursor: filePage.cursor };
    },
  };
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
  for (const [key, location] of queryClient.getQueriesData<ContentLocation>({ queryKey: contentQueryKeys.location(context, parentFolderKey) })) {
    if (!location) continue;
    const favoritesOnly = typeof key.at(-2) === "boolean" && key.at(-2) === true;
    queryClient.setQueryData<ContentLocation>(key, {
      ...location,
      folders: [...location.folders.filter((current) => current.key !== folder.key), ...(!favoritesOnly || folder.isFavorite ? [folder] : [])].sort((left, right) => left.name.localeCompare(right.name)),
    });
  }
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
