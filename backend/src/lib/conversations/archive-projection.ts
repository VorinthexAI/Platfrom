import { createHash } from 'node:crypto';
import { z } from 'zod';
import { chunkDocumentContent, documentEmbeddingTexts } from '@/lib/ai/document-processing/chunking';
import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { FILES_COLLECTION, fileStorageKey, type FileRecord } from '@/lib/db/files.node';
import { FOLDERS_COLLECTION, type Folder } from '@/lib/db/folders.node';
import { STORAGE_DELETION_JOBS_COLLECTION } from '@/lib/db/storage-deletion-jobs.node';
import { conversationMessageSchema, conversationSchema, type Conversation, type ConversationMessage } from './schemas';

export const CONVERSATION_ARCHIVE_STATES_COLLECTION = 'conversationArchiveStates';
export const CONVERSATION_ARCHIVE_NAMESPACE = 'conversation-archive-v1';
export const CONVERSATION_ARCHIVE_SUMMARY_MAX_CHARACTERS = 4_000;
export const CONVERSATION_ARCHIVE_SUMMARY_MAX_WORDS = 500;
export const CONVERSATION_ARCHIVE_SUMMARY_INPUT_CHARACTERS = 12_000;

export type ConversationArchiveFolderPurpose = 'conversation-root' | 'conversation' | 'conversation-summaries';
export type ConversationArchiveFilePurpose = 'conversation-transcript' | 'conversation-summary';

export type ConversationArchiveFolder = Folder & {
  managedPurpose: ConversationArchiveFolderPurpose;
  managedOwnerKey: string;
};

export type ConversationArchiveFile = FileRecord & {
  managedPurpose: ConversationArchiveFilePurpose;
  managedOwnerKey: string;
  extractedText: string;
  contentChunks: string[];
  chunkEmbeddings: number[][];
};

const ownerSchema = z.object({
  conversationKey: z.string().cuid(), teamKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(),
  userKey: z.string().cuid(), actorKey: z.string().cuid(),
}).strict();
export type ConversationArchiveOwner = z.infer<typeof ownerSchema>;

export const conversationArchiveStateSchema = ownerSchema.extend({
  key: z.string().cuid(), desiredRevision: z.number().int().positive(), projectedRevision: z.number().int().nonnegative(),
  createdAt: z.string().datetime(), updatedAt: z.string().datetime(), lastProjectedAt: z.string().datetime().optional(),
}).strict();
export type ConversationArchiveState = z.infer<typeof conversationArchiveStateSchema>;

export interface ConversationArchiveSnapshot {
  state: ConversationArchiveState;
  conversation: Conversation;
  messages: ConversationMessage[];
  existing: { folders: ConversationArchiveFolder[]; files: ConversationArchiveFile[] };
}

export interface PreparedConversationArchiveProjection {
  folders: ConversationArchiveFolder[];
  files: ConversationArchiveFile[];
}

export type ConversationArchiveSnapshotResult =
  | { status: 'ready'; snapshot: ConversationArchiveSnapshot }
  | { status: 'missing-source'; state: ConversationArchiveState }
  | { status: 'stale' };
export type ConversationArchiveCommitResult = { status: 'committed'; projectedRevision: number } | { status: 'stale' };

export interface ConversationArchiveProjectionRepository {
  readSnapshot(owner: ConversationArchiveOwner, desiredRevision: number): Promise<ConversationArchiveSnapshotResult>;
  commit(snapshot: ConversationArchiveSnapshot, projection: PreparedConversationArchiveProjection, now: string): Promise<ConversationArchiveCommitResult>;
  deleteMissingSource(owner: ConversationArchiveOwner, desiredRevision: number): Promise<'deleted' | 'stale'>;
  deleteProjected(owner: Pick<ConversationArchiveOwner, 'conversationKey' | 'scopeKey' | 'userKey'>): Promise<void>;
  listPending(limit?: number): Promise<ConversationArchiveState[]>;
}

export function conversationArchiveKey(...parts: Array<string | number>): string {
  return `c${createHash('sha256').update([CONVERSATION_ARCHIVE_NAMESPACE, ...parts.map(String)].join('\0')).digest('hex').slice(0, 24)}`;
}

export function conversationArchiveKeys(owner: Pick<ConversationArchiveOwner, 'scopeKey' | 'userKey' | 'conversationKey'>) {
  const rootFolderKey = conversationArchiveKey('folder', owner.scopeKey, owner.userKey, 'chats');
  const conversationFolderKey = conversationArchiveKey('folder', owner.scopeKey, owner.userKey, owner.conversationKey);
  return {
    rootFolderKey,
    conversationFolderKey,
    summariesFolderKey: conversationArchiveKey('folder', owner.scopeKey, owner.userKey, owner.conversationKey, 'summaries'),
    transcriptFileKey: conversationArchiveKey('file', owner.scopeKey, owner.userKey, owner.conversationKey, 'transcript'),
    summaryFileKey: conversationArchiveKey('file', owner.scopeKey, owner.userKey, owner.conversationKey, 'current-summary'),
    summaryDocumentKey: conversationArchiveKey('file', owner.scopeKey, owner.userKey, owner.conversationKey, 'current-summary'),
  };
}

export function conversationArchiveTranscriptName(name: string): string {
  return `${name.trim().slice(0, 10)}...`;
}

export function formatConversationArchiveTimestamp(value: string): string {
  const date = new Date(z.string().datetime().parse(value));
  return `${date.toISOString().replace('T', ' ').replace('Z', '')} UTC`;
}

export function conversationArchiveMessageContent(message: ConversationMessage): string {
  if (message.type === 'IMAGE' && message.role === 'ASSISTANT') {
    if (!message.imageSummaryText) throw new Error('Completed assistant image messages require summary text for chat file projection.');
    return message.imageSummaryText;
  }
  return message.content;
}

export const conversationArchiveSummaryRequestSchema = z.object({
  instruction: z.string().trim().min(1).max(1_200),
  source: z.string().trim().min(1).max(CONVERSATION_ARCHIVE_SUMMARY_INPUT_CHARACTERS),
  maxOutputCharacters: z.literal(CONVERSATION_ARCHIVE_SUMMARY_MAX_CHARACTERS),
}).strict();
export type ConversationArchiveSummaryRequest = z.infer<typeof conversationArchiveSummaryRequestSchema>;
export type ConversationArchiveAsk = (request: ConversationArchiveSummaryRequest, context: { teamKey: string; signal?: AbortSignal }) => Promise<string>;

function boundedSummary(value: string): string {
  const plain = z.string().trim().min(1).max(20_000).parse(value)
    .replace(/^```(?:text|markdown)?\s*/i, '').replace(/\s*```$/, '').trim();
  const words = plain.split(/\s+/);
  if (plain.length <= CONVERSATION_ARCHIVE_SUMMARY_MAX_CHARACTERS && words.length <= CONVERSATION_ARCHIVE_SUMMARY_MAX_WORDS) return plain;
  let bounded = words.slice(0, CONVERSATION_ARCHIVE_SUMMARY_MAX_WORDS).join(' ');
  if (bounded.length > CONVERSATION_ARCHIVE_SUMMARY_MAX_CHARACTERS) bounded = bounded.slice(0, CONVERSATION_ARCHIVE_SUMMARY_MAX_CHARACTERS).replace(/\s+\S*$/, '').trim();
  return bounded.replace(/[,:;\-]+$/, '').trim();
}

function transcriptEntries(messages: readonly ConversationMessage[]): string[] {
  return messages.map((message) => `${formatConversationArchiveTimestamp(message.completedAt ?? message.createdAt)} | ${message.role === 'USER' ? 'User' : 'Core'}\n${conversationArchiveMessageContent(message)}`);
}

function packSummaryInputs(values: readonly string[]): string[] {
  const groups: string[] = [];
  for (const value of values) {
    const pieces = value.length <= CONVERSATION_ARCHIVE_SUMMARY_INPUT_CHARACTERS
      ? [value]
      : Array.from({ length: Math.ceil(value.length / CONVERSATION_ARCHIVE_SUMMARY_INPUT_CHARACTERS) }, (_, index) => value.slice(index * CONVERSATION_ARCHIVE_SUMMARY_INPUT_CHARACTERS, (index + 1) * CONVERSATION_ARCHIVE_SUMMARY_INPUT_CHARACTERS));
    for (const piece of pieces) {
      const previous = groups.at(-1);
      if (previous && previous.length + piece.length + 2 <= CONVERSATION_ARCHIVE_SUMMARY_INPUT_CHARACTERS) groups[groups.length - 1] = `${previous}\n\n${piece}`;
      else groups.push(piece);
    }
  }
  return groups;
}

/** Summarizes only the supplied authoritative messages, recursively bounding every provider call. */
export async function summarizeConversationArchive(messages: readonly ConversationMessage[], teamKey: string, ask: ConversationArchiveAsk, signal?: AbortSignal): Promise<string> {
  const completed = messages.filter((message) => message.status === 'COMPLETED');
  if (!completed.length) throw new Error('A conversation summary requires at least one completed message.');
  const latestUser = [...completed].reverse().find((message) => message.role === 'USER');
  if (!latestUser) throw new Error('A conversation summary requires a completed user message.');
  const languageAnchor = conversationArchiveMessageContent(latestUser).slice(0, 1_000);
  let sources = packSummaryInputs(transcriptEntries(completed));
  let round = 0;
  while (true) {
    const summaries: string[] = [];
    for (const source of sources) {
      const request = conversationArchiveSummaryRequestSchema.parse({
        instruction: `Write a detailed rolling recap in plain prose: facts, decisions, open requests, outcomes, and important names or numbers. Stay compact — no headings, bullets, markdown, filler, or anything absent from the source. Write in the same language as this latest User excerpt: ${JSON.stringify(languageAnchor)}. ${sources.length > 1 || round > 0 ? 'This is one segment; preserve details needed for a later combined summary.' : 'Return the final rolling conversation summary.'}`,
        source,
        maxOutputCharacters: CONVERSATION_ARCHIVE_SUMMARY_MAX_CHARACTERS,
      });
      summaries.push(boundedSummary(await ask(request, { teamKey, signal })));
    }
    if (summaries.length === 1) return summaries[0]!;
    const next = packSummaryInputs(summaries);
    sources = next.length < sources.length ? next : packSummaryInputs(summaries.map((summary) => summary.slice(0, Math.floor(CONVERSATION_ARCHIVE_SUMMARY_INPUT_CHARACTERS / 2))));
    round += 1;
    if (round > 20) throw new Error('Conversation summary reduction did not converge.');
  }
}

const sameFields = (record: object | undefined, fields: Record<string, unknown>) => Boolean(record) && Object.entries(fields).every(([key, value]) => JSON.stringify((record as Record<string, unknown>)[key]) === JSON.stringify(value));

function asArchiveFolder(value: Record<string, unknown>): ConversationArchiveFolder {
  return value as ConversationArchiveFolder;
}

function asArchiveFile(value: Record<string, unknown>): ConversationArchiveFile {
  return value as ConversationArchiveFile;
}

export async function prepareConversationArchiveProjection(snapshot: ConversationArchiveSnapshot, summary: string | null, dependencies: {
  embedTexts: (texts: string[], signal?: AbortSignal) => Promise<number[][]>;
  now?: () => string;
  signal?: AbortSignal;
}): Promise<PreparedConversationArchiveProjection> {
  const { conversation, state } = snapshot;
  const keys = conversationArchiveKeys(state);
  const now = (dependencies.now ?? (() => new Date().toISOString()))();
  const existingFolders = new Map(snapshot.existing.folders.map((folder) => [folder.key, folder]));
  const existingFiles = new Map(snapshot.existing.files.map((file) => [file.key, file]));
  const folderSpecs: Array<{ key: string; parentFolderKey?: string; name: string; managedPurpose: ConversationArchiveFolderPurpose; managedOwnerKey: string }> = [
    { key: keys.rootFolderKey, name: 'Chats', managedPurpose: 'conversation-root', managedOwnerKey: state.userKey },
    { key: keys.conversationFolderKey, parentFolderKey: keys.rootFolderKey, name: conversation.name, managedPurpose: 'conversation', managedOwnerKey: conversation.key },
    { key: keys.summariesFolderKey, parentFolderKey: keys.conversationFolderKey, name: 'Summaries', managedPurpose: 'conversation-summaries', managedOwnerKey: conversation.key },
  ];
  const folders: ConversationArchiveFolder[] = [];
  const pendingFolderSpecs: Array<(typeof folderSpecs)[number] & { previous?: ConversationArchiveFolder }> = [];
  for (const spec of folderSpecs) {
    const previous = existingFolders.get(spec.key);
    if (previous && (spec.managedPurpose !== 'conversation' || previous.name === spec.name) && previous.embedding.length) folders.push(previous);
    else pendingFolderSpecs.push({ ...spec, parentFolderKey: previous?.parentFolderKey ?? spec.parentFolderKey, previous });
  }

  const completed = snapshot.messages.filter((message) => message.status === 'COMPLETED');
  const transcript = completed.length ? transcriptEntries(completed).join('\n\n') : '';
  const fileSpecs: Array<{ key: string; folderKey: string; name: string; content: string; managedPurpose: ConversationArchiveFilePurpose; managedOwnerKey: string }> = [];
  if (transcript) fileSpecs.push({ key: keys.transcriptFileKey, folderKey: keys.conversationFolderKey, name: conversationArchiveTranscriptName(conversation.name), content: transcript, managedPurpose: 'conversation-transcript', managedOwnerKey: conversation.key });
  if (summary !== null) fileSpecs.push({ key: keys.summaryFileKey, folderKey: keys.summariesFolderKey, name: 'Current summary', content: boundedSummary(summary), managedPurpose: 'conversation-summary', managedOwnerKey: conversation.key });

  const files: ConversationArchiveFile[] = [];
  const pendingFiles: Array<(typeof fileSpecs)[number] & { chunks: string[]; previous?: ConversationArchiveFile }> = [];
  for (const spec of fileSpecs) {
    const previous = existingFiles.get(spec.key);
    const chunks = chunkDocumentContent(spec.content);
    const fields = { name: spec.name, extractedText: spec.content, contentChunks: chunks };
    if (previous && sameFields(previous, fields) && previous.chunkEmbeddings.length === chunks.length && previous.embedding.length) files.push(previous);
    else pendingFiles.push({ ...spec, folderKey: previous?.folderKey ?? spec.folderKey, chunks, previous });
  }

  const embeddingInputs = [
    ...pendingFolderSpecs.map((spec) => spec.name),
    ...pendingFiles.flatMap((spec) => documentEmbeddingTexts(spec.name, spec.chunks)),
  ];
  const embeddings = embeddingInputs.length ? await dependencies.embedTexts(embeddingInputs, dependencies.signal) : [];
  if (embeddings.length !== embeddingInputs.length || embeddings.some((embedding) => !embedding.length || embedding.some((value) => !Number.isFinite(value)))) throw new Error('Chat file projection embedding output is not aligned with its inputs.');
  let offset = 0;
  for (const spec of pendingFolderSpecs) {
    const previous = spec.previous;
    folders.push({
      ...(previous ?? { isFavorite: false, isHidden: false }),
      key: spec.key, userKey: state.userKey, scopeKey: state.scopeKey, name: spec.name,
      managedPurpose: spec.managedPurpose, managedOwnerKey: spec.managedOwnerKey,
      isFavorite: previous?.isFavorite ?? false, isHidden: previous?.isHidden ?? false,
      embedding: embeddings[offset++]!, createdAt: previous?.createdAt ?? now, updatedAt: now,
      ...(spec.parentFolderKey ? { parentFolderKey: spec.parentFolderKey } : {}),
    });
  }
  for (const spec of pendingFiles) {
    const previous = spec.previous;
    const chunkEmbeddings = embeddings.slice(offset, offset + spec.chunks.length); offset += spec.chunks.length;
    const sizeBytes = Buffer.byteLength(spec.content, 'utf8');
    files.push({
      ...(previous ?? { isFavorite: false, isHidden: false }),
      key: spec.key, userKey: state.userKey, scopeKey: state.scopeKey, folderKey: spec.folderKey,
      name: spec.name, extension: 'md', mimeType: 'text/markdown', sizeBytes,
      storageKey: previous?.storageKey ?? fileStorageKey(state.userKey, spec.key, 'md'),
      extractedText: spec.content, contentChunks: spec.chunks, processing: 'ready',
      managedPurpose: spec.managedPurpose, managedOwnerKey: spec.managedOwnerKey,
      isFavorite: previous?.isFavorite ?? false, isHidden: previous?.isHidden ?? false,
      embedding: chunkEmbeddings[0]!, chunkEmbeddings, createdAt: previous?.createdAt ?? now, updatedAt: now,
    } as ConversationArchiveFile);
  }
  return {
    folders: folderSpecs.map(({ key }) => folders.find((folder) => folder.key === key)!),
    files: fileSpecs.map(({ key }) => files.find((file) => file.key === key)!),
  };
}

interface ArchiveDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<{ next(): Promise<unknown>; all(): Promise<unknown[]> }> }
type ArchiveTransaction = <T>(operation: (database: ArchiveDatabase) => Promise<T>) => Promise<T>;
const parseState = (value: unknown) => conversationArchiveStateSchema.parse(withArangoKey(value as Record<string, unknown>));

async function removeProjectedFiles(database: ArchiveDatabase, owner: Pick<ConversationArchiveOwner, 'scopeKey' | 'userKey' | 'conversationKey'>, now: string) {
  const keys = conversationArchiveKeys(owner);
  const folderKeys = [keys.conversationFolderKey, keys.summariesFolderKey];
  await database.query(`
    LET files = (FOR file IN @@files FILTER file.scopeKey == @scopeKey && file.userKey == @userKey && (file._key IN @fileKeys || file.folderKey IN @folderKeys) RETURN file)
    LET queued = (FOR file IN files FILTER IS_STRING(file.storageKey) && LENGTH(file.storageKey) > 0 UPSERT { storageKey: file.storageKey } INSERT { storageKey: file.storageKey, createdAt: @now, status: "pending" } UPDATE {} IN @@storageJobs RETURN 1)
    LET removed = (FOR file IN files REMOVE file IN @@files RETURN 1)
    RETURN true
  `, { '@files': FILES_COLLECTION, '@storageJobs': STORAGE_DELETION_JOBS_COLLECTION, scopeKey: owner.scopeKey, userKey: owner.userKey, fileKeys: [keys.transcriptFileKey, keys.summaryFileKey], folderKeys, now });
  await database.query('FOR folderKey IN @keys LET folder = DOCUMENT(@@folders, folderKey) FILTER folder != null && folder.userKey == @userKey && folder.managedPurpose IN ["conversation", "conversation-summaries"] REMOVE folder IN @@folders', { '@folders': FOLDERS_COLLECTION, keys: [keys.summariesFolderKey, keys.conversationFolderKey], userKey: owner.userKey });
  await database.query('LET root = DOCUMENT(@@folders, @rootFolderKey) FILTER root != null && root.scopeKey == @scopeKey && root.userKey == @userKey && root.managedPurpose == "conversation-root" && root.managedOwnerKey == @userKey LET remaining = FIRST(FOR folder IN @@folders FILTER folder.parentFolderKey == root._key && folder.scopeKey == @scopeKey && folder.userKey == @userKey && folder.managedPurpose == "conversation" LIMIT 1 RETURN 1) FILTER remaining == null REMOVE root IN @@folders', { '@folders': FOLDERS_COLLECTION, rootFolderKey: keys.rootFolderKey, scopeKey: owner.scopeKey, userKey: owner.userKey });
}

export function createConversationArchiveProjectionRepository(database: ArchiveDatabase = db as unknown as ArchiveDatabase, transaction?: ArchiveTransaction): ConversationArchiveProjectionRepository {
  const transact = transaction ?? (database === db as unknown as ArchiveDatabase
    ? (operation) => withTransaction({ read: ['conversations', 'conversationMessages'], write: [CONVERSATION_ARCHIVE_STATES_COLLECTION, FOLDERS_COLLECTION, FILES_COLLECTION, STORAGE_DELETION_JOBS_COLLECTION], exclusive: [] }, (trx) => operation(trx as unknown as ArchiveDatabase))
    : (operation) => operation(database));
  const binding = (alias: string) => `${alias}.conversationKey == @conversationKey && ${alias}.teamKey == @teamKey && ${alias}.scopeKey == @scopeKey && ${alias}.userKey == @userKey && ${alias}.actorKey == @actorKey`;
  const ownerBindings = ({ conversationKey, teamKey, scopeKey, userKey, actorKey }: ConversationArchiveOwner) => ({ conversationKey, teamKey, scopeKey, userKey, actorKey });
  const conversationBindings = ({ conversationKey, teamKey, scopeKey, userKey }: ConversationArchiveOwner) => ({ conversationKey, teamKey, scopeKey, userKey });
  return {
    async readSnapshot(owner, desiredRevision) {
      const input = ownerSchema.parse(owner);
      const cursor = await database.query(`LET state = FIRST(FOR value IN @@states FILTER value.desiredRevision == @desiredRevision && ${binding('value')} LIMIT 1 RETURN value) FILTER state != null LET conversation = DOCUMENT(@@conversations, @conversationKey) LET ownedConversation = conversation != null && conversation.teamKey == @teamKey && conversation.scopeKey == @scopeKey && conversation.userKey == @userKey ? conversation : null LET messages = ownedConversation == null ? [] : (FOR message IN @@messages FILTER message.conversationKey == conversation._key && message.teamKey == @teamKey && message.scopeKey == @scopeKey && message.userKey == @userKey && message.status == "COMPLETED" SORT message.createdAt ASC, message.turnKey ASC, message.role DESC, message._key ASC RETURN message) RETURN { state, conversation: ownedConversation, messages }`, { '@states': CONVERSATION_ARCHIVE_STATES_COLLECTION, '@conversations': 'conversations', '@messages': 'conversationMessages', ...input, desiredRevision });
      const row = await cursor.next() as { state: Record<string, unknown>; conversation: Record<string, unknown> | null; messages: Record<string, unknown>[] } | undefined;
      if (!row) return { status: 'stale' };
      const state = parseState(row.state);
      if (!row.conversation) return { status: 'missing-source', state };
      const conversation = conversationSchema.parse(withArangoKey(row.conversation));
      const keys = conversationArchiveKeys(input);
      const existingCursor = await database.query('LET folders = (FOR value IN @@folders FILTER value._key IN @folderKeys RETURN value) LET files = (FOR value IN @@files FILTER value._key IN @fileKeys RETURN value) RETURN { folders, files }', { '@folders': FOLDERS_COLLECTION, '@files': FILES_COLLECTION, folderKeys: [keys.rootFolderKey, keys.conversationFolderKey, keys.summariesFolderKey], fileKeys: [keys.transcriptFileKey, keys.summaryFileKey] });
      const existing = await existingCursor.next() as { folders: Record<string, unknown>[]; files: Record<string, unknown>[] } | undefined;
      return { status: 'ready', snapshot: { state, conversation, messages: row.messages.map((message) => conversationMessageSchema.parse(withArangoKey(message))), existing: { folders: (existing?.folders ?? []).map((value) => asArchiveFolder(withArangoKey(value))), files: (existing?.files ?? []).map((value) => asArchiveFile(withArangoKey(value))) } } };
    },
    async commit(snapshot, projection, now) {
      return transact(async (executor) => {
        const state = snapshot.state;
        const current = await (await executor.query(`FOR value IN @@states FILTER value._key == @key && value.desiredRevision == @revision && ${binding('value')} LIMIT 1 RETURN value`, { '@states': CONVERSATION_ARCHIVE_STATES_COLLECTION, ...ownerBindings(state), key: state.key, revision: state.desiredRevision })).next();
        if (!current) return { status: 'stale' as const };
        const source = await (await executor.query('FOR value IN @@conversations FILTER value._key == @conversationKey && value.teamKey == @teamKey && value.scopeKey == @scopeKey && value.userKey == @userKey LIMIT 1 RETURN true', { '@conversations': 'conversations', ...conversationBindings(state) })).next();
        if (!source) return { status: 'stale' as const };
        const folderConflicts = await (await executor.query('FOR value IN @@folders FILTER value._key IN @keys LET desired = FIRST(FOR item IN @desired FILTER item.key == value._key RETURN item) FILTER !(value.userKey == @userKey && value.managedPurpose == desired.managedPurpose && value.managedOwnerKey == desired.managedOwnerKey) RETURN value._key', { '@folders': FOLDERS_COLLECTION, keys: projection.folders.map(({ key }) => key), desired: projection.folders.map(({ key, managedPurpose, managedOwnerKey }) => ({ key, managedPurpose, managedOwnerKey })), userKey: state.userKey })).all();
        const fileConflicts = await (await executor.query('FOR value IN @@files FILTER value._key IN @keys LET desired = FIRST(FOR item IN @desired FILTER item.key == value._key RETURN item) FILTER !(value.userKey == @userKey && value.managedPurpose == desired.managedPurpose && value.managedOwnerKey == desired.managedOwnerKey) RETURN value._key', { '@files': FILES_COLLECTION, keys: projection.files.map(({ key }) => key), desired: projection.files.map(({ key, managedPurpose, managedOwnerKey }) => ({ key, managedPurpose, managedOwnerKey })), userKey: state.userKey })).all();
        if (folderConflicts.length || fileConflicts.length) throw new Error(`Chat file projection deterministic keys conflict with non-owned resources: ${[...folderConflicts, ...fileConflicts].join(', ')}`);
        await executor.query('FOR value IN @values UPSERT { _key: value._key } INSERT value REPLACE value IN @@folders', { '@folders': FOLDERS_COLLECTION, values: projection.folders.map((value) => toArangoDoc(value as unknown as Record<string, unknown> & { key: string })) });
        await executor.query('FOR value IN @values UPSERT { _key: value._key } INSERT value REPLACE value IN @@files', { '@files': FILES_COLLECTION, values: projection.files.map((value) => toArangoDoc(value as unknown as Record<string, unknown> & { key: string })) });
        const desiredFileKeys = projection.files.map(({ key }) => key);
        await executor.query('FOR file IN @@files FILTER file.userKey == @userKey && file.managedPurpose IN ["conversation-transcript", "conversation-summary"] && file.managedOwnerKey == @conversationKey && file._key NOT IN @desiredKeys LET queued = (UPSERT { storageKey: file.storageKey } INSERT { storageKey: file.storageKey, createdAt: @now, status: "pending" } UPDATE {} IN @@storageJobs RETURN 1) REMOVE file IN @@files', { '@files': FILES_COLLECTION, '@storageJobs': STORAGE_DELETION_JOBS_COLLECTION, userKey: state.userKey, conversationKey: state.conversationKey, desiredKeys: desiredFileKeys, now });
        const advanced = await (await executor.query(`FOR value IN @@states FILTER value._key == @key && value.desiredRevision == @revision && ${binding('value')} UPDATE value WITH { projectedRevision: @revision, lastProjectedAt: @now, updatedAt: @now } IN @@states RETURN true`, { '@states': CONVERSATION_ARCHIVE_STATES_COLLECTION, ...ownerBindings(state), key: state.key, revision: state.desiredRevision, now })).next();
        if (!advanced) throw new Error('Chat file projection revision fence was lost during commit.');
        return { status: 'committed' as const, projectedRevision: state.desiredRevision };
      });
    },
    async deleteMissingSource(owner, desiredRevision) {
      const input = ownerSchema.parse(owner);
      const state = await (await database.query(`FOR value IN @@states FILTER value.desiredRevision == @desiredRevision && ${binding('value')} LIMIT 1 RETURN value`, { '@states': CONVERSATION_ARCHIVE_STATES_COLLECTION, ...input, desiredRevision })).next();
      if (!state) return 'stale';
      const source = await (await database.query('FOR value IN @@conversations FILTER value._key == @conversationKey && value.teamKey == @teamKey && value.scopeKey == @scopeKey && value.userKey == @userKey LIMIT 1 RETURN true', { '@conversations': 'conversations', ...conversationBindings(input) })).next();
      if (source) return 'stale';
      await removeProjectedFiles(database, input, new Date().toISOString());
      await database.query('REMOVE @key IN @@states', { '@states': CONVERSATION_ARCHIVE_STATES_COLLECTION, key: (state as Record<string, unknown>)._key });
      return 'deleted';
    },
    async deleteProjected(owner) {
      await removeProjectedFiles(database, owner, new Date().toISOString());
      await database.query('LET state = DOCUMENT(@@states, @key) FILTER state != null && state.userKey == @userKey REMOVE state IN @@states', { '@states': CONVERSATION_ARCHIVE_STATES_COLLECTION, key: owner.conversationKey, userKey: owner.userKey });
    },
    async listPending(limit = 1_000) {
      const bounded = z.number().int().min(1).max(10_000).parse(limit);
      const cursor = await database.query('FOR value IN @@states LET conversation = DOCUMENT(@@conversations, value.conversationKey) FILTER conversation == null || value.projectedRevision < value.desiredRevision || conversation.updatedAt > value.updatedAt LET pending = conversation != null && conversation.updatedAt > value.updatedAt ? FIRST(UPDATE value WITH { desiredRevision: value.desiredRevision + 1, updatedAt: conversation.updatedAt } IN @@states RETURN NEW) : value SORT pending.updatedAt ASC, pending._key ASC LIMIT @limit RETURN pending', { '@states': CONVERSATION_ARCHIVE_STATES_COLLECTION, '@conversations': 'conversations', limit: bounded });
      return (await cursor.all()).map(parseState);
    },
  };
}
