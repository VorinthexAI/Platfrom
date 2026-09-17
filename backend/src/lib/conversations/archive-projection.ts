import { createHash } from 'node:crypto';
import { z } from 'zod';
import { chunkDocumentContent, documentEmbeddingTexts, documentSemanticHash } from '@/lib/ai/document-processing/chunking';
import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { initialWorkspaceFolderKey } from '@/lib/initial-workspace-content-identifiers';
import { conversationMessageSchema, conversationSchema, type Conversation, type ConversationMessage } from './schemas';

export const CONVERSATION_ARCHIVE_STATES_COLLECTION = 'conversationArchiveStates';
export const CONVERSATION_ARCHIVE_NAMESPACE = 'conversation-archive-v1';
export const CONVERSATION_ARCHIVE_SUMMARY_MAX_CHARACTERS = 4_000;
export const CONVERSATION_ARCHIVE_SUMMARY_MAX_WORDS = 500;
export const CONVERSATION_ARCHIVE_SUMMARY_INPUT_CHARACTERS = 12_000;

export type ConversationArchiveFolderPurpose = 'conversation-root' | 'conversation' | 'conversation-summaries';
export type ConversationArchiveDocumentPurpose = 'conversation-message' | 'conversation-summary';

export interface ConversationArchiveFolder {
  key: string;
  scopeKey: string;
  parentFolderKey?: string;
  name: string;
  embedding: number[];
  managedPurpose: ConversationArchiveFolderPurpose;
  managedOwnerKey: string;
  privateOwnerUserKey: string;
  mutationPolicy: 'user' | 'system-container';
  archiveVisibility: 'visible';
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationArchiveDocument {
  key: string;
  scopeKey: string;
  folderKey: string;
  name: string;
  content: string;
  embedding: number[];
  contentChunks: string[];
  chunkEmbeddings: number[][];
  semanticChunkCount: number;
  semanticContentHash: string;
  managedPurpose: ConversationArchiveDocumentPurpose;
  managedOwnerKey: string;
  privateOwnerUserKey: string;
  mutationPolicy: 'user' | 'system-only';
  archiveVisibility: 'visible';
  isFavorite: boolean;
  createdAt: string;
  updatedAt: string;
}

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
  /** Authoritative, completed messages in stable chronological order. */
  messages: ConversationMessage[];
  existing: { folders: ConversationArchiveFolder[]; documents: ConversationArchiveDocument[] };
}

export interface PreparedConversationArchiveProjection {
  folders: ConversationArchiveFolder[];
  documents: ConversationArchiveDocument[];
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
    summaryDocumentKey: conversationArchiveKey('document', owner.scopeKey, owner.userKey, owner.conversationKey, 'current-summary'),
    messageDocumentKey: (messageKey: string) => conversationArchiveKey('document', owner.scopeKey, owner.userKey, owner.conversationKey, 'message', messageKey),
  };
}

export function formatConversationArchiveTimestamp(value: string): string {
  const date = new Date(z.string().datetime().parse(value));
  return `${date.toISOString().replace('T', ' ').replace('Z', '')} UTC`;
}

export function conversationArchiveMessageContent(message: ConversationMessage): string {
  if (message.type === 'IMAGE' && message.role === 'ASSISTANT') {
    if (!message.imageSummaryText) throw new Error('Completed assistant image messages require summary text for Archive projection.');
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
        instruction: `Write plain concise prose summarizing facts, decisions, requests, and outcomes. Do not add headings, bullets, markdown, or information absent from the source. Write in the same language as this latest User excerpt: ${JSON.stringify(languageAnchor)}. ${sources.length > 1 || round > 0 ? 'This is one segment; preserve details needed for a later combined summary.' : 'Return the final rolling conversation summary.'}`,
        source,
        maxOutputCharacters: CONVERSATION_ARCHIVE_SUMMARY_MAX_CHARACTERS,
      });
      summaries.push(boundedSummary(await ask(request, { teamKey, signal })));
    }
    if (summaries.length === 1) return summaries[0]!;
    const next = packSummaryInputs(summaries);
    // Each summary is bounded, so recursive packing must eventually reduce the set.
    sources = next.length < sources.length ? next : packSummaryInputs(summaries.map((summary) => summary.slice(0, Math.floor(CONVERSATION_ARCHIVE_SUMMARY_INPUT_CHARACTERS / 2))));
    round += 1;
    if (round > 20) throw new Error('Conversation summary reduction did not converge.');
  }
}

const sameFields = (record: object | undefined, fields: Record<string, unknown>) => Boolean(record) && Object.entries(fields).every(([key, value]) => JSON.stringify((record as Record<string, unknown>)[key]) === JSON.stringify(value));

export async function prepareConversationArchiveProjection(snapshot: ConversationArchiveSnapshot, summary: string | null, dependencies: {
  embedTexts: (texts: string[], signal?: AbortSignal) => Promise<number[][]>;
  now?: () => string;
  signal?: AbortSignal;
}): Promise<PreparedConversationArchiveProjection> {
  const { conversation, state } = snapshot;
  const keys = conversationArchiveKeys(state);
  const now = (dependencies.now ?? (() => new Date().toISOString()))();
  const existingFolders = new Map(snapshot.existing.folders.map((folder) => [folder.key, folder]));
  const existingDocuments = new Map(snapshot.existing.documents.map((document) => [document.key, document]));
  const folderSpecs = [
    { key: keys.rootFolderKey, parentFolderKey: initialWorkspaceFolderKey(state.scopeKey, 'assistant'), name: 'Chats', managedPurpose: 'conversation-root' as const, managedOwnerKey: state.userKey },
    { key: keys.conversationFolderKey, parentFolderKey: keys.rootFolderKey, name: conversation.name, managedPurpose: 'conversation' as const, managedOwnerKey: conversation.key },
    { key: keys.summariesFolderKey, parentFolderKey: keys.conversationFolderKey, name: 'Summaries', managedPurpose: 'conversation-summaries' as const, managedOwnerKey: conversation.key },
  ];
  const folders: ConversationArchiveFolder[] = [];
  const pendingFolderSpecs: Array<Omit<(typeof folderSpecs)[number], 'parentFolderKey'> & { parentFolderKey?: string; previous?: ConversationArchiveFolder }> = [];
  for (const spec of folderSpecs) {
    const previous = existingFolders.get(spec.key);
    if (previous && (spec.managedPurpose !== 'conversation' || previous.name === spec.name) && previous.embedding.length) folders.push(previous);
    else pendingFolderSpecs.push({ ...spec, parentFolderKey: previous ? previous.parentFolderKey : spec.parentFolderKey, previous });
  }

  const documentSpecs: Array<{ key: string; folderKey: string; name: string; content: string; managedPurpose: ConversationArchiveDocumentPurpose; managedOwnerKey: string }> = snapshot.messages.filter((message) => message.status === 'COMPLETED').map((message) => ({
    key: keys.messageDocumentKey(message.key), folderKey: keys.conversationFolderKey,
    name: `${formatConversationArchiveTimestamp(message.completedAt ?? message.createdAt)} - ${message.role === 'USER' ? 'User' : 'Core'}`,
    content: conversationArchiveMessageContent(message), managedPurpose: 'conversation-message' as const, managedOwnerKey: message.key,
  }));
  if (summary !== null) documentSpecs.push({ key: keys.summaryDocumentKey, folderKey: keys.summariesFolderKey, name: 'Current summary', content: boundedSummary(summary), managedPurpose: 'conversation-summary', managedOwnerKey: conversation.key });

  const documents: ConversationArchiveDocument[] = [];
  const pendingDocuments: Array<(typeof documentSpecs)[number] & { chunks: string[]; previous?: ConversationArchiveDocument }> = [];
  for (const spec of documentSpecs) {
    const previous = existingDocuments.get(spec.key);
    if (spec.managedPurpose === 'conversation-message' && previous) {
      documents.push(previous);
      continue;
    }
    const chunks = chunkDocumentContent(spec.content);
    const fields = { content: spec.content, contentChunks: chunks, semanticChunkCount: chunks.length, semanticContentHash: documentSemanticHash(spec.content) };
    if (previous && sameFields(previous, fields) && previous.chunkEmbeddings.length === chunks.length) documents.push(previous);
    else pendingDocuments.push({ ...spec, folderKey: previous?.folderKey ?? spec.folderKey, name: previous?.name ?? spec.name, chunks, previous });
  }

  const embeddingInputs = [
    ...pendingFolderSpecs.map((spec) => spec.name),
    ...pendingDocuments.flatMap((spec) => documentEmbeddingTexts(spec.name, spec.chunks)),
  ];
  const embeddings = embeddingInputs.length ? await dependencies.embedTexts(embeddingInputs, dependencies.signal) : [];
  if (embeddings.length !== embeddingInputs.length || embeddings.some((embedding) => !embedding.length || embedding.some((value) => !Number.isFinite(value)))) throw new Error('Archive projection embedding output is not aligned with its inputs.');
  let offset = 0;
  for (const spec of pendingFolderSpecs) {
    const previous = spec.previous;
    folders.push({
      ...(previous ?? {}),
      key: spec.key, scopeKey: state.scopeKey, parentFolderKey: spec.parentFolderKey, name: spec.name, managedPurpose: spec.managedPurpose, managedOwnerKey: spec.managedOwnerKey, privateOwnerUserKey: state.userKey,
      mutationPolicy: previous?.mutationPolicy ?? 'user', archiveVisibility: 'visible', isFavorite: previous?.isFavorite ?? false,
      embedding: embeddings[offset++]!, createdAt: previous?.createdAt ?? now, updatedAt: now,
    });
  }
  for (const spec of pendingDocuments) {
    const previous = spec.previous;
    const chunkEmbeddings = embeddings.slice(offset, offset + spec.chunks.length); offset += spec.chunks.length;
    documents.push({
      ...(previous ?? {}),
      key: spec.key, scopeKey: state.scopeKey, folderKey: spec.folderKey, name: spec.name, content: spec.content, contentChunks: spec.chunks,
      semanticChunkCount: spec.chunks.length, semanticContentHash: documentSemanticHash(spec.content),
      managedPurpose: spec.managedPurpose, managedOwnerKey: spec.managedOwnerKey, privateOwnerUserKey: state.userKey,
      mutationPolicy: previous?.mutationPolicy ?? 'user', archiveVisibility: 'visible', isFavorite: previous?.isFavorite ?? false,
      embedding: chunkEmbeddings[0]!, chunkEmbeddings, createdAt: previous?.createdAt ?? now, updatedAt: now,
    });
  }
  return { folders: folderSpecs.map(({ key }) => folders.find((folder) => folder.key === key)!), documents: documentSpecs.map(({ key }) => documents.find((document) => document.key === key)!) };
}

interface ArchiveDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<{ next(): Promise<unknown>; all(): Promise<unknown[]> }> }
type ArchiveTransaction = <T>(operation: (database: ArchiveDatabase) => Promise<T>) => Promise<T>;
const parseState = (value: unknown) => conversationArchiveStateSchema.parse(withArangoKey(value as Record<string, unknown>));

export function createConversationArchiveProjectionRepository(database: ArchiveDatabase = db as unknown as ArchiveDatabase, transaction?: ArchiveTransaction): ConversationArchiveProjectionRepository {
  const transact = transaction ?? (database === db as unknown as ArchiveDatabase
    ? (operation) => withTransaction({ read: ['conversations', 'conversationMessages'], write: [CONVERSATION_ARCHIVE_STATES_COLLECTION, 'folders', 'documents'], exclusive: [] }, (trx) => operation(trx as unknown as ArchiveDatabase))
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
      const existingCursor = await database.query('LET folders = (FOR value IN folders FILTER value._key IN @folderKeys RETURN value) LET documents = (FOR value IN documents FILTER value._key IN @documentKeys || (value.folderKey == @conversationFolderKey && value.managedPurpose == "conversation-message" && value.privateOwnerUserKey == @userKey) RETURN value) RETURN { folders, documents }', { folderKeys: [keys.rootFolderKey, keys.conversationFolderKey, keys.summariesFolderKey], documentKeys: [keys.summaryDocumentKey, ...row.messages.map((message) => keys.messageDocumentKey(String(message._key)))], conversationFolderKey: keys.conversationFolderKey, userKey: input.userKey });
      const existing = await existingCursor.next() as { folders: Record<string, unknown>[]; documents: Record<string, unknown>[] } | undefined;
      return { status: 'ready', snapshot: { state, conversation, messages: row.messages.map((message) => conversationMessageSchema.parse(withArangoKey(message))), existing: { folders: (existing?.folders ?? []).map((value) => withArangoKey(value) as unknown as ConversationArchiveFolder), documents: (existing?.documents ?? []).map((value) => withArangoKey(value) as unknown as ConversationArchiveDocument) } } };
    },
    async commit(snapshot, projection, now) {
      return transact(async (executor) => {
        const state = snapshot.state;
        const keys = conversationArchiveKeys(state);
        const current = await (await executor.query(`FOR value IN @@states FILTER value._key == @key && value.desiredRevision == @revision && ${binding('value')} LIMIT 1 RETURN value`, { '@states': CONVERSATION_ARCHIVE_STATES_COLLECTION, ...ownerBindings(state), key: state.key, revision: state.desiredRevision })).next();
        if (!current) return { status: 'stale' as const };
        const source = await (await executor.query('FOR value IN @@conversations FILTER value._key == @conversationKey && value.teamKey == @teamKey && value.scopeKey == @scopeKey && value.userKey == @userKey LIMIT 1 RETURN true', { '@conversations': 'conversations', ...conversationBindings(state) })).next();
        if (!source) return { status: 'stale' as const };
        const folderConflicts = await (await executor.query('FOR value IN folders FILTER value._key IN @keys LET desired = FIRST(FOR item IN @desired FILTER item.key == value._key RETURN item) FILTER !(value.privateOwnerUserKey == @userKey && value.managedPurpose == desired.managedPurpose && value.managedOwnerKey == desired.managedOwnerKey) RETURN value._key', { keys: projection.folders.map(({ key }) => key), desired: projection.folders.map(({ key, managedPurpose, managedOwnerKey }) => ({ key, managedPurpose, managedOwnerKey })), userKey: state.userKey })).all();
        const documentConflicts = await (await executor.query('FOR value IN documents FILTER value._key IN @keys LET desired = FIRST(FOR item IN @desired FILTER item.key == value._key RETURN item) FILTER !(value.privateOwnerUserKey == @userKey && value.managedPurpose == desired.managedPurpose && value.managedOwnerKey == desired.managedOwnerKey) RETURN value._key', { keys: projection.documents.map(({ key }) => key), desired: projection.documents.map(({ key, managedPurpose, managedOwnerKey }) => ({ key, managedPurpose, managedOwnerKey })), userKey: state.userKey })).all();
        if (folderConflicts.length || documentConflicts.length) throw new Error(`Conversation Archive deterministic keys conflict with non-owned resources: ${[...folderConflicts, ...documentConflicts].join(', ')}`);
        for (const [collection, values] of [['folders', projection.folders], ['documents', projection.documents]] as const) await executor.query(`FOR value IN @values UPSERT { _key: value._key } INSERT value REPLACE value IN ${collection}`, { values: values.map((value) => toArangoDoc(value as unknown as Record<string, unknown> & { key: string })) });
        await executor.query('FOR value IN documents FILTER value.folderKey == @folderKey && value.managedPurpose == "conversation-message" && value.privateOwnerUserKey == @userKey && value._key NOT IN @desiredKeys REMOVE value IN documents', { folderKey: keys.conversationFolderKey, userKey: state.userKey, desiredKeys: projection.documents.filter(({ managedPurpose }) => managedPurpose === 'conversation-message').map(({ key }) => key) });
        if (!projection.documents.some(({ managedPurpose }) => managedPurpose === 'conversation-summary')) await executor.query('FOR value IN documents FILTER value._key == @key && value.privateOwnerUserKey == @userKey && value.managedPurpose == "conversation-summary" && value.managedOwnerKey == @conversationKey REMOVE value IN documents', { key: keys.summaryDocumentKey, userKey: state.userKey, conversationKey: state.conversationKey });
        const advanced = await (await executor.query(`FOR value IN @@states FILTER value._key == @key && value.desiredRevision == @revision && ${binding('value')} UPDATE value WITH { projectedRevision: @revision, lastProjectedAt: @now, updatedAt: @now } IN @@states RETURN true`, { '@states': CONVERSATION_ARCHIVE_STATES_COLLECTION, ...ownerBindings(state), key: state.key, revision: state.desiredRevision, now })).next();
        if (!advanced) throw new Error('Conversation Archive revision fence was lost during commit.');
        return { status: 'committed' as const, projectedRevision: state.desiredRevision };
      });
    },
    async deleteMissingSource(owner, desiredRevision) {
      const input = ownerSchema.parse(owner);
      const state = await (await database.query(`FOR value IN @@states FILTER value.desiredRevision == @desiredRevision && ${binding('value')} LIMIT 1 RETURN value`, { '@states': CONVERSATION_ARCHIVE_STATES_COLLECTION, ...input, desiredRevision })).next();
      if (!state) return 'stale';
      const source = await (await database.query('FOR value IN @@conversations FILTER value._key == @conversationKey && value.teamKey == @teamKey && value.scopeKey == @scopeKey && value.userKey == @userKey LIMIT 1 RETURN true', { '@conversations': 'conversations', ...conversationBindings(input) })).next();
      if (source) return 'stale';
      const keys = conversationArchiveKeys(input);
      await database.query('FOR document IN documents FILTER document.scopeKey == @scopeKey && document.privateOwnerUserKey == @userKey && document.folderKey IN @folderKeys && document.managedPurpose IN ["conversation-message", "conversation-summary"] REMOVE document IN documents', { scopeKey: input.scopeKey, userKey: input.userKey, folderKeys: [keys.conversationFolderKey, keys.summariesFolderKey] });
      await database.query('LET summary = DOCUMENT(documents, @summaryKey) FILTER summary != null && summary.privateOwnerUserKey == @userKey && summary.managedPurpose == "conversation-summary" REMOVE summary IN documents', { userKey: input.userKey, summaryKey: keys.summaryDocumentKey });
      await database.query('FOR folderKey IN @keys LET folder = DOCUMENT(folders, folderKey) FILTER folder != null && folder.privateOwnerUserKey == @userKey && folder.managedPurpose IN ["conversation", "conversation-summaries"] REMOVE folder IN folders', { keys: [keys.summariesFolderKey, keys.conversationFolderKey], userKey: input.userKey });
      await database.query('LET root = DOCUMENT(folders, @rootFolderKey) FILTER root != null && root.scopeKey == @scopeKey && root.privateOwnerUserKey == @userKey && root.managedPurpose == "conversation-root" && root.managedOwnerKey == @userKey LET remaining = FIRST(FOR folder IN folders FILTER folder.parentFolderKey == root._key && folder.scopeKey == @scopeKey && folder.privateOwnerUserKey == @userKey && folder.managedPurpose == "conversation" LIMIT 1 RETURN 1) FILTER remaining == null REMOVE root IN folders', { rootFolderKey: keys.rootFolderKey, scopeKey: input.scopeKey, userKey: input.userKey });
      await database.query('REMOVE @key IN @@states', { '@states': CONVERSATION_ARCHIVE_STATES_COLLECTION, key: (state as Record<string, unknown>)._key });
      return 'deleted';
    },
    async listPending(limit = 1_000) {
      const bounded = z.number().int().min(1).max(10_000).parse(limit);
      const cursor = await database.query('FOR value IN @@states LET conversation = DOCUMENT(@@conversations, value.conversationKey) FILTER conversation == null || value.projectedRevision < value.desiredRevision || conversation.updatedAt > value.updatedAt LET pending = conversation != null && conversation.updatedAt > value.updatedAt ? FIRST(UPDATE value WITH { desiredRevision: value.desiredRevision + 1, updatedAt: conversation.updatedAt } IN @@states RETURN NEW) : value SORT pending.updatedAt ASC, pending._key ASC LIMIT @limit RETURN pending', { '@states': CONVERSATION_ARCHIVE_STATES_COLLECTION, '@conversations': 'conversations', limit: bounded });
      return (await cursor.all()).map(parseState);
    },
  };
}
