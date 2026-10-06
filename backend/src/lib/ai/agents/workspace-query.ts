import { db } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { fileSchema, type FileRecord } from '@/lib/db/files.node';
import { appSearchRetrievalSchema, type AppSearchRetrieval } from '@/lib/app-search/service';
import { executeAction } from '@/lib/ai/router';
import { SparkRepositoryError } from '@/lib/sparks/repository';
import { rerankInputSchema, rerankOutputSchema, type RerankOutput } from '@/lib/ai/actions/rerank';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';
import { agentQueryInputSchema, agentQueryOutputSchema } from './workspace-query-schema';
import { workspaceCandidateKeys } from './workspace-candidates';
import { listWorkspaceInventory } from './workspace-inventory';

export { agentQueryInputSchema } from './workspace-query-schema';
export type { AgentQueryInput } from './workspace-query-schema';

type Resource = 'folders' | 'files';
type NamedRow = Record<string, unknown> & { key: string; name: string };
type RecentMessage = { role: string; content: string; retrievals: AppSearchRetrieval[] };
type AuthorizedReference = { resource: Resource; row: NamedRow; messageOffset: number; message: string };
const MAX_REFERENCES = 200;
const MAX_RESULT_BYTES = 90_000;
const RESULT_LIMIT = 10;
const MAX_FILE_EVIDENCE_BYTES = 6_500;

export interface WorkspaceQueryDependencies {
  recentMessages?: readonly RecentMessage[];
  onEvidence?: (values: AppSearchRetrieval[]) => void;
  signal?: AbortSignal;
  currentConversationKey?: string;
}

async function ownedRows(context: ToolContext, collection: Resource, filter = '', bind: Record<string, unknown> = {}, limit?: number): Promise<NamedRow[]> {
  const cursor = await db.query(`
    FOR row IN ${collection}
      FILTER row.scopeKey == @scopeKey && row.userKey == @userKey && row.isHidden != true
      ${filter}
      ${limit ? 'SORT row.updatedAt DESC LIMIT @limit' : ''}
      RETURN row
  `, { scopeKey: context.runtimeScopeKey, userKey: contextUserKey(context), ...bind, ...(limit ? { limit } : {}) });
  return (await cursor.all() as Record<string, unknown>[]).map((row) => withArangoKey(row) as NamedRow);
}

function normalized(value: string) { return value.normalize('NFKC').toLocaleLowerCase().trim(); }

async function authorizedReferences(context: ToolContext, messages: readonly RecentMessage[]) {
  const candidates = messages.slice(0, 10).flatMap((message, index) => message.retrievals.flatMap((retrieval) => retrieval.groups.flatMap((group) =>
    group.collectionSlug === 'files' || group.collectionSlug === 'folders'
      ? group.results.map((result) => ({ resource: group.collectionSlug, key: result.key, messageOffset: index + 1, message: message.content }))
      : [],
  )));
  const unique = candidates.filter((value, index) => candidates.findIndex((candidate) => candidate.resource === value.resource && candidate.key === value.key) === index);
  const limited = unique.slice(0, MAX_REFERENCES);
  const folders = limited.filter(({ resource }) => resource === 'folders').map(({ key }) => key);
  const files = limited.filter(({ resource }) => resource === 'files').map(({ key }) => key);
  const [ownedFolders, ownedFiles] = await Promise.all([
    folders.length ? ownedRows(context, 'folders', 'FILTER row._key IN @keys', { keys: folders }) : Promise.resolve([]),
    files.length ? ownedRows(context, 'files', 'FILTER row._key IN @keys', { keys: files }) : Promise.resolve([]),
  ]);
  const accessible = new Map([...ownedFolders.map((row) => [`folders:${row.key}`, row] as const), ...ownedFiles.map((row) => [`files:${row.key}`, row] as const)]);
  return {
    entries: limited.flatMap((value): AuthorizedReference[] => {
      const row = accessible.get(`${value.resource}:${value.key}`);
      return row ? [{ resource: value.resource, row, messageOffset: value.messageOffset, message: value.message }] : [];
    }),
    truncated: unique.length > MAX_REFERENCES,
  };
}

function recentSelection(entries: AuthorizedReference[], resource: Resource) {
  const candidates = entries.filter((entry) => entry.resource === resource);
  const latest = candidates[0]?.messageOffset;
  if (!latest) return null;
  const fromLatest = candidates.filter((entry) => entry.messageOffset === latest);
  const mentioned = fromLatest.filter((entry) => normalized(entry.message).includes(normalized(entry.row.name)));
  return mentioned.length === 1 ? mentioned[0]!.row : fromLatest.length === 1 ? fromLatest[0]!.row : null;
}

function folderSelection(folders: NamedRow[], selector: { name?: string; recent?: true }, references: AuthorizedReference[]) {
  if (selector.recent) {
    const chosen = recentSelection(references, 'folders');
    return chosen ? folders.find(({ key }) => key === chosen.key) ?? null : null;
  }
  const name = normalized(selector.name!);
  const exact = folders.filter((folder) => normalized(folder.name) === name);
  if (exact.length === 1) return exact[0]!;
  if (exact.length > 1) return null;
  const withoutSuffix = name.replace(/\s+(?:mappen|folder)$/, '');
  const shortened = folders.filter((folder) => normalized(folder.name) === withoutSuffix);
  return shortened.length === 1 ? shortened[0]! : null;
}

function descendantFolderKeys(folders: NamedRow[], rootKey: string) {
  const children = new Map<string, string[]>();
  for (const folder of folders) {
    const parent = folder.parentFolderKey;
    if (typeof parent !== 'string') continue;
    children.set(parent, [...(children.get(parent) ?? []), folder.key]);
  }
  const keys = new Set([rootKey]);
  const queue = [rootKey];
  for (let index = 0; index < queue.length; index++) for (const key of children.get(queue[index]!) ?? []) {
    if (keys.has(key)) continue;
    keys.add(key);
    queue.push(key);
  }
  return [...keys];
}

function folderPath(folderKey: unknown, folders: NamedRow[]) {
  const byKey = new Map(folders.map((folder) => [folder.key, folder]));
  const path: string[] = [];
  const visited = new Set<string>();
  let key = typeof folderKey === 'string' ? folderKey : undefined;
  while (key && !visited.has(key)) {
    visited.add(key);
    const folder = byKey.get(key);
    if (!folder) break;
    path.unshift(folder.name);
    key = typeof folder.parentFolderKey === 'string' ? folder.parentFolderKey : undefined;
  }
  return path;
}

function fullFile(row: NamedRow, folders: NamedRow[]) {
  const file = fileSchema.parse(row) as FileRecord;
  const extracted = file.extractedText ? boundedEvidence(file.extractedText) : undefined;
  const caption = file.caption ? boundedEvidence(file.caption) : undefined;
  return {
    name: file.name, extension: file.extension, mimeType: file.mimeType, sizeBytes: file.sizeBytes,
    processing: file.processing, isFavorite: file.isFavorite, isHidden: file.isHidden,
    createdAt: file.createdAt, updatedAt: file.updatedAt, folderPath: folderPath(file.folderKey, folders),
    ...(extracted ? { extractedText: extracted.text } : {}),
    ...(caption ? { caption: caption.text } : {}),
    ...(extracted?.truncated || caption?.truncated ? { textTruncated: true as const } : {}),
  };
}

function boundedEvidence(text: string) {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.length <= MAX_FILE_EVIDENCE_BYTES) return { text, truncated: false };
  let end = MAX_FILE_EVIDENCE_BYTES;
  while (end > 0 && (bytes[end]! & 0xc0) === 0x80) end -= 1;
  return { text: bytes.subarray(0, end).toString('utf8'), truncated: true };
}

async function candidatePreviews(context: ToolContext, keys: string[]) {
  const cursor = await db.query(`
    FOR row IN files
      FILTER row.userKey == @userKey && row.scopeKey == @scopeKey && row._key IN @keys && row.isHidden != true
      RETURN MERGE(KEEP(row, "_key", "name", "extension"), {
        extractedText: IS_STRING(row.extractedText) ? SUBSTRING(row.extractedText, 0, 1500) : null,
        caption: IS_STRING(row.caption) ? SUBSTRING(row.caption, 0, 1500) : null
      })
  `, { userKey: contextUserKey(context), scopeKey: context.runtimeScopeKey, keys });
  return (await cursor.all() as Record<string, unknown>[]).map((row) => withArangoKey(row) as NamedRow);
}

async function rerankCandidates(context: ToolContext, query: string, candidates: NamedRow[], signal?: AbortSignal) {
  if (candidates.length < 2) return candidates;
  try {
    const input = rerankInputSchema.parse({ query, documents: candidates.map((row) => `${row.name}.${row.extension ?? ''}: ${String(row.extractedText ?? row.caption ?? '').slice(0, 1_500)}`) });
    const response = await executeAction<typeof input, RerankOutput>(
      { mode: 'auto', teamKey: context.teamKey, actionSlug: 'rerank' }, input,
      { providers: ['rerank.primary'], timeoutMs: 12_000, signal, retry: { attempts: 1 } },
    );
    const { results } = rerankOutputSchema.parse(response.output);
    if (results.length !== candidates.length || new Set(results.map(({ index }) => index)).size !== candidates.length || results.some(({ index }) => index >= candidates.length)) throw new Error('Rerank returned incomplete candidate scores.');
    return [...results].sort((left, right) => right.relevanceScore - left.relevanceScore || left.index - right.index).map(({ index }) => candidates[index]!);
  } catch (error) {
    if (signal?.aborted || error instanceof SparkRepositoryError) throw error;
    console.warn('workspace rerank unavailable; using RRF order', { error });
    return candidates;
  }
}

export async function queryWorkspace(raw: unknown, context: ToolContext, dependencies: WorkspaceQueryDependencies = {}) {
  const input = agentQueryInputSchema.parse(raw);
  if (context.principal.kind !== 'member' || context.principal.user.key !== contextUserKey(context)) throw new Error('Active user required.');
  dependencies.signal?.throwIfAborted();
  const recent = input.includeRecentReferences || input.reference || input.folder?.recent
    ? await authorizedReferences(context, dependencies.recentMessages ?? [])
    : { entries: [] as AuthorizedReference[], truncated: false };
  const referenceOutput = input.includeRecentReferences ? {
    recentReferences: recent.entries.map(({ resource, row, messageOffset }) => ({ resource, name: row.name, ...(resource === 'files' ? { extension: fileSchema.parse(row).extension } : {}), messageOffset })),
    ...(recent.truncated ? { referencesTruncated: true } : {}),
  } : {};
  const folders = await ownedRows(context, 'folders');
  const selectedFolder = input.folder ? folderSelection(folders, input.folder, recent.entries) : undefined;
  if (input.folder && !selectedFolder) return agentQueryOutputSchema.parse(input.mode === 'count'
    ? { mode: 'count', field: input.field ?? 'files', status: 'partial', reason: 'The named or recent folder could not be resolved uniquely in this scope.', ...referenceOutput }
    : input.mode === 'list' ? { mode: 'list', files: [], nextCursor: null, status: 'partial', reason: 'The named or recent folder could not be resolved uniquely in this scope.', ...referenceOutput }
    : { mode: 'retrieve', limit: RESULT_LIMIT, files: [], status: 'partial', reason: 'The named or recent folder could not be resolved uniquely in this scope.', ...referenceOutput });
  const folderKeys = selectedFolder ? descendantFolderKeys(folders, selectedFolder.key) : undefined;

  if (input.mode === 'list') {
    const result = await listWorkspaceInventory({
      context, folderKey: selectedFolder?.key, folderKeys, extensions: input.extensions,
      cursor: input.cursor, nextPage: input.nextPage, conversationKey: dependencies.currentConversationKey,
      folderExists: (key) => folders.some((folder) => folder.key === key),
      descendants: (key) => descendantFolderKeys(folders, key),
      folderPath: (key) => folderPath(key, folders),
    });
    if (result.files.length) dependencies.onEvidence?.([appSearchRetrievalSchema.parse({ source: 'results', limit: 50, inventory: { ...(selectedFolder ? { folderKey: selectedFolder.key } : {}), ...(input.extensions ? { extensions: input.extensions } : {}) }, groups: [{ collectionSlug: 'files', results: result.files.map((file) => ({ key: file.key, label: file.name.slice(0, 200) })) }] })]);
    return agentQueryOutputSchema.parse({ mode: 'list', count: result.count, files: result.files.map(({ key: _key, ...file }) => file), nextCursor: result.nextCursor, status: result.status, ...(result.reason ? { reason: result.reason } : {}), ...referenceOutput });
  }

  if (input.mode === 'count') {
    const field = input.field ?? 'files';
    const expression = { files: '"files"', extension: 'row.extension', processing: 'row.processing', isFavorite: 'row.isFavorite' }[field];
    const binding = { userKey: contextUserKey(context), scopeKey: context.runtimeScopeKey, folderKeys: folderKeys ?? null, extensions: input.extensions ?? null };
    const filter = 'FILTER row.scopeKey == @scopeKey && row.userKey == @userKey && row.isHidden != true FILTER @folderKeys == null || row.folderKey IN @folderKeys FILTER @extensions == null || row.extension IN @extensions';
    const grouped = await (await db.query(`FOR row IN files ${filter} COLLECT value = ${expression} WITH COUNT INTO amount RETURN { value: TO_STRING(value), amount }`, binding)).all() as { value: string; amount: number }[];
    const count = grouped.reduce((sum, group) => sum + group.amount, 0);
    const directCount = selectedFolder ? Number(await (await db.query(`RETURN LENGTH(FOR row IN files ${filter} FILTER row.folderKey == @parentKey RETURN 1)`, { ...binding, parentKey: selectedFolder.key })).next() ?? 0) : undefined;
    return agentQueryOutputSchema.parse({ mode: 'count', field, status: 'complete', count, ...(directCount === undefined ? {} : { directCount, nestedCount: count - directCount }), ...(field === 'files' ? {} : { breakdown: Object.fromEntries(grouped.map(({ value, amount }) => [value, amount])) }), ...referenceOutput });
  }

  const limit = RESULT_LIMIT;
  let candidates: NamedRow[];
  if (input.reference) {
    const selected = input.reference.recent
      ? recentSelection(recent.entries, 'files')
      : recent.entries.filter((entry) => entry.resource === 'files' && normalized(entry.row.name) === normalized(input.reference!.name!)).map((entry) => entry.row).at(0) ?? null;
    candidates = selected ? await ownedRows(context, 'files', 'FILTER row._key == @key', { key: selected.key }, 1) : [];
  } else {
    const queryingChatFiles = Boolean(selectedFolder?.managedPurpose === 'conversation-root' || /\b(?:chats?|conversations?|transcripts?|chatten|chatt|chattar)\b/i.test(input.query!));
    const keys = await workspaceCandidateKeys(context, { query: input.query!, folderKeys, extensions: input.extensions, includeManaged: queryingChatFiles }, dependencies.signal);
    const previews = keys.length ? await candidatePreviews(context, keys) : [];
    const byKey = new Map(previews.map((row) => [row.key, row]));
    const fused = keys.flatMap((key) => byKey.get(key) ? [byKey.get(key)!] : []);
    const ranked = await rerankCandidates(context, input.query!, fused, dependencies.signal);
    const topKeys = ranked.slice(0, RESULT_LIMIT).map(({ key }) => key);
    const rows = topKeys.length ? await ownedRows(context, 'files', 'FILTER row._key IN @keys', { keys: topKeys }) : [];
    const fullByKey = new Map(rows.map((row) => [row.key, row]));
    candidates = topKeys.flatMap((key) => fullByKey.get(key) ? [fullByKey.get(key)!] : []);
  }
  if (folderKeys) candidates = candidates.filter((file) => typeof file.folderKey === 'string' && folderKeys.includes(file.folderKey));
  if (input.extensions) candidates = candidates.filter((file) => input.extensions!.includes(fileSchema.parse(file).extension));
  const selectedRows = candidates.slice(0, limit);
  const selected = selectedRows.map((row) => fullFile(row, folders));
  const files: ReturnType<typeof fullFile>[] = [];
  for (const file of selected) {
    const next = [...files, file];
    if (Buffer.byteLength(JSON.stringify({ mode: 'retrieve', limit, files: next, ...referenceOutput }), 'utf8') > MAX_RESULT_BYTES) break;
    files.push(file);
  }
  const status = files.length < selected.length || files.length < (input.minSources ?? 1) || files.some((file) => file.textTruncated) ? 'partial' : 'complete';
  const reason = files.length < selected.length ? 'The combined file evidence exceeds the model context budget.' : files.length < (input.minSources ?? 1) ? `At least ${input.minSources ?? 1} distinct readable sources were requested; the available evidence is insufficient.` : files.some((file) => file.textTruncated) ? 'Some file text was shortened to fit the evidence budget.' : undefined;
  const orderedNavigation = selectedRows.slice(0, files.length);
  if (orderedNavigation.length) {
    const groups = (['files'] as const).map((collectionSlug) => ({ collectionSlug, results: orderedNavigation.map((row) => ({ key: row.key, label: row.name.slice(0, 200) })) }));
    dependencies.onEvidence?.([appSearchRetrievalSchema.parse({ source: 'results', limit: 10, groups })]);
  }
  return agentQueryOutputSchema.parse({ mode: 'retrieve', limit, status, files, ...(reason ? { reason } : {}), ...referenceOutput });
}
