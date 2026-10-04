import { z } from 'zod';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';
import { db } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { fileExtensionSchema } from '@/lib/db/files.node';

export const appSearchCollectionSlugSchema = z.enum(['folders', 'files']);
export type AppSearchCollectionSlug = z.infer<typeof appSearchCollectionSlugSchema>;
export const appSearchRetrievalCollectionSlugSchema = appSearchCollectionSlugSchema;
export type AppSearchRetrievalCollectionSlug = AppSearchCollectionSlug;
export const APP_SEARCH_COLLECTION_ADAPTERS = Object.freeze({
  folders: { description: 'Folders that organize files.', operations: ['search', 'list', 'count', 'get'] },
  files: { description: 'Stored files.', operations: ['search', 'list', 'count', 'get', 'sum'] },
});

export const appSearchRetrievalResultSchema = z.object({ key: z.string().cuid(), label: z.string().trim().min(1).max(200), destinationKey: z.string().cuid().optional() }).strict();
export const appSearchRetrievalGroupSchema = z.object({ collectionSlug: appSearchRetrievalCollectionSlugSchema, results: z.array(appSearchRetrievalResultSchema).max(50) }).strict();
export const appSearchRetrievalSchema = z.object({ source: z.enum(['results', 'query']), query: z.string().optional(), limit: z.number().int().min(1).max(50), groups: z.array(appSearchRetrievalGroupSchema).min(1).max(8), inventory: z.object({ folderKey: z.string().cuid().optional(), extensions: z.array(fileExtensionSchema).min(1).optional() }).strict().optional() }).strict();
export type AppSearchRetrieval = z.infer<typeof appSearchRetrievalSchema>;

export function projectAppSearchRetrieval(_input: unknown, _result: unknown): AppSearchRetrieval | null {
  return null;
}

export function projectAppSearchModelResult(result: unknown) {
  return result;
}

export async function searchFiles(context: ToolContext, input: { query?: string; operation?: 'search' | 'list' | 'count'; collectionSlugs?: Array<'folders' | 'files'>; folderKey?: string; limit?: number }) {
  const userKey = contextUserKey(context);
  const scopeKey = context.runtimeScopeKey;
  const limit = input.limit ?? 10;
  const slugs = input.collectionSlugs ?? ['folders', 'files'];
  const query = input.query?.trim().toLowerCase() ?? '';
  const groups = [];
  if (slugs.includes('folders')) {
    const cursor = await db.query(`FOR folder IN folders FILTER folder.scopeKey == @scopeKey && folder.userKey == @userKey FILTER @folderKey == null ? true : folder.parentFolderKey == @folderKey FILTER @query == '' || CONTAINS(LOWER(folder.name), @query) SORT folder.updatedAt DESC LIMIT @limit RETURN folder`, { scopeKey, userKey, folderKey: input.folderKey ?? null, query, limit });
    const results = (await cursor.all() as Record<string, unknown>[]).map((row) => withArangoKey(row));
    if (input.operation === 'count') groups.push({ collectionSlug: 'folders', count: results.length, results: [] });
    else groups.push({ collectionSlug: 'folders', results: results.map((row) => ({ key: row.key, name: row.name, parentFolderKey: row.parentFolderKey, isFavorite: row.isFavorite })) });
  }
  if (slugs.includes('files')) {
    const cursor = await db.query(`FOR file IN files FILTER file.scopeKey == @scopeKey && file.userKey == @userKey FILTER @folderKey == null ? true : file.folderKey == @folderKey FILTER @query == '' || CONTAINS(LOWER(file.name), @query) || (IS_STRING(file.extractedText) && CONTAINS(LOWER(file.extractedText), @query)) SORT file.updatedAt DESC LIMIT @limit RETURN file`, { scopeKey, userKey, folderKey: input.folderKey ?? null, query, limit });
    const results = (await cursor.all() as Record<string, unknown>[]).map((row) => withArangoKey(row));
    if (input.operation === 'count') groups.push({ collectionSlug: 'files', count: results.length, results: [] });
    else groups.push({ collectionSlug: 'files', results: results.map((row) => ({ key: row.key, name: row.name, extension: row.extension, folderKey: row.folderKey, sizeBytes: row.sizeBytes, processing: row.processing, isFavorite: row.isFavorite })) });
  }
  return { query: input.query ?? '', groups };
}

export function createAppSearchService() {
  return { search: async (input: { operation?: 'search' | 'list' | 'count'; collectionSlugs?: Array<'folders' | 'files'>; query?: string; folderKey?: string; limit?: number; recordHistory?: boolean }, context: ToolContext) => searchFiles(context, input) };
}
