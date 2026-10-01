import { db } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { appSearchRetrievalSchema, type AppSearchRetrieval } from '@/lib/app-search/service';
import { searchWorkspace } from '@/lib/ai/tools/content-runtime';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';
import type { FileExtension } from '@/lib/db/files.node';
import { agentQueryInputSchema } from './workspace-query-schema';

export { agentQueryInputSchema } from './workspace-query-schema';
export type { AgentQueryInput } from './workspace-query-schema';

export interface WorkspaceQueryDependencies {
  search?: typeof searchWorkspace;
  message?: string;
  recent?: AppSearchRetrieval[];
  onEvidence?: (values: AppSearchRetrieval[]) => void;
  signal?: AbortSignal;
}

type Resource = 'folders' | 'files';
type NamedRow = Record<string, unknown> & { key: string };
const IMAGE_EXTENSIONS: FileExtension[] = ['jpg', 'jpeg', 'png', 'webp', 'gif'];

function imageOnlyRequest(message: string | undefined) {
  return Boolean(message && /\b(?:find|show|list|search|count|locate|where are|how many)\b[^.!?]*\b(?:images?|photos?|pictures?|screenshots?)\b/i.test(message)
    && !/\b(?:videos?|audio|songs?|documents?|pdfs?|files of all types)\b/i.test(message));
}

function evidence(row: NamedRow, resource: Resource) {
  if (resource === 'folders') return { name: row.name, description: row.description, isFavorite: row.isFavorite };
  return { name: row.name, extension: row.extension, mimeType: row.mimeType, sizeBytes: row.sizeBytes, processing: row.processing, isFavorite: row.isFavorite };
}

async function ownedRows(context: ToolContext, collection: Resource, extra: string, bind: Record<string, unknown>, limit?: number) {
  const userKey = contextUserKey(context);
  const capped = limit ? 'SORT row.updatedAt DESC LIMIT @limit' : '';
  const cursor = await db.query(`
    FOR row IN ${collection}
      FILTER row.scopeKey == @scopeKey && row.userKey == @userKey
      FILTER row.isHidden != true
      ${extra}
      ${capped}
      RETURN row
  `, { scopeKey: context.runtimeScopeKey, userKey, ...bind, ...(limit ? { limit } : {}) });
  return (await cursor.all() as Record<string, unknown>[]).map((row) => withArangoKey(row) as NamedRow);
}

async function resolveParent(context: ToolContext, parent: { name?: string; recent?: boolean } | undefined, recent: AppSearchRetrieval[] | undefined) {
  if (!parent) return undefined;
  if (parent.recent) {
    const key = recent?.flatMap((item) => item.groups).find((group) => group.collectionSlug === 'folders')?.results[0]?.key;
    return key;
  }
  if (!parent.name) return undefined;
  const rows = await ownedRows(context, 'folders', 'FILTER LOWER(row.name) == @name', { name: parent.name.normalize('NFKC').toLocaleLowerCase().trim() }, 2);
  return rows.length === 1 ? rows[0]!.key : undefined;
}

export async function queryWorkspace(raw: unknown, context: ToolContext, dependencies: WorkspaceQueryDependencies = {}) {
  const input = agentQueryInputSchema.parse(raw);
  if (context.principal.kind !== 'member' || context.principal.user.key !== contextUserKey(context)) throw new Error('Active user required.');
  const search = dependencies.search ?? searchWorkspace;
  const imagesOnly = imageOnlyRequest(dependencies.message);
  const navigation: AppSearchRetrieval[] = [];
  const remember = (slug: Resource, key: string, label: string) => {
    const parsed = appSearchRetrievalSchema.safeParse({ source: 'results', limit: 10, groups: [{ collectionSlug: slug, results: [{ key, label: label.slice(0, 200) }] }] });
    if (parsed.success) navigation.push(parsed.data);
  };

  const answers = await Promise.all(input.requests.map(async (request) => {
    const extensions = request.resource === 'folders' ? undefined : imagesOnly
      ? request.extensions?.filter((extension) => IMAGE_EXTENSIONS.includes(extension)) ?? IMAGE_EXTENSIONS
      : request.extensions;
    if (extensions?.length === 0) return { resource: request.resource, status: 'complete' as const, matches: [] };
    const parentKey = await resolveParent(context, request.parent, dependencies.recent);
    if (request.resource === 'workspace' || request.operation === 'search' || request.operation === 'discover') {
      const query = request.query?.trim();
      if (!query) return { resource: request.resource, status: 'partial' as const, matches: [] };
      if (request.parent && !parentKey) return { resource: request.resource, status: 'partial' as const, matches: [] };
      const found = await search(context, {
        query,
        ...(parentKey ? { folderKey: parentKey } : {}),
        ...(extensions ? { extensions } : {}),
        limit: Math.min(50, Math.max(request.limit, 10)),
      }, { entireScope: !parentKey });
      const hits = [
        ...(request.resource === 'files' || extensions ? [] : found.folders.map((folder) => ({ resource: 'folders' as const, item: folder }))),
        ...(request.resource === 'folders' ? [] : found.files.map((file) => ({ resource: 'files' as const, item: file }))),
      ].sort((left, right) => right.item.score - left.item.score).slice(0, request.limit);
      const matches = hits.map(({ resource, item }) => {
        remember(resource, item.key, item.name);
        return { resource, record: 'extension' in item
          ? { name: item.name, extension: item.extension, mimeType: item.mimeType, sizeBytes: item.sizeBytes, processing: item.processing, isFavorite: item.isFavorite }
          : { name: item.name, description: item.description, isFavorite: item.isFavorite } };
      });
      return { resource: request.resource, status: hits.length >= request.limit || !hits.length ? 'partial' as const : 'complete' as const, matches };
    }

    const resource: Resource = request.resource === 'folders' ? 'folders' : 'files';
    const parentFilter = !request.parent
      ? ''
      : parentKey
        ? (resource === 'folders' ? 'FILTER row.parentFolderKey == @parentKey' : 'FILTER row.folderKey == @parentKey')
        : 'FILTER false';
    const bind = { ...(parentKey ? { parentKey } : {}), ...(extensions ? { extensions } : {}) };
    const filtered = `${parentFilter}${extensions ? ' FILTER row.extension IN @extensions' : ''}`;

    if (request.operation === 'count') {
      const rows = await ownedRows(context, resource, filtered, bind);
      return { resource, status: 'complete' as const, count: rows.length };
    }
    if (request.operation === 'sum') {
      if (resource !== 'files' || request.field !== 'sizeBytes') return { resource, status: 'partial' as const };
      const cursor = await db.query(`RETURN SUM(FOR row IN files FILTER row.scopeKey == @scopeKey && row.userKey == @userKey FILTER row.isHidden != true ${filtered} RETURN row.sizeBytes)`, { scopeKey: context.runtimeScopeKey, userKey: contextUserKey(context), ...bind });
      return { resource, status: 'complete' as const, field: 'sizeBytes', total: Number(await cursor.next() ?? 0) };
    }
    if (request.operation === 'read') {
      const name = request.query?.normalize('NFKC').toLocaleLowerCase().trim();
      if (!name) return { resource, status: 'partial' as const, matches: [] };
      const rows = await ownedRows(context, resource, `${filtered} FILTER LOWER(row.name) == @name`, { ...bind, name }, 2);
      if (rows.length !== 1) return { resource, status: 'partial' as const, matches: [] };
      remember(resource, rows[0]!.key, String(rows[0]!.name));
      return { resource, status: 'complete' as const, matches: [{ resource, record: evidence(rows[0]!, resource) }] };
    }
    const rows = await ownedRows(context, resource, filtered, bind, request.limit);
    for (const row of rows) remember(resource, row.key, String(row.name ?? resource));
    return { resource, status: rows.length >= request.limit ? 'partial' as const : 'complete' as const, matches: rows.map((row) => ({ resource, record: evidence(row, resource) })) };
  }));

  const grouped = (['folders', 'files'] as const).map((collectionSlug) => ({
    collectionSlug,
    results: navigation.filter((item) => item.groups[0]?.collectionSlug === collectionSlug).flatMap((item) => item.groups[0]!.results).filter((result, index, results) => results.findIndex((candidate) => candidate.key === result.key) === index).slice(0, 50),
  })).filter(({ results }) => results.length);
  if (grouped.length) dependencies.onEvidence?.([appSearchRetrievalSchema.parse({ source: 'results', limit: 50, groups: grouped })]);
  return { answers };
}
