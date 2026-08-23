import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, withDatabaseTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { documentSchema, type Document } from '@/lib/db/documents.node';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { chunkDocumentContent, documentSemanticHash } from '@/lib/ai/document-processing/chunking';
import {
  archiveDocument,
  decodeEmailDraft,
  decodeEmailMessage,
  decodeEmailReplyContext,
  decodeEmailThread,
  decodeEmailTone,
  decodeEmailWritingProfile,
  encodeEmailToneContent,
  emailToneSemanticText,
  emailAttachmentRefsSchema,
  emailDraftPayloadSchema,
  emailMessagePayloadSchema,
  emailReplyContextDataSchema,
  emailReplyContextPayloadSchema,
  emailThreadPayloadSchema,
  emailTonePayloadSchema,
  emailArchiveDocumentSchema,
  prepareEmailToneDocument,
  prepareEmailReplyContextDocument,
  type EmailAttachmentRef,
  type EmailDraft,
  type EmailDraftCreate,
  type EmailMessage,
  type EmailReplyContext,
  type EmailThread,
  type EmailTone,
} from './archive-payloads';
import { ensureMailFolders, mailFolderKeys } from './folders';
import { documentVersionSchema, type DocumentVersion } from '@/lib/db/document-versions.node';
import { documentSummarySchema, type DocumentSummary } from '@/lib/db/document-summaries.node';
import type { InboxCategory } from './classification';

type Database = Pick<typeof db, 'query' | 'collection'> & Partial<Pick<typeof db, 'beginTransaction'>>;
const REPLY_CONTEXT_MAX_NOTES = 20;
const REPLY_CONTEXT_MAX_CHARACTERS = 24_000;
const SEMANTIC_REPLY_MINIMUM_SIMILARITY = 0.70;
const SEMANTIC_REPLY_MAX_ITEMS = 20;
const SEMANTIC_REPLY_MAX_CHARACTERS = 24_000;
const SEMANTIC_REPLY_QUERY_CANDIDATES = 60;

export type SemanticReplyItem =
  | { kind: 'thread'; key: string; similarity: number; providerThreadId: string; subject: string; summary: string; intent: string; action?: string; lastMessageAt: string }
  | { kind: 'message'; key: string; similarity: number; providerMessageId: string; threadKey: string; subject: string; body: string; from: string; to: string[]; direction: 'inbound' | 'outbound'; sentAt: string; trueOutboundReply: boolean };
const emailCursorSchema = z.object({ v: z.literal(1), threadKey: z.string().cuid(), sentAt: z.string().datetime(), key: z.string().cuid() }).strict();
export function encodeEmailCursor(value: z.infer<typeof emailCursorSchema>) { return Buffer.from(JSON.stringify(emailCursorSchema.parse(value))).toString('base64url'); }
export function decodeEmailCursor(value: string, threadKey: string) {
  const parsed = emailCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  if (parsed.threadKey !== threadKey) throw new EmailRepositoryError('conflict', 'Email cursor belongs to another thread');
  return parsed;
}
const overviewCursorSchema = z.object({ v: z.literal(1), scopeKey: z.string().cuid(), connectorKey: z.string().cuid(), filter: z.string(), search: z.string(), lastMessageAt: z.string().datetime(), key: z.string().cuid() }).strict();
function encodeOverviewCursor(value: z.infer<typeof overviewCursorSchema>) { return Buffer.from(JSON.stringify(overviewCursorSchema.parse(value))).toString('base64url'); }
function decodeOverviewCursor(value: string, owner: Pick<z.infer<typeof overviewCursorSchema>, 'scopeKey' | 'connectorKey' | 'filter' | 'search'>) {
  const parsed = overviewCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  if (parsed.scopeKey !== owner.scopeKey || parsed.connectorKey !== owner.connectorKey || parsed.filter !== owner.filter || parsed.search !== owner.search) throw new EmailRepositoryError('conflict', 'Inbox cursor belongs to another connector, scope, or query');
  return parsed;
}

export class EmailRepositoryError extends Error {
  constructor(readonly reason: 'not_found' | 'forbidden' | 'conflict', message: string = reason) { super(message); }
}

function stableKey(kind: string, ...values: string[]) {
  return `c${createHash('sha256').update([kind, ...values].join('\0')).digest('hex').slice(0, 24)}`;
}

function parsedDocument(raw: unknown): Document & { coverImageKey?: string } {
  return emailArchiveDocumentSchema.parse(withArangoKey(raw as Record<string, unknown>));
}

function withoutRecordFields<T extends { key: string; scopeKey: string; embedding: number[]; createdAt: string; updatedAt: string }>(value: T) {
  const { key: _key, scopeKey: _scopeKey, embedding: _embedding, createdAt: _createdAt, updatedAt: _updatedAt, ...data } = value;
  return data;
}

const defaultTones = [
  { slug: 'casual', name: 'Casual', description: 'Relaxed, friendly, and natural.', instruction: 'Use conversational language, natural contractions, and an approachable tone.' },
  { slug: 'formal', name: 'Formal', description: 'Polished, respectful, and professional.', instruction: 'Use professional language, complete sentences, and a clear conventional structure.' },
  { slug: 'concise', name: 'Concise', description: 'Brief, clear, and focused.', instruction: 'Lead with the point, use short sentences, and include only necessary details.' },
] as const;
const legacyDefaultTones = [
  { slug: 'warm' as const, name: 'Warm', description: 'Friendly and considerate.', instruction: 'Sound approachable, appreciative, and human.' },
  { slug: 'direct' as const, name: 'Direct', description: 'Clear and decisive.', instruction: 'Lead with the answer or action and avoid hedging.' },
] as const;

export function createEmailRepository(database: Database = db) {
  const generatedWrite = async <T>(collection: 'documentVersions' | 'documentSummaries', operation: (executor: Pick<typeof db, 'query'>) => Promise<T>): Promise<T> => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      try {
        return database.beginTransaction
          ? await withDatabaseTransaction<T>(database as typeof db, { read: ['documents'], write: [collection] }, operation)
          : await operation(database);
      } catch (error) {
        const conflict = error && typeof error === 'object' && (('errorNum' in error && (error.errorNum === 1200 || error.errorNum === 1210)) || ('code' in error && error.code === 409));
        if (!conflict) throw error;
        if (attempt === 9) throw new EmailRepositoryError('conflict', 'Generated email content changed concurrently; retry the operation');
        await new Promise((resolve) => setTimeout(resolve, (attempt + 1) * 5));
      }
    }
    throw new EmailRepositoryError('conflict', 'Generated email content changed concurrently; retry the operation');
  };
  const mailDeletion = async <T>(operation: (executor: Pick<typeof db, 'query'>) => Promise<T>): Promise<T> => database.beginTransaction
    ? withDatabaseTransaction<T>(database as typeof db, { read: [], write: ['documents', 'documentVersions', 'documentSummaries', 'documentSummaryAudio', 'documentAudioVersions'] }, operation)
    : operation(database);
  const transactReplyContext = async <T>(operation: (trx: Pick<typeof db, 'query'>) => Promise<T>): Promise<T> => {
    if (database.beginTransaction) {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        try { return await withDatabaseTransaction<T>(database as typeof db, { read: [], write: ['folders', 'documents'] }, async (trx) => operation(trx)); }
        catch (error) {
          const conflict = error && typeof error === 'object' && (('errorNum' in error && error.errorNum === 1200) || ('code' in error && error.code === 409));
          if (!conflict || attempt === 2) throw error;
        }
      }
      throw new EmailRepositoryError('conflict', 'Reply-context write conflict');
    }
    return operation(database);
  };
  const attachmentResources = async (scopeKey: string, refs: EmailAttachmentRef[]) => {
    const parsed = emailAttachmentRefsSchema.parse(refs);
    if (new Set(parsed.map(({ type, key }) => `${type}:${key}`)).size !== parsed.length) throw new EmailRepositoryError('conflict', 'Attachment references must be unique');
    if (!parsed.length) return [];
    const cursor = await database.query(`FOR ref IN @refs
      LET item = ref.type == "document" ? DOCUMENT(documents, ref.key) : DOCUMENT(images, ref.key)
      FILTER item != null && item.scopeKey == @scopeKey && item.mutationPolicy != "system-only"
      FILTER ref.type != "document" || !HAS(item, "_internalDeletion") || item._internalDeletion == null
      RETURN { type: ref.type, key: ref.key, name: ref.type == "document" ? item.name : item.filename, mimeType: item.mimeType, sizeBytes: item.sizeBytes, storageKey: item.storageKey, content: ref.type == "document" && item.storageKey == null ? item.content : null }`, { scopeKey, refs: parsed });
    const resources = await cursor.all() as Array<{ type: 'document' | 'image'; key: string; name: string; mimeType?: string; sizeBytes?: number; storageKey?: string; content?: string | null }>;
    if (resources.length !== parsed.length) throw new EmailRepositoryError('forbidden', 'Every attachment must belong to the authorized scope');
    return resources;
  };
  const listFolderDocuments = async (scopeKey: string, folderKey: string) => {
    const cursor = await database.query('FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey == @folderKey && (!HAS(document, "_internalDeletion") || document._internalDeletion == null) RETURN document', { scopeKey, folderKey });
    return (await cursor.all()).flatMap((raw) => {
      try { return [parsedDocument(raw)]; } catch { return []; }
    });
  };
  const getDocument = async (scopeKey: string, key: string) => {
    const cursor = await database.query('FOR document IN documents FILTER document._key == @key && document.scopeKey == @scopeKey && (!HAS(document, "_internalDeletion") || document._internalDeletion == null) LIMIT 1 RETURN document', { scopeKey, key });
    const raw = await cursor.next();
    return raw ? parsedDocument(raw) : null;
  };
  const replaceDocument = async (document: Document) => {
    const cursor = await database.query('UPSERT { _key: @key } INSERT @document UPDATE MERGE(@document, { _key: OLD._key, createdAt: OLD.createdAt }) IN documents RETURN NEW', { key: document.key, document: toArangoDoc(document) });
    return parsedDocument(await cursor.next());
  };
  const updatePayload = async <T>(scopeKey: string, key: string, decode: (document: unknown) => T, schema: z.ZodTypeAny, patch: Record<string, unknown>) => {
    const { set, unset } = Object.entries(patch).reduce((result, [field, value]) => {
      if (value === undefined) result.unset.push(field);
      else result.set[field] = value;
      return result;
    }, { set: {} as Record<string, unknown>, unset: [] as string[] });
    const updatedAt = new Date().toISOString();
    const cursor = await database.query(`FOR document IN documents
      FILTER document._key == @key && document.scopeKey == @scopeKey
      LET payload = JSON_PARSE(document.content)
      LET nextPayload = MERGE(payload, { data: UNSET(MERGE(payload.data, @set), @unset) })
      UPDATE document WITH { content: JSON_STRINGIFY(nextPayload), updatedAt: @updatedAt } IN documents RETURN NEW`, { key, scopeKey, set, unset, updatedAt });
    const raw = await cursor.next();
    if (!raw) throw new EmailRepositoryError('not_found');
    const decoded = decode(parsedDocument(raw));
    schema.parse({ version: 1, kind: JSON.parse(parsedDocument(raw).content).kind, data: withoutRecordFields(decoded as T & { key: string; scopeKey: string; embedding: number[]; createdAt: string; updatedAt: string }) });
    return decoded;
  };

  return {
    async ensureFolders(scopeKey: string) { return ensureMailFolders(database, scopeKey); },
    async syncThread(input: {
      thread: Omit<EmailThread, 'key' | 'createdAt' | 'updatedAt'>;
      messages: Array<Omit<EmailMessage, 'key' | 'threadKey' | 'createdAt' | 'updatedAt'>>;
      reconcileMessages?: boolean;
    }) {
      if (input.messages.some((message) => message.scopeKey !== input.thread.scopeKey || message.accountKey !== input.thread.accountKey)) {
        throw new EmailRepositoryError('conflict', 'Email thread and messages must belong to the same account and scope');
      }
      const folders = await ensureMailFolders(database, input.thread.scopeKey);
      const timestamp = new Date().toISOString();
      const threadKey = stableKey('mail-thread', input.thread.scopeKey, input.thread.accountKey, input.thread.providerThreadId);
      const threadPayload = emailThreadPayloadSchema.parse({ version: 1, kind: 'mail-thread', data: withoutRecordFields({ ...input.thread, key: threadKey, createdAt: timestamp, updatedAt: timestamp }) });
      const threadDocument = archiveDocument({ key: threadKey, scopeKey: input.thread.scopeKey, folderKey: folders.threads, name: input.thread.subject, payload: threadPayload, embedding: input.thread.embedding, createdAt: timestamp, updatedAt: timestamp });
      return mailDeletion(async (trx) => {
        const threadCursor = await trx.query('UPSERT { _key: @key } INSERT @document UPDATE MERGE(@document, { _key: OLD._key, createdAt: OLD.createdAt, content: JSON_STRINGIFY(MERGE(JSON_PARSE(@document.content), { data: MERGE(JSON_PARSE(@document.content).data, { isFavorite: JSON_PARSE(OLD.content).data.isFavorite == true }) })) }) IN documents RETURN NEW', { key: threadKey, document: toArangoDoc(threadDocument) });
        const thread = decodeEmailThread(parsedDocument(await threadCursor.next()));
        for (const inputMessage of input.messages) {
          const messageKey = stableKey('mail-message', inputMessage.scopeKey, inputMessage.accountKey, inputMessage.providerMessageId);
          const data = withoutRecordFields({ ...inputMessage, threadKey, key: messageKey, createdAt: timestamp, updatedAt: timestamp });
          const payload = emailMessagePayloadSchema.parse({ version: 1, kind: 'mail-message', data });
          const document = archiveDocument({ key: messageKey, scopeKey: inputMessage.scopeKey, folderKey: folders.threads, name: inputMessage.subject, payload, embedding: inputMessage.embedding, createdAt: timestamp, updatedAt: timestamp });
          await trx.query('UPSERT { _key: @key } INSERT @document UPDATE MERGE(@document, { _key: OLD._key, createdAt: OLD.createdAt }) IN documents', { key: messageKey, document: toArangoDoc(document) });
        }
        if (input.reconcileMessages !== false) {
          const keep = input.messages.map(({ providerMessageId }) => stableKey('mail-message', input.thread.scopeKey, input.thread.accountKey, providerMessageId));
          await trx.query(`LET stale = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey == @folderKey && document._key NOT IN @keep LET payload = JSON_PARSE(document.content) FILTER payload.kind == "mail-message" && payload.data.threadKey == @threadKey RETURN document)
            LET staleKeys = stale[*]._key
            LET summaryKeys = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey IN staleKeys RETURN summary._key)
            LET removedSummaryAudio = (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && audio.summaryKey IN summaryKeys REMOVE audio IN documentSummaryAudio RETURN 1)
            LET removedSummaries = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey IN staleKeys REMOVE summary IN documentSummaries RETURN 1)
            LET removedVersions = (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey IN staleKeys REMOVE version IN documentVersions RETURN 1)
            LET removedAudioVersions = (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey IN staleKeys REMOVE audio IN documentAudioVersions RETURN 1)
            FOR document IN stale REMOVE document IN documents`, { scopeKey: input.thread.scopeKey, folderKey: folders.threads, threadKey, keep });
        }
        return thread;
      });
    },
    async overview(scopeKey: string, connectorKey: string, filter: 'all' | 'important' | 'urgent' | 'needs_action' | 'filtered' | 'unread' | 'favorite' = 'all', search?: string, cursorValue?: string, limit = 50) {
      const normalized = search?.trim().toLowerCase() ?? '';
      const after = cursorValue ? decodeOverviewCursor(cursorValue, { scopeKey, connectorKey, filter, search: normalized }) : null;
      const cursor = await database.query(`LET inbox = (FOR document IN documents
        FILTER document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "system-only"
        LET payload = JSON_PARSE(document.content)
        FILTER payload.kind == "mail-thread" && payload.data.accountKey == @connectorKey && payload.data.inInbox != false
        RETURN { document, data: payload.data })
        LET matching = (FOR row IN inbox
          FILTER @filter == "all" || (@filter == "important" && row.data.inboxCategory == "Important") || (@filter == "urgent" && row.data.inboxCategory == "Urgent") || (@filter == "needs_action" && row.data.state == "needs_action") || (@filter == "filtered" && row.data.inboxCategory == "Filtered") || (@filter == "unread" && row.data.unread == true) || (@filter == "favorite" && row.data.isFavorite == true)
          FILTER @search == "" || CONTAINS(LOWER(CONCAT_SEPARATOR(" ", row.data.subject, row.data.summary, row.data.snippet)), @search)
          FILTER @after == null || row.data.lastMessageAt < @after.lastMessageAt || (row.data.lastMessageAt == @after.lastMessageAt && row.document._key > @after.key)
          SORT row.data.lastMessageAt DESC, row.document._key ASC LIMIT @pageSize RETURN row.document)
        RETURN { documents: matching, counts: { all: LENGTH(inbox), important: LENGTH(FOR row IN inbox FILTER row.data.inboxCategory == "Important" RETURN 1), urgent: LENGTH(FOR row IN inbox FILTER row.data.inboxCategory == "Urgent" RETURN 1), needsAction: LENGTH(FOR row IN inbox FILTER row.data.state == "needs_action" RETURN 1), filtered: LENGTH(FOR row IN inbox FILTER row.data.inboxCategory == "Filtered" RETURN 1), unread: LENGTH(FOR row IN inbox FILTER row.data.unread == true RETURN 1), favorite: LENGTH(FOR row IN inbox FILTER row.data.isFavorite == true RETURN 1) } }`, { scopeKey, connectorKey, folderKey: mailFolderKeys(scopeKey).threads, filter, search: normalized, after, pageSize: limit + 1 });
      const result = await cursor.next() as { documents: unknown[]; counts: Record<string, number> } | undefined;
      const decoded = (result?.documents ?? []).map((document) => decodeEmailThread(parsedDocument(document)));
      const threads = decoded.slice(0, limit);
      const last = threads.at(-1);
      const nextCursor = decoded.length > limit && last ? encodeOverviewCursor({ v: 1, scopeKey, connectorKey, filter, search: normalized, lastMessageAt: last.lastMessageAt, key: last.key }) : null;
      return { threads, nextCursor, counts: result?.counts ?? { all: 0, important: 0, urgent: 0, needsAction: 0, filtered: 0, unread: 0, favorite: 0 } };
    },
    async thread(scopeKey: string, threadKey: string) {
      const document = await getDocument(scopeKey, threadKey);
      if (!document) throw new EmailRepositoryError('not_found');
      let thread: EmailThread;
      try { thread = decodeEmailThread(document); } catch { throw new EmailRepositoryError('not_found'); }
      if (thread.inInbox === false) throw new EmailRepositoryError('not_found');
      const messages = (await listFolderDocuments(scopeKey, mailFolderKeys(scopeKey).threads)).flatMap((candidate) => {
        try { const message = decodeEmailMessage(candidate); return message.threadKey === threadKey ? [message] : []; } catch { return []; }
      }).sort((a, b) => a.sentAt.localeCompare(b.sentAt) || a.key.localeCompare(b.key));
      return { thread, messages };
    },
    async message(scopeKey: string, messageKey: string) {
      const document = await getDocument(scopeKey, messageKey);
      if (!document) throw new EmailRepositoryError('not_found');
      try { return decodeEmailMessage(document); } catch { throw new EmailRepositoryError('not_found'); }
    },
    async mailbox(scopeKey: string, accountKey: string) {
      const documents = await listFolderDocuments(scopeKey, mailFolderKeys(scopeKey).threads);
      const threads = documents.flatMap((document) => { try { const value = decodeEmailThread(document); return value.accountKey === accountKey ? [value] : []; } catch { return []; } });
      const threadKeys = new Set(threads.map(({ key }) => key));
      const messages = documents.flatMap((document) => { try { const value = decodeEmailMessage(document); return value.accountKey === accountKey && threadKeys.has(value.threadKey) ? [value] : []; } catch { return []; } });
      return { threads, messages };
    },
    async similarMessages(scopeKey: string, messageKey: string, embedding: number[], categories: InboxCategory[] = ['Urgent', 'Important', 'Filtered'], limit = 20) {
      const source = await this.message(scopeKey, messageKey);
      const cursor = await database.query(`FOR document IN documents
        FILTER document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "system-only" && document._key != @messageKey
        FILTER IS_ARRAY(document.embedding) && LENGTH(document.embedding) == LENGTH(@embedding)
        LET payload = JSON_PARSE(document.content)
        FILTER payload.version == 1 && payload.kind == "mail-message" && payload.data.threadKey != @currentThreadKey && payload.data.accountKey == @accountKey
        FILTER payload.data.embeddingContentVersion == 3 && payload.data.inboxCategory IN @categories
        LET similarity = COSINE_SIMILARITY(document.embedding, @embedding)
        FILTER IS_NUMBER(similarity) && similarity >= 0.70
        COLLECT threadKey = payload.data.threadKey INTO candidates
        LET selected = FIRST(FOR candidate IN candidates SORT candidate.similarity DESC, candidate.document._key ASC LIMIT 1 RETURN candidate)
        SORT selected.similarity DESC, selected.document._key ASC
        LIMIT @limit
        RETURN { document: selected.document, similarity: selected.similarity }`, { scopeKey, folderKey: mailFolderKeys(scopeKey).threads, messageKey, currentThreadKey: source.threadKey, accountKey: source.accountKey, embedding, categories, limit: Math.min(limit, 20) });
      return (await cursor.all() as Array<{ document: unknown; similarity: number }>).flatMap(({ document, similarity }) => {
        try { return [{ message: decodeEmailMessage(parsedDocument(document)), similarity }]; } catch { return []; }
      });
    },
    async categorizeTrashedThread(scopeKey: string, threadKey: string) {
      const updatedAt = new Date().toISOString();
      const cursor = await database.query(`LET thread = DOCUMENT(documents, @threadKey)
        FILTER thread != null && thread.scopeKey == @scopeKey
        LET threadPayload = JSON_PARSE(thread.content)
        FILTER threadPayload.kind == "mail-thread"
        LET messages = (FOR document IN documents FILTER document.scopeKey == @scopeKey LET payload = JSON_PARSE(document.content) FILTER payload.kind == "mail-message" && payload.data.threadKey == @threadKey UPDATE document WITH { content: JSON_STRINGIFY(MERGE(payload, { data: MERGE(payload.data, { inboxCategory: "Filtered", labels: PUSH(payload.data.labels || [], "TRASH", true) }) })), updatedAt: @updatedAt } IN documents RETURN NEW)
        UPDATE thread WITH { content: JSON_STRINGIFY(MERGE(threadPayload, { data: MERGE(threadPayload.data, { inboxCategory: "Filtered", priority: "low", state: "filtered", inInbox: true, labels: PUSH(threadPayload.data.labels || [], "TRASH", true) }) })), updatedAt: @updatedAt } IN documents
        RETURN NEW`, { scopeKey, threadKey, updatedAt });
      const raw = await cursor.next();
      if (!raw) throw new EmailRepositoryError('not_found');
      return decodeEmailThread(parsedDocument(raw));
    },
    async createMessageTranslation(input: Omit<DocumentVersion, 'key' | 'version' | 'createdAt'>) {
      const snapshot = documentVersionSchema.omit({ key: true, version: true, createdAt: true }).parse(input);
      const raw = await generatedWrite('documentVersions', async (executor) => {
        const cursor = await executor.query(`LET document = DOCUMENT(documents, @documentKey)
          FILTER document != null && document.scopeKey == @scopeKey && document.mutationPolicy == "system-only"
          LET payload = JSON_PARSE(document.content) FILTER payload.kind == "mail-message"
          LET nextVersion = FIRST(FOR existing IN documentVersions FILTER existing.documentKey == @documentKey COLLECT AGGREGATE maximum = MAX(existing.version) RETURN (maximum || 0) + 1)
          INSERT MERGE(@snapshot, { _key: @key, version: nextVersion, createdAt: @createdAt }) IN documentVersions RETURN NEW`, { documentKey: input.documentKey, scopeKey: input.scopeKey, key: newId(), createdAt: new Date().toISOString(), snapshot });
        return cursor.next();
      });
      if (!raw) throw new EmailRepositoryError('not_found');
      return documentVersionSchema.parse(withArangoKey(raw as Record<string, unknown>));
    },
    async listMessageTranslations(scopeKey: string, messageKey: string) {
      await this.message(scopeKey, messageKey);
      const cursor = await database.query('FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey == @messageKey && version.type == "translation" SORT version.version DESC RETURN version', { scopeKey, messageKey });
      return (await cursor.all()).map((raw) => documentVersionSchema.parse(withArangoKey(raw as Record<string, unknown>)));
    },
    async createMessageSummary(input: Omit<DocumentSummary, 'version'>) {
      const summary = documentSummarySchema.omit({ version: true }).parse(input);
      const raw = await generatedWrite('documentSummaries', async (executor) => {
        const cursor = await executor.query(`LET document = DOCUMENT(documents, @documentKey)
          FILTER document != null && document.scopeKey == @scopeKey && document.mutationPolicy == "system-only"
          LET payload = JSON_PARSE(document.content) FILTER payload.kind == "mail-message"
          LET nextVersion = FIRST(FOR existing IN documentSummaries FILTER existing.documentKey == @documentKey COLLECT AGGREGATE maximum = MAX(existing.version) RETURN (maximum || 0) + 1)
          INSERT MERGE(@summary, { version: nextVersion }) IN documentSummaries RETURN NEW`, { documentKey: input.documentKey, scopeKey: input.scopeKey, summary: toArangoDoc(summary as DocumentSummary) });
        return cursor.next();
      });
      if (!raw) throw new EmailRepositoryError('not_found');
      return documentSummarySchema.parse(withArangoKey(raw as Record<string, unknown>));
    },
    async listMessageSummaries(scopeKey: string, messageKey: string) {
      await this.message(scopeKey, messageKey);
      const cursor = await database.query('FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey == @messageKey SORT summary.version DESC RETURN summary', { scopeKey, messageKey });
      return (await cursor.all()).map((raw) => documentSummarySchema.parse(withArangoKey(raw as Record<string, unknown>)));
    },
    async readThreadPage(scopeKey: string, threadKey: string, limit: number, cursorValue?: string) {
      const detail = await this.thread(scopeKey, threadKey);
      const after = cursorValue ? decodeEmailCursor(cursorValue, threadKey) : null;
      const eligible = detail.messages.filter((message) => !after || message.sentAt > after.sentAt || (message.sentAt === after.sentAt && message.key > after.key));
      const page = eligible.slice(0, limit);
      const last = page.at(-1);
      return { thread: detail.thread, messages: page, nextCursor: eligible.length > limit && last ? encodeEmailCursor({ v: 1, threadKey, sentAt: last.sentAt, key: last.key }) : null };
    },
    async markThreadRead(scopeKey: string, threadKey: string, expectedUpdatedAt: string) {
      const updatedAt = new Date().toISOString();
      const cursor = await database.query(`FOR document IN documents
        FILTER document._key == @threadKey && document.scopeKey == @scopeKey && document.updatedAt == @expectedUpdatedAt
        LET payload = JSON_PARSE(document.content)
        FILTER payload.kind == "mail-thread" && payload.data.unread == true
        UPDATE document WITH { content: JSON_STRINGIFY(MERGE(payload, { data: MERGE(payload.data, { unread: false }) })), updatedAt: @updatedAt } IN documents RETURN NEW`, { scopeKey, threadKey, expectedUpdatedAt, updatedAt });
      const raw = await cursor.next();
      if (!raw) throw new EmailRepositoryError('conflict', 'Email thread changed while marking it read');
      return decodeEmailThread(parsedDocument(raw));
    },
    async setThreadFavorite(scopeKey: string, threadKey: string, isFavorite: boolean) { return updatePayload(scopeKey, threadKey, decodeEmailThread, emailThreadPayloadSchema, { isFavorite }); },
    async deleteProviderThread(scopeKey: string, accountKey: string, providerThreadId: string) {
      const threadKey = stableKey('mail-thread', scopeKey, accountKey, providerThreadId);
      await mailDeletion(async (executor) => executor.query(`LET stale = (FOR document IN documents FILTER document.scopeKey == @scopeKey LET payload = JSON_PARSE(document.content) FILTER document._key == @threadKey || (payload.kind == "mail-message" && payload.data.threadKey == @threadKey) RETURN document)
        LET staleKeys = stale[*]._key
        LET summaryKeys = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey IN staleKeys RETURN summary._key)
        LET removedSummaryAudio = (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && audio.summaryKey IN summaryKeys REMOVE audio IN documentSummaryAudio RETURN 1)
        LET removedSummaries = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey IN staleKeys REMOVE summary IN documentSummaries RETURN 1)
        LET removedVersions = (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey IN staleKeys REMOVE version IN documentVersions RETURN 1)
        LET removedAudioVersions = (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey IN staleKeys REMOVE audio IN documentAudioVersions RETURN 1)
        FOR document IN stale REMOVE document IN documents`, { scopeKey, threadKey }));
    },
    async reconcileInbox(scopeKey: string, accountKey: string, providerThreadIds: string[]) {
      const keep = providerThreadIds.map((providerThreadId) => stableKey('mail-thread', scopeKey, accountKey, providerThreadId));
      const documents = await listFolderDocuments(scopeKey, mailFolderKeys(scopeKey).threads);
      for (const document of documents) {
        try { const thread = decodeEmailThread(document); if (thread.accountKey === accountKey && !keep.includes(thread.key) && thread.inInbox !== false) await updatePayload(scopeKey, thread.key, decodeEmailThread, emailThreadPayloadSchema, { inInbox: false }); } catch { /* Other document kind. */ }
      }
    },
    async reconcileThreadMessages(scopeKey: string, threadKey: string, providerMessageIds: string[]) {
      await mailDeletion(async (executor) => executor.query(`LET stale = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey == @folderKey LET payload = JSON_PARSE(document.content) FILTER payload.kind == "mail-message" && payload.data.threadKey == @threadKey && payload.data.providerMessageId NOT IN @providerMessageIds RETURN document)
        LET staleKeys = stale[*]._key
        LET summaryKeys = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey IN staleKeys RETURN summary._key)
        LET removedSummaryAudio = (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && audio.summaryKey IN summaryKeys REMOVE audio IN documentSummaryAudio RETURN 1)
        LET removedSummaries = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey IN staleKeys REMOVE summary IN documentSummaries RETURN 1)
        LET removedVersions = (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey IN staleKeys REMOVE version IN documentVersions RETURN 1)
        LET removedAudioVersions = (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey IN staleKeys REMOVE audio IN documentAudioVersions RETURN 1)
        FOR document IN stale REMOVE document IN documents`, { scopeKey, folderKey: mailFolderKeys(scopeKey).threads, threadKey, providerMessageIds }));
    },
    async writingProfile(scopeKey: string, profileKey?: string, toneSlug?: string, embedTone?: (text: string) => Promise<number[]>) {
      const documents = await listFolderDocuments(scopeKey, mailFolderKeys(scopeKey).tones);
      const profiles = documents.flatMap((document) => {
        try { return [decodeEmailWritingProfile(document)]; } catch { return []; }
      });
      const profile = profileKey ? profiles.find(({ key }) => key === profileKey) : undefined;
      if (profile) return profile;
      const tones = await this.listTones(scopeKey, embedTone);
      const tone = profileKey
        ? tones.find(({ key }) => key === profileKey)
        : toneSlug
          ? tones.find(({ key, identifier, slug }) => key === toneSlug || identifier === toneSlug || slug === toneSlug)
          : tones[0];
      return tone ? { ...tone, tone: tone.instruction, style: tone.description ?? '', structure: tone.description ?? '', vocabulary: tone.instruction, conventions: tone.instruction } : null;
    },
    async createDraft(input: EmailDraftCreate) {
      const folders = await ensureMailFolders(database, input.scopeKey);
      const timestamp = new Date().toISOString();
      const key = newId();
      const data = withoutRecordFields({ ...input, key, createdAt: timestamp, updatedAt: timestamp });
      const kind = input.variant === 'new' ? 'mail-new-draft' : 'mail-reply-draft';
      const payload = emailDraftPayloadSchema.parse({ version: 1, kind, data });
      const name = input.variant === 'new' ? input.subject : `Reply ${input.threadKey}`;
      const document = archiveDocument({ key, scopeKey: input.scopeKey, folderKey: folders.drafts, name, payload, embedding: input.embedding, createdAt: timestamp, updatedAt: timestamp });
      return decodeEmailDraft(await replaceDocument(document));
    },
    async getDraft(scopeKey: string, draftKey: string) {
      const document = await getDocument(scopeKey, draftKey);
      if (!document) throw new EmailRepositoryError('not_found');
      try { return decodeEmailDraft(document); } catch { throw new EmailRepositoryError('not_found'); }
    },
    async assignDraftConnector(scopeKey: string, draftKey: string, connectorKey: string) {
      const updatedAt = new Date().toISOString();
      const cursor = await database.query(`FOR document IN documents
        FILTER document._key == @draftKey && document.scopeKey == @scopeKey
        LET payload = JSON_PARSE(document.content)
        FILTER payload.kind == "mail-new-draft" && payload.data.accountKey IN [@scopeKey, @connectorKey] && payload.data.status IN ["generated", "edited"]
        UPDATE document WITH { content: JSON_STRINGIFY(MERGE(payload, { data: MERGE(payload.data, { accountKey: @connectorKey }) })), updatedAt: @updatedAt } IN documents RETURN NEW`, { scopeKey, draftKey, connectorKey, updatedAt });
      const raw = await cursor.next();
      if (!raw) throw new EmailRepositoryError('conflict', 'Legacy email draft could not be assigned to an inbox');
      return decodeEmailDraft(parsedDocument(raw));
    },
    async listUnassignedDrafts(scopeKey: string) {
      const folders = await ensureMailFolders(database, scopeKey);
      const drafts = await listFolderDocuments(scopeKey, folders.drafts);
      return drafts.map(decodeEmailDraft).filter((draft) => draft.variant === 'new' && draft.accountKey === scopeKey && (draft.status === 'generated' || draft.status === 'edited')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async listDrafts(scopeKey: string, connectorKey?: string) {
      const folders = await ensureMailFolders(database, scopeKey);
      const drafts = await listFolderDocuments(scopeKey, folders.drafts);
      const decoded = drafts.map(decodeEmailDraft).filter(({ status }) => status === 'generated' || status === 'edited');
      if (!connectorKey) return decoded.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50);
      const threads = new Map((await listFolderDocuments(scopeKey, mailFolderKeys(scopeKey).threads)).flatMap((document) => {
        try { const thread = decodeEmailThread(document); return [[thread.key, thread] as const]; } catch { return []; }
      }));
      return decoded.filter((draft) => draft.variant === 'new' ? draft.accountKey === connectorKey : threads.get(draft.threadKey)?.accountKey === connectorKey).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50);
    },
    async updateDraft(scopeKey: string, draftKey: string, finalContent: string) {
      const updatedAt = new Date().toISOString();
      const cursor = await database.query(`FOR document IN documents
        FILTER document._key == @draftKey && document.scopeKey == @scopeKey
        LET payload = JSON_PARSE(document.content)
        FILTER payload.kind IN ["mail-reply-draft", "mail-new-draft"] && payload.data.status IN ["generated", "edited"]
        UPDATE document WITH { content: JSON_STRINGIFY(MERGE(payload, { data: MERGE(payload.data, { finalContent: @finalContent, status: "edited" }) })), updatedAt: @updatedAt } IN documents
        RETURN NEW`, { scopeKey, draftKey, finalContent, updatedAt });
      const raw = await cursor.next();
      if (!raw) throw new EmailRepositoryError('conflict', 'Draft is already sending or finalized');
      return decodeEmailDraft(parsedDocument(raw));
    },
    async claimDraft(scopeKey: string, draftKey: string) {
      const updatedAt = new Date().toISOString();
      const staleBefore = new Date(Date.now() - 30 * 60_000).toISOString();
      const sendLeaseToken = randomUUID();
      const cursor = await database.query(`FOR document IN documents
        FILTER document._key == @draftKey && document.scopeKey == @scopeKey
        LET payload = JSON_PARSE(document.content)
        FILTER payload.kind IN ["mail-reply-draft", "mail-new-draft"]
        FILTER payload.data.status IN ["generated", "edited"] || (payload.data.status == "sending" && (payload.data.sendStartedAt == null || payload.data.sendStartedAt < @staleBefore))
        UPDATE document WITH { content: JSON_STRINGIFY(MERGE(payload, { data: MERGE(payload.data, { status: "sending", sendStartedAt: @updatedAt, sendLeaseToken: @sendLeaseToken }) })), updatedAt: @updatedAt } IN documents
        RETURN NEW`, { scopeKey, draftKey, staleBefore, updatedAt, sendLeaseToken });
      const raw = await cursor.next();
      if (!raw) throw new EmailRepositoryError('conflict', 'Draft was already sent or is being sent');
      return decodeEmailDraft(parsedDocument(raw));
    },
    async renewDraftLease(draftKey: string, sendLeaseToken: string) {
      const updatedAt = new Date().toISOString();
      const cursor = await database.query(`FOR document IN documents FILTER document._key == @draftKey LET payload = JSON_PARSE(document.content) FILTER payload.data.status == "sending" && payload.data.sendLeaseToken == @sendLeaseToken UPDATE document WITH { content: JSON_STRINGIFY(MERGE(payload, { data: MERGE(payload.data, { sendStartedAt: @updatedAt }) })), updatedAt: @updatedAt } IN documents RETURN 1`, { draftKey, sendLeaseToken, updatedAt });
      return Boolean(await cursor.next());
    },
    async finishDraft(draftKey: string, sendLeaseToken: string, sent: boolean, providerMessageId?: string) {
      const updatedAt = new Date().toISOString();
      const cursor = await database.query(`FOR document IN documents FILTER document._key == @draftKey LET payload = JSON_PARSE(document.content) FILTER payload.data.sendLeaseToken == @sendLeaseToken UPDATE document WITH { content: JSON_STRINGIFY(MERGE(payload, { data: UNSET(MERGE(payload.data, { status: @status, providerMessageId: @providerMessageId }), ["sendStartedAt", "sendLeaseToken"]) })), updatedAt: @updatedAt } IN documents OPTIONS { keepNull: false } RETURN NEW`, { draftKey, sendLeaseToken, status: sent ? 'sent' : 'edited', providerMessageId: providerMessageId ?? null, updatedAt });
      const raw = await cursor.next();
      if (!raw) throw new EmailRepositoryError('conflict', 'Draft send lease was lost');
      return decodeEmailDraft(parsedDocument(raw));
    },
    async resolveAttachments(scopeKey: string, refs: EmailAttachmentRef[]) {
      await attachmentResources(scopeKey, refs);
      return emailAttachmentRefsSchema.parse(refs);
    },
    attachmentResources,
    async semanticReplyContext(scopeKey: string, embedding: number[], currentThreadKey: string, currentMessageKeys: string[]): Promise<SemanticReplyItem[]> {
      const cursor = await database.query(`FOR document IN documents
        FILTER document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "system-only"
        FILTER document._key != @currentThreadKey && document._key NOT IN @currentMessageKeys
        FILTER IS_ARRAY(document.embedding) && LENGTH(document.embedding) == LENGTH(@embedding)
        LET payload = JSON_PARSE(document.content)
        FILTER payload.version == 1 && payload.kind IN ["mail-thread", "mail-message"]
        FILTER payload.kind != "mail-message" || payload.data.threadKey != @currentThreadKey
        FILTER payload.data.embeddingContentVersion == 3
        LET similarity = COSINE_SIMILARITY(document.embedding, @embedding)
        FILTER IS_NUMBER(similarity) && similarity >= @minimumSimilarity
        SORT similarity DESC, document._key ASC
        LIMIT @candidateLimit
        RETURN { document, similarity }`, {
        scopeKey,
        folderKey: mailFolderKeys(scopeKey).threads,
        embedding,
        currentThreadKey,
        currentMessageKeys,
        minimumSimilarity: SEMANTIC_REPLY_MINIMUM_SIMILARITY,
        candidateLimit: SEMANTIC_REPLY_QUERY_CANDIDATES,
      });
      const candidates: Array<{ kind: 'thread'; similarity: number; value: EmailThread } | { kind: 'message'; similarity: number; value: EmailMessage }> = [];
      for (const { document, similarity } of await cursor.all() as Array<{ document: unknown; similarity: unknown }>) {
        if (typeof similarity !== 'number' || !Number.isFinite(similarity) || similarity < SEMANTIC_REPLY_MINIMUM_SIMILARITY) continue;
        try { candidates.push({ kind: 'thread', similarity, value: decodeEmailThread(parsedDocument(document)) }); continue; } catch { /* Try message. */ }
        try { candidates.push({ kind: 'message', similarity, value: decodeEmailMessage(parsedDocument(document)) }); } catch { /* Ignore malformed mail documents. */ }
      }
      candidates.sort((a, b) => b.similarity - a.similarity || (a.kind === b.kind ? a.value.key.localeCompare(b.value.key) : a.kind === 'message' ? -1 : 1));
      const owningThreads = new Set<string>();
      const items: SemanticReplyItem[] = [];
      for (const candidate of candidates) {
        if (items.length >= SEMANTIC_REPLY_MAX_ITEMS) break;
        if (candidate.value.key === currentThreadKey || currentMessageKeys.includes(candidate.value.key)) continue;
        let owningThreadKey: string;
        let item: SemanticReplyItem;
        if (candidate.kind === 'thread') {
          const thread = candidate.value as EmailThread;
          owningThreadKey = thread.key;
          if (owningThreads.has(owningThreadKey)) continue;
          item = { kind: 'thread', key: thread.key, similarity: candidate.similarity, providerThreadId: thread.providerThreadId, subject: thread.subject, summary: thread.summary, intent: thread.intent, ...(thread.action ? { action: thread.action } : {}), lastMessageAt: thread.lastMessageAt };
        } else {
          const message = candidate.value as EmailMessage;
          if (message.threadKey === currentThreadKey) continue;
          owningThreadKey = message.threadKey;
          if (owningThreads.has(owningThreadKey)) continue;
          item = { kind: 'message', key: message.key, similarity: candidate.similarity, providerMessageId: message.providerMessageId, threadKey: message.threadKey, subject: message.subject, body: message.body, from: message.from, to: message.to, direction: message.direction, sentAt: message.sentAt, trueOutboundReply: message.direction === 'outbound' && (message.replyDepth > 0 || message.inReplyTo != null || message.parentMessageId != null) };
        }
        if (JSON.stringify([...items, item]).length > SEMANTIC_REPLY_MAX_CHARACTERS) {
          const content = item.kind === 'thread' ? item.summary : item.body;
          let low = 0, high = content.length, fitting: SemanticReplyItem | null = null;
          while (low <= high) {
            const middle = Math.floor((low + high) / 2);
            const bounded: SemanticReplyItem = item.kind === 'thread' ? { ...item, summary: content.slice(0, middle) } : { ...item, body: content.slice(0, middle) };
            if (JSON.stringify([...items, bounded]).length <= SEMANTIC_REPLY_MAX_CHARACTERS) { fitting = bounded; low = middle + 1; } else high = middle - 1;
          }
          if (!fitting) break;
          item = fitting;
        }
        owningThreads.add(owningThreadKey);
        items.push(item);
        if (JSON.stringify(items).length >= SEMANTIC_REPLY_MAX_CHARACTERS) break;
      }
      return items;
    },
    async listReplyContext(scopeKey: string): Promise<EmailReplyContext[]> {
      const folders = await ensureMailFolders(database, scopeKey);
      const cursor = await database.query(`FOR document IN documents
        FILTER document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "system-only"
        LET payload = JSON_PARSE(document.content)
        FILTER payload.kind == "mail-reply-context" && payload.version == 1
        SORT document.createdAt ASC, document._key ASC LIMIT 21 RETURN document`, { scopeKey, folderKey: folders.replyContext });
      const notes = (await cursor.all()).map((document) => decodeEmailReplyContext(parsedDocument(document)));
      if (notes.length > REPLY_CONTEXT_MAX_NOTES || notes.reduce((total, note) => total + note.text.length, 0) > REPLY_CONTEXT_MAX_CHARACTERS) throw new EmailRepositoryError('conflict', 'Stored reply context exceeds its defensive limits');
      return notes;
    },
    async getReplyContext(scopeKey: string, noteKey: string): Promise<{ note: EmailReplyContext; revision: string } | null> {
      const cursor = await database.query(`FOR document IN documents
        FILTER document._key == @noteKey && document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "system-only"
        LET payload = JSON_PARSE(document.content)
        FILTER payload.kind == "mail-reply-context" && payload.version == 1
        LIMIT 1 RETURN document`, { scopeKey, noteKey, folderKey: mailFolderKeys(scopeKey).replyContext });
      const raw = await cursor.next() as Record<string, unknown> | undefined;
      if (!raw) return null;
      return { note: decodeEmailReplyContext(parsedDocument(raw)), revision: z.string().min(1).parse(raw._rev) };
    },
    async createReplyContext(scopeKey: string, input: { name: string; text: string; embedding: number[] }): Promise<EmailReplyContext> {
      const folders = await ensureMailFolders(database, scopeKey);
      const data = emailReplyContextDataSchema.parse({ name: input.name, text: input.text });
      const timestamp = new Date().toISOString();
      const key = newId();
      const payload = emailReplyContextPayloadSchema.parse({ version: 1, kind: 'mail-reply-context', data });
      const document = prepareEmailReplyContextDocument(archiveDocument({ key, scopeKey, folderKey: folders.replyContext, name: data.name, payload, embedding: input.embedding, createdAt: timestamp, updatedAt: timestamp }), data, input.embedding);
      const raw = await transactReplyContext(async (trx) => {
        const cursor = await trx.query(`LET conflictTarget = FIRST(FOR folder IN folders FILTER folder._key == @folderKey && folder.scopeKey == @scopeKey && folder.mutationPolicy == "system-container" UPDATE folder WITH { replyContextRevision: (folder.replyContextRevision || 0) + 1 } IN folders RETURN NEW._rev)
          LET notes = (FOR candidate IN documents
            FILTER candidate.scopeKey == @scopeKey && candidate.folderKey == @folderKey && candidate.mutationPolicy == "system-only"
            LET payload = JSON_PARSE(candidate.content) FILTER payload.kind == "mail-reply-context" && payload.version == 1 RETURN payload.data)
          LET allowed = conflictTarget != null && LENGTH(notes) < @maximumNotes && SUM(notes[* RETURN LENGTH(CURRENT.text)]) + LENGTH(@text) <= @maximumCharacters
          FOR permit IN allowed ? [1] : [] INSERT @document IN documents RETURN NEW`, { scopeKey, folderKey: folders.replyContext, text: data.text, maximumNotes: REPLY_CONTEXT_MAX_NOTES, maximumCharacters: REPLY_CONTEXT_MAX_CHARACTERS, document: toArangoDoc(document) });
        return cursor.next();
      });
      if (!raw) throw new EmailRepositoryError('conflict', 'Reply context is limited to 20 notes and 24,000 text characters');
      return decodeEmailReplyContext(parsedDocument(raw));
    },
    async updateReplyContext(scopeKey: string, noteKey: string, expectedUpdatedAt: string, expectedRevision: string, input: { name: string; text: string; embedding: number[] }): Promise<EmailReplyContext | null> {
      const data = emailReplyContextDataSchema.parse({ name: input.name, text: input.text });
      const payload = emailReplyContextPayloadSchema.parse({ version: 1, kind: 'mail-reply-context', data });
      const timestamp = new Date().toISOString();
      const base = archiveDocument({ key: noteKey, scopeKey, folderKey: mailFolderKeys(scopeKey).replyContext, name: data.name, payload, embedding: input.embedding, createdAt: timestamp, updatedAt: timestamp });
      const prepared = prepareEmailReplyContextDocument(base, data, input.embedding);
      const raw = await transactReplyContext(async (trx) => {
        const cursor = await trx.query(`LET conflictTarget = FIRST(FOR folder IN folders FILTER folder._key == @folderKey && folder.scopeKey == @scopeKey && folder.mutationPolicy == "system-container" UPDATE folder WITH { replyContextRevision: (folder.replyContextRevision || 0) + 1 } IN folders RETURN NEW._rev)
          LET current = DOCUMENT(documents, @noteKey)
          LET currentPayload = current == null ? null : JSON_PARSE(current.content)
          LET valid = conflictTarget != null && current != null && current.scopeKey == @scopeKey && current.folderKey == @folderKey && current.mutationPolicy == "system-only" && current.updatedAt == @expectedUpdatedAt && current._rev == @expectedRevision && currentPayload.kind == "mail-reply-context" && currentPayload.version == 1
          LET otherTextLength = SUM(FOR candidate IN documents FILTER candidate.scopeKey == @scopeKey && candidate.folderKey == @folderKey && candidate._key != @noteKey LET payload = JSON_PARSE(candidate.content) FILTER payload.kind == "mail-reply-context" && payload.version == 1 RETURN LENGTH(payload.data.text))
          FOR permit IN valid && otherTextLength + LENGTH(@text) <= @maximumCharacters ? [1] : []
            UPDATE current WITH { name: @name, content: @content, embedding: @embedding, contentChunks: @contentChunks, chunkEmbeddings: @chunkEmbeddings, semanticChunkCount: @semanticChunkCount, semanticContentHash: @semanticContentHash, emailReplyContextEmbeddingVersion: 1, updatedAt: @updatedAt } IN documents RETURN NEW`, {
          scopeKey, folderKey: mailFolderKeys(scopeKey).replyContext, noteKey, expectedUpdatedAt, expectedRevision, text: data.text,
          maximumCharacters: REPLY_CONTEXT_MAX_CHARACTERS, name: prepared.name, content: prepared.content, embedding: prepared.embedding, contentChunks: prepared.contentChunks, chunkEmbeddings: prepared.chunkEmbeddings, semanticChunkCount: prepared.semanticChunkCount, semanticContentHash: prepared.semanticContentHash, updatedAt: timestamp,
        });
        return cursor.next();
      });
      return raw ? decodeEmailReplyContext(parsedDocument(raw)) : null;
    },
    /** Atomic: if any key is missing or outside the protected reply-context boundary, nothing is deleted. */
    async deleteReplyContext(scopeKey: string, noteKeys: string[]) {
      const removed = await transactReplyContext<string[]>(async (trx) => {
        const cursor = await trx.query(`LET matches = (FOR document IN documents
            FILTER document._key IN @noteKeys && document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "system-only"
            LET payload = JSON_PARSE(document.content) FILTER payload.kind == "mail-reply-context" && payload.version == 1 RETURN document)
          FILTER LENGTH(matches) == LENGTH(@noteKeys)
          FOR document IN matches REMOVE document IN documents RETURN OLD._key`, { scopeKey, folderKey: mailFolderKeys(scopeKey).replyContext, noteKeys });
        return await cursor.all() as string[];
      });
      if (removed.length !== noteKeys.length) throw new EmailRepositoryError('not_found', 'Every reply-context note must belong to the authorized workspace');
      return { deletedKeys: noteKeys };
    },
    async listTones(scopeKey: string, embedTone?: (text: string) => Promise<number[]>) {
      const folders = await ensureMailFolders(database, scopeKey);
      const timestamp = new Date().toISOString();
      const placeholder = Array(EMBEDDING_DIMENSIONS).fill(0);
      const legacyDocuments = new Map((await listFolderDocuments(scopeKey, folders.tones)).map((document) => [document.key, document]));
      for (const legacy of legacyDefaultTones) {
        const key = stableKey('mail-tone', scopeKey, legacy.slug);
        const stored = legacyDocuments.get(key);
        if (!stored) continue;
        let decoded: EmailTone;
        try { decoded = decodeEmailTone(stored); } catch { continue; }
        const defaultContent = encodeEmailToneContent(legacy);
        const untouched = decoded.name === legacy.name && decoded.description === legacy.description && decoded.instruction === legacy.instruction && !decoded.isFavorite && !decoded.coverImageKey && stored.content === defaultContent && stored.createdAt === stored.updatedAt;
        let removed = false;
        if (untouched) {
          const cursor = await database.query(`FOR document IN documents
            FILTER document._key == @key && document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.content == @content && document.isFavorite != true && document.coverImageKey == null && document.createdAt == document.updatedAt
            LET hasVersions = LENGTH(FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey == @key LIMIT 1 RETURN 1) > 0
            LET hasSummaries = LENGTH(FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey == @key LIMIT 1 RETURN 1) > 0
            FILTER !hasVersions && !hasSummaries
            REMOVE document IN documents RETURN true`, { key, scopeKey, folderKey: folders.tones, content: defaultContent });
          removed = await cursor.next() === true;
        }
        if (!removed) {
          const customContent = encodeEmailToneContent({ name: decoded.name, description: decoded.description, instruction: decoded.instruction });
          await database.query('FOR document IN documents FILTER document._key == @key && document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.content == @expectedContent UPDATE document WITH { content: @customContent, updatedAt: @updatedAt } IN documents RETURN NEW', { key, scopeKey, folderKey: folders.tones, expectedContent: stored.content, customContent, updatedAt: timestamp });
        }
      }
      const existing = new Map((await listFolderDocuments(scopeKey, folders.tones)).map((document) => [document.key, document]));
      for (const tone of defaultTones) {
        const key = stableKey('mail-tone', scopeKey, tone.slug);
        const stored = existing.get(key);
        if (stored) {
          continue;
        }
        const content = encodeEmailToneContent(tone);
        const embedding = embedTone ? await embedTone(emailToneSemanticText(tone)) : placeholder;
        const document = archiveDocument({ key, scopeKey, folderKey: folders.tones, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding, createdAt: timestamp, updatedAt: timestamp, mutationPolicy: 'user' });
        document.content = content;
        await database.query('UPSERT { _key: @key } INSERT @document UPDATE {} IN documents', { key, document: toArangoDoc(prepareEmailToneDocument(document, tone, embedding)) });
      }
      const documents = await listFolderDocuments(scopeKey, folders.tones);
      if (embedTone) for (const stored of documents) {
        let decoded: EmailTone;
        try { decoded = decodeEmailTone(stored); } catch { continue; }
        const semanticText = emailToneSemanticText(decoded);
        const expectedChunks = chunkDocumentContent(semanticText);
        const stale = stored.emailToneEmbeddingVersion !== 1
          || stored.semanticContentHash !== documentSemanticHash(semanticText)
          || stored.semanticChunkCount !== expectedChunks.length
          || stored.contentChunks?.length !== expectedChunks.length
          || expectedChunks.some((chunk, index) => stored.contentChunks?.[index] !== chunk)
          || stored.chunkEmbeddings?.length !== expectedChunks.length;
        if (!stale) continue;
        const embedding = await embedTone(semanticText);
        const prepared = prepareEmailToneDocument(stored, decoded, embedding);
        await database.collection('documents').update(stored.key, { embedding: prepared.embedding, contentChunks: prepared.contentChunks, chunkEmbeddings: prepared.chunkEmbeddings, semanticChunkCount: prepared.semanticChunkCount, semanticContentHash: prepared.semanticContentHash, emailToneEmbeddingVersion: 1 });
      }
      return documents.flatMap((document) => {
        try { return [decodeEmailTone(document)]; } catch { return []; }
      }).sort((a, b) => {
        const aIndex = defaultTones.findIndex(({ slug }) => slug === a.slug), bIndex = defaultTones.findIndex(({ slug }) => slug === b.slug);
        const rank = (index: number) => index < 0 ? defaultTones.length : index;
        return rank(aIndex) - rank(bIndex) || a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key);
      });
    },
    async getTone(scopeKey: string, toneKey: string): Promise<EmailTone | null> {
      const document = await getDocument(scopeKey, toneKey);
      if (!document) return null;
      try { return decodeEmailTone(document); } catch { return null; }
    },
    async createTone(scopeKey: string, input: { name: string; description?: string; instruction: string; coverImageKey?: string; isFavorite: boolean; embedding: number[] }): Promise<{ tone: EmailTone; coverStorageKey?: string }> {
      const folders = await ensureMailFolders(database, scopeKey);
      const timestamp = new Date().toISOString();
      const key = newId();
      const data = emailTonePayloadSchema.shape.data.parse({ identifier: key, name: input.name, description: input.description, instruction: input.instruction });
      const document = archiveDocument({ key, scopeKey, folderKey: folders.tones, name: input.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data }), embedding: input.embedding, createdAt: timestamp, updatedAt: timestamp, mutationPolicy: 'user' });
      document.content = encodeEmailToneContent(data);
      document.isFavorite = input.isFavorite;
      const persistedDocument = prepareEmailToneDocument({ ...document, ...(input.coverImageKey ? { coverImageKey: input.coverImageKey } : {}) }, data, input.embedding);
      const cursor = await database.query(`LET cover = @coverImageKey == null ? null : DOCUMENT(images, @coverImageKey)
        FILTER @coverImageKey == null || (cover != null && cover.scopeKey == @scopeKey)
        INSERT @document IN documents RETURN { document: NEW, coverStorageKey: cover.storageKey }`, { scopeKey, coverImageKey: input.coverImageKey ?? null, document: toArangoDoc(persistedDocument) });
      const raw = await cursor.next() as { document: Record<string, unknown>; coverStorageKey?: string } | undefined;
      if (!raw) throw new EmailRepositoryError('forbidden', 'Tone cover image must belong to the authorized scope');
      return { tone: decodeEmailTone(parsedDocument(raw.document)), ...(raw.coverStorageKey ? { coverStorageKey: raw.coverStorageKey } : {}) };
    },
    async updateTone(scopeKey: string, toneKey: string, expectedUpdatedAt: string, patch: { name?: string; description?: string | null; instruction?: string; coverImageKey?: string | null; isFavorite?: boolean; embedding?: number[] }): Promise<{ tone: EmailTone; coverStorageKey?: string } | null> {
      const current = await getDocument(scopeKey, toneKey);
      if (!current) return null;
      let tone: EmailTone;
      try { tone = decodeEmailTone(current); } catch { return null; }
      const data = emailTonePayloadSchema.shape.data.parse({ identifier: tone.identifier, slug: tone.slug, name: patch.name ?? tone.name, description: Object.prototype.hasOwnProperty.call(patch, 'description') ? patch.description ?? undefined : tone.description, instruction: patch.instruction ?? tone.instruction });
      const content = encodeEmailToneContent(data);
      const embedding = patch.embedding ?? tone.embedding;
      const prepared = prepareEmailToneDocument({ ...current, name: data.name, content }, data, embedding);
      const cursor = await database.query(`FOR document IN documents FILTER document._key == @toneKey && document.scopeKey == @scopeKey && document.updatedAt == @expectedUpdatedAt
        LET cover = !@setCover || @coverImageKey == null ? null : DOCUMENT(images, @coverImageKey)
        FILTER !@setCover || @coverImageKey == null || (cover != null && cover.scopeKey == @scopeKey)
        UPDATE document WITH MERGE({ name: @name, content: @content, embedding: @embedding, contentChunks: @contentChunks, chunkEmbeddings: @chunkEmbeddings, semanticChunkCount: @semanticChunkCount, semanticContentHash: @semanticContentHash, emailToneEmbeddingVersion: 1, updatedAt: @updatedAt }, @setCover ? { coverImageKey: @coverImageKey } : {}, @setFavorite ? { isFavorite: @isFavorite } : {}) IN documents OPTIONS { keepNull: false }
        RETURN { document: NEW, coverStorageKey: cover.storageKey }`, { scopeKey, toneKey, expectedUpdatedAt, name: data.name, content, embedding, contentChunks: prepared.contentChunks, chunkEmbeddings: prepared.chunkEmbeddings, semanticChunkCount: prepared.semanticChunkCount, semanticContentHash: prepared.semanticContentHash, updatedAt: new Date().toISOString(), setCover: Object.prototype.hasOwnProperty.call(patch, 'coverImageKey'), coverImageKey: patch.coverImageKey ?? null, setFavorite: patch.isFavorite !== undefined, isFavorite: patch.isFavorite ?? false });
      const raw = await cursor.next() as { document: Record<string, unknown>; coverStorageKey?: string } | undefined;
      return raw ? { tone: decodeEmailTone(parsedDocument(raw.document)), ...(raw.coverStorageKey ? { coverStorageKey: raw.coverStorageKey } : {}) } : null;
    },
    async toneCoverStorageKey(scopeKey: string, coverImageKey?: string) {
      if (!coverImageKey) return undefined;
      const cursor = await database.query('FOR image IN images FILTER image._key == @coverImageKey && image.scopeKey == @scopeKey LIMIT 1 RETURN image.storageKey', { scopeKey, coverImageKey });
      return (await cursor.next()) as string | undefined;
    },
  };
}

export type EmailRepository = ReturnType<typeof createEmailRepository>;
