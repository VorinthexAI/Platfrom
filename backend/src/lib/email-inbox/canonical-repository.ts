import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { withDatabaseTransaction, db } from '@/lib/db/client';
import {
  EMAIL_DRAFTS_COLLECTION,
  EMAIL_MESSAGES_COLLECTION,
  EMAIL_REPLY_CONTEXT_COLLECTION,
  EMAIL_THREADS_COLLECTION,
  EMAIL_TONES_COLLECTION,
  emailDraftRecordSchema,
  emailMessageRecordSchema,
  emailReplyContextRecordSchema,
  emailThreadRecordSchema,
  emailToneRecordSchema,
} from '@/lib/db/email-records.node';
import { EMAIL_ATTACHMENTS_COLLECTION, emailAttachmentSchema } from '@/lib/db/email-attachments.node';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { compareEmailMessages } from './message-order';
import { emailAttachmentRefsSchema, emailDraftPayloadSchema, emailReplyContextDataSchema, emailToneDataSchema, type EmailDraft, type EmailDraftCreate, type EmailAttachmentRef, type EmailMessage, type EmailReplyContext, type EmailThread, type EmailTone } from './archive-payloads';
import { ORGANIZATION_CONNECTORS_COLLECTION } from './connector-schema';
import type { PreparedDocumentRepresentation } from '@/lib/ai/document-processing';
import type { StagedEmailAttachment } from './attachment-ingestion';
import { exportEmailMessageToArchive, exportEmailThreadToArchive } from './exports';
import { documentVersionSchema, type DocumentVersion } from '@/lib/db/document-versions.node';
import { documentSummarySchema, type DocumentSummary } from '@/lib/db/document-summaries.node';
import { emailExportContainerKeys } from './export-container-keys';

type Database = Pick<typeof db, 'query'> & Partial<Pick<typeof db, 'beginTransaction'>>;
type RepositoryError = (reason: 'not_found' | 'forbidden' | 'conflict', message?: string) => Error;
type StableKey = (kind: string, ...values: string[]) => string;
const raw = (value: unknown) => withArangoKey(value as Record<string, unknown>);

export function createCanonicalEmailRepository(database: Database, error: RepositoryError, stableKey: StableKey) {
  const parseThread = (value: unknown): EmailThread => emailThreadRecordSchema.parse(raw(value)) as EmailThread;
  const parseMessage = (value: unknown): EmailMessage => emailMessageRecordSchema.parse(raw(value)) as EmailMessage;
  const parseDraft = (value: unknown): EmailDraft => emailDraftRecordSchema.parse(raw(value)) as EmailDraft;
  const parseTone = (value: unknown): EmailTone => emailToneRecordSchema.parse(raw(value)) as EmailTone;
  const parseNote = (value: unknown): EmailReplyContext => emailReplyContextRecordSchema.parse(raw(value)) as EmailReplyContext;
  const transaction = <T>(write: string[], operation: (executor: Pick<typeof db, 'query'>) => Promise<T>) => database.beginTransaction
    ? withDatabaseTransaction(database as typeof db, { read: [ORGANIZATION_CONNECTORS_COLLECTION], write }, operation)
    : operation(database);
  const get = async <T>(collection: string, parser: (value: unknown) => T, scopeKey: string, key: string): Promise<T | null> => {
    const cursor = await database.query('LET value = DOCUMENT(@@collection, @key) FILTER value != null && value.scopeKey == @scopeKey RETURN value', { '@collection': collection, scopeKey, key });
    const value = await cursor.next();
    return value ? parser(value) : null;
  };
  const list = async <T>(collection: string, parser: (value: unknown) => T, scopeKey: string): Promise<T[]> => {
    const cursor = await database.query('FOR value IN @@collection FILTER value.scopeKey == @scopeKey RETURN value', { '@collection': collection, scopeKey });
    return (await cursor.all()).map(parser);
  };
  const draftRecord = (input: EmailDraftCreate, key: string, timestamp: string) => {
    const kind = input.variant === 'new' ? 'mail-new-draft' : 'mail-reply-draft';
    const { scopeKey, embedding, ...draft } = input;
    const data = emailDraftPayloadSchema.parse({ version: 1, kind, data: draft }).data;
    return emailDraftRecordSchema.parse({ ...data, key, scopeKey, embedding, createdAt: timestamp, updatedAt: timestamp });
  };
  const exportThread = async (thread: z.infer<typeof emailThreadRecordSchema>, messages: Array<z.infer<typeof emailMessageRecordSchema>>, timestamp: string) => {
    try {
      const { rootKey, inboxKey } = emailExportContainerKeys(thread.scopeKey, thread.accountKey);
      const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
      const root = await database.query('UPSERT { _key: @key } INSERT { _key: @key, scopeKey: @scopeKey, name: "Signal", presentation: "communication", mutationPolicy: "user", embedding: @embedding, isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE { presentation: "communication" } IN folders RETURN NEW', { key: rootKey, scopeKey: thread.scopeKey, embedding, now: timestamp });
      const rootValue = await root.next() as { scopeKey?: unknown } | undefined;
      if (rootValue?.scopeKey !== thread.scopeKey) return;
      const inbox = await database.query('LET source = FIRST(FOR value IN emailInboxes FILTER value.scopeKey == @scopeKey && value.connectorKey == @connectorKey LIMIT 1 RETURN value) FILTER source != null UPSERT { _key: @key } INSERT { _key: @key, scopeKey: @scopeKey, parentFolderKey: @rootKey, name: source.name, mutationPolicy: "user", embedding: source.embedding, isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE { presentation: null } IN folders OPTIONS { keepNull: false } RETURN NEW', { key: inboxKey, rootKey, scopeKey: thread.scopeKey, connectorKey: thread.accountKey, now: timestamp });
      const inboxValue = await inbox.next() as { scopeKey?: unknown } | undefined;
      if (inboxValue?.scopeKey !== thread.scopeKey) return;
      const exports = [
        exportEmailThreadToArchive(thread, { scopeKey: thread.scopeKey, exportKey: stableKey('email-archive-thread-export', thread.key), folderKey: inboxKey, exportedAt: timestamp }),
        ...messages.map((message) => exportEmailMessageToArchive(message, { scopeKey: thread.scopeKey, exportKey: stableKey('email-archive-message-export', message.key), folderKey: inboxKey, exportedAt: timestamp })),
      ];
      await database.query('FOR value IN @values UPSERT { _key: value._key } INSERT value UPDATE {} IN documents', { values: exports.map(toArangoDoc) });
    } catch { /* Archive exports are independent convenience copies. */ }
  };

  return {
    async unchangedProviderThreadIds(scopeKey: string, accountKey: string, requested: Array<{ providerThreadId: string; messages: Array<{ providerMessageId: string; labels: string[]; sentAt: string }> }>) {
      if (!requested.length) return new Set<string>();
      const cursor = await database.query(`FOR thread IN emailThreads FILTER thread.scopeKey == @scopeKey && thread.accountKey == @accountKey && thread.providerThreadId IN @ids LET messages = (FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.accountKey == @accountKey && message.threadKey == thread._key SORT message.providerMessageId RETURN { providerMessageId: message.providerMessageId, labels: SORTED_UNIQUE(message.labels || []), sentAt: message.sentAt }) RETURN { providerThreadId: thread.providerThreadId, messages }`, { scopeKey, accountKey, ids: requested.map(({ providerThreadId }) => providerThreadId) });
      const normalize = (messages: Array<{ providerMessageId: string; labels: string[]; sentAt: string }>) => JSON.stringify(messages.map((message) => ({ ...message, labels: [...new Set(message.labels)].sort() })).sort((a, b) => a.providerMessageId.localeCompare(b.providerMessageId)));
      const stored = new Map((await cursor.all() as Array<{ providerThreadId: string; messages: typeof requested[number]['messages'] }>).map((row) => [row.providerThreadId, normalize(row.messages)]));
      return new Set(requested.flatMap((thread) => stored.get(thread.providerThreadId) === normalize(thread.messages) ? [thread.providerThreadId] : []));
    },
    async providerThreadIdForMessage(scopeKey: string, accountKey: string, providerMessageId: string) {
      const cursor = await database.query('FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.accountKey == @accountKey && message.providerMessageId == @providerMessageId LET thread = DOCUMENT(emailThreads, message.threadKey) FILTER thread != null && thread.scopeKey == @scopeKey && thread.accountKey == @accountKey LIMIT 1 RETURN thread.providerThreadId', { scopeKey, accountKey, providerMessageId });
      return await cursor.next() as string | null;
    },
    async syncThread(input: {
      thread: Omit<EmailThread, 'key' | 'createdAt' | 'updatedAt'> & { archiveRepresentation?: PreparedDocumentRepresentation };
      messages: Array<Omit<EmailMessage, 'key' | 'threadKey' | 'createdAt' | 'updatedAt' | 'attachmentAvailability'> & Partial<Pick<EmailMessage, 'attachmentAvailability'>> & { archiveRepresentation?: PreparedDocumentRepresentation }>;
      reconcileMessages?: boolean;
      lease?: { kind: 'sync' | 'send'; connectorKey: string; token: string };
      attachmentCommits?: StagedEmailAttachment[];
    }) {
      const timestamp = new Date().toISOString();
      const threadKey = stableKey('mail-thread', input.thread.scopeKey, input.thread.accountKey, input.thread.providerThreadId);
      const { archiveRepresentation: _threadExport, ...threadInput } = input.thread;
      const thread = emailThreadRecordSchema.parse({ ...threadInput, key: threadKey, createdAt: timestamp, updatedAt: timestamp });
      const messages = input.messages.map((source) => {
        const key = stableKey('mail-message', source.scopeKey, source.accountKey, source.providerMessageId);
        const { archiveRepresentation: _messageExport, ...messageInput } = source;
        return emailMessageRecordSchema.parse({ ...messageInput, key, threadKey, createdAt: timestamp, updatedAt: timestamp });
      });
      const stored = await transaction([EMAIL_THREADS_COLLECTION, EMAIL_MESSAGES_COLLECTION, EMAIL_DRAFTS_COLLECTION, EMAIL_ATTACHMENTS_COLLECTION, ...(input.lease ? [ORGANIZATION_CONNECTORS_COLLECTION] : [])], async (trx) => {
        if (input.lease) {
          const tokenField = input.lease.kind === 'sync' ? 'syncLeaseToken' : 'sendLeaseToken';
          const expiryField = input.lease.kind === 'sync' ? 'syncLeaseExpiresAt' : 'sendLeaseExpiresAt';
          const fence = await trx.query('LET connector = DOCUMENT(@@connectors, @key) FILTER connector != null && connector.status != "revoked" && connector.syncEnabled != false && connector[@tokenField] == @token && connector[@expiryField] > @now RETURN true', { '@connectors': ORGANIZATION_CONNECTORS_COLLECTION, key: input.lease.connectorKey, token: input.lease.token, tokenField, expiryField, now: timestamp });
          if (await fence.next() !== true) throw error('conflict', `Email ${input.lease.kind} lease was lost before persistence`);
        }
        const threadCursor = await trx.query('UPSERT { _key: @key } INSERT @value UPDATE MERGE(@value, { createdAt: OLD.createdAt }) IN emailThreads RETURN NEW', { key: threadKey, value: toArangoDoc(thread) });
        const keep: string[] = [];
        for (const message of messages) {
          keep.push(message.key);
          await trx.query('UPSERT { _key: @key } INSERT @value UPDATE MERGE(@value, { createdAt: OLD.createdAt }) IN emailMessages', { key: message.key, value: toArangoDoc(message) });
        }
        if (input.reconcileMessages !== false) await trx.query('FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.threadKey == @threadKey && message._key NOT IN @keep REMOVE message IN emailMessages', { scopeKey: thread.scopeKey, threadKey, keep });
        for (const attachment of input.attachmentCommits ?? []) await trx.query('FOR value IN emailAttachments FILTER value._key == @key && value.status == "processing" && value.leaseToken == @token UPDATE value WITH { status: "completed", leaseToken: null, leaseExpiresAt: null, updatedAt: @now } IN emailAttachments OPTIONS { keepNull: false }', { key: attachment.bindingKey, token: attachment.leaseToken, now: timestamp });
        return Object.assign(parseThread(await threadCursor.next()), { attachmentMutation: { documentKeys: [], imageKeys: [], collectionKeys: [] } });
      });
      await exportThread(thread, messages, timestamp);
      return stored;
    },
    async thread(scopeKey: string, threadKey: string) {
      const thread = await get(EMAIL_THREADS_COLLECTION, parseThread, scopeKey, threadKey);
      if (!thread || thread.inInbox === false) throw error('not_found');
      const cursor = await database.query('FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.threadKey == @threadKey RETURN message', { scopeKey, threadKey });
      return { thread, messages: (await cursor.all()).map(parseMessage).sort(compareEmailMessages) };
    },
    async message(scopeKey: string, messageKey: string) {
      const message = await get(EMAIL_MESSAGES_COLLECTION, parseMessage, scopeKey, messageKey);
      if (!message) throw error('not_found');
      return message;
    },
    async mailbox(scopeKey: string, accountKey: string) {
      const [threads, messages] = await Promise.all([list(EMAIL_THREADS_COLLECTION, parseThread, scopeKey), list(EMAIL_MESSAGES_COLLECTION, parseMessage, scopeKey)]);
      const selected = threads.filter((thread) => thread.accountKey === accountKey);
      const keys = new Set(selected.map(({ key }) => key));
      return { threads: selected, messages: messages.filter((message) => message.accountKey === accountKey && keys.has(message.threadKey)) };
    },
    async overview(scopeKey: string, connectorKey: string, query: any) {
      const threads = (await list(EMAIL_THREADS_COLLECTION, parseThread, scopeKey)).filter((thread) => thread.accountKey === connectorKey && thread.inInbox !== false);
      const messages = (await list(EMAIL_MESSAGES_COLLECTION, parseMessage, scopeKey)).filter((message) => message.accountKey === connectorKey);
      const search = query.search?.trim().toLowerCase() ?? '';
      const matchesSearch = (thread: typeof threads[number]) => !search || messages.some((message) => message.threadKey === thread.key && `${message.from} ${message.subject} ${message.body}`.toLowerCase().includes(search));
      const active = threads.filter((thread) => !thread.labels?.includes('TRASH'));
      const filtered = threads.filter((thread) => {
        const trash = thread.labels?.includes('TRASH') ?? false;
        if (query.filter) return query.filter === 'trash' ? trash : !trash && (query.filter === 'all' || query.filter === 'important' && thread.inboxCategory === 'Important' || query.filter === 'urgent' && thread.inboxCategory === 'Urgent' || query.filter === 'needs_action' && thread.state === 'needs_action' || query.filter === 'filtered' && thread.inboxCategory === 'Filtered' || query.filter === 'unread' && thread.unread || query.filter === 'favorite' && thread.isFavorite);
        const facets: string[] = query.facets ?? [];
        return !trash && (query.readState == null || thread.unread === (query.readState === 'unread')) && (!facets.includes('favorite') || thread.isFavorite) && (!facets.some((value) => ['urgent', 'important', 'filtered'].includes(value)) || facets.includes((thread.inboxCategory ?? 'Important').toLowerCase()));
      }).filter(matchesSearch).sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt) || a.key.localeCompare(b.key));
      const limit = query.limit ?? 50;
      const fingerprint = stableKey('mail-overview-cursor', scopeKey, connectorKey, JSON.stringify({ filter: query.filter ?? null, readState: query.readState ?? null, facets: [...(query.facets ?? [])].sort(), search }));
      const after = query.cursor ? z.object({ v: z.literal(1), fingerprint: z.string().cuid(), lastMessageAt: z.string().datetime(), key: z.string().cuid() }).strict().parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8'))) : null;
      if (after && after.fingerprint !== fingerprint) throw error('conflict', 'Email cursor belongs to another connector, scope, or query');
      const page = after ? filtered.filter((thread) => thread.lastMessageAt < after.lastMessageAt || thread.lastMessageAt === after.lastMessageAt && thread.key > after.key) : filtered;
      const selected = page.slice(0, limit), last = selected.at(-1);
      const nextCursor = page.length > limit && last ? Buffer.from(JSON.stringify({ v: 1, fingerprint, lastMessageAt: last.lastMessageAt, key: last.key })).toString('base64url') : null;
      return { threads: selected, nextCursor, counts: { all: active.length, important: active.filter((value) => value.inboxCategory === 'Important').length, urgent: active.filter((value) => value.inboxCategory === 'Urgent').length, needsAction: active.filter((value) => value.state === 'needs_action').length, filtered: active.filter((value) => value.inboxCategory === 'Filtered').length, unread: active.filter((value) => value.unread).length, favorite: active.filter((value) => value.isFavorite).length, trash: threads.length - active.length } };
    },
    async searchThreads(scopeKey: string, connectorKey: string, embedding: number[], query: string, minimumScore: number, limit: number, filters?: { readState?: 'read' | 'unread'; facets?: Array<'urgent' | 'important' | 'filtered' | 'favorite'> }) {
      const facets = [...new Set(filters?.facets ?? [])];
      const cursor = await database.query(`FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.accountKey == @connectorKey && message.embeddingContentVersion == 4 LET thread = DOCUMENT(emailThreads, message.threadKey) FILTER thread != null && thread.inInbox != false && "TRASH" NOT IN (thread.labels || []) FILTER @readState == null || thread.unread == (@readState == "unread") FILTER LENGTH(@facets) == 0 || (("favorite" NOT IN @facets || thread.isFavorite == true) && (!LENGTH(INTERSECTION(@facets, ["urgent", "important", "filtered"])) || LOWER(thread.inboxCategory) IN @facets)) LET direct = CONTAINS(LOWER(CONCAT_SEPARATOR(" ", message.from, message.subject, message.body)), @query) LET similarity = COSINE_SIMILARITY(message.embedding, @embedding) LET score = direct ? 1 : similarity FILTER direct || IS_NUMBER(similarity) && similarity >= @minimumScore COLLECT threadKey = thread._key INTO rows = { thread, score } LET selected = FIRST(FOR row IN rows SORT row.score DESC LIMIT 1 RETURN row) SORT selected.score DESC, selected.thread.lastMessageAt DESC LIMIT @limit RETURN selected`, { scopeKey, connectorKey, embedding, query: query.trim().toLowerCase(), minimumScore, limit, readState: filters?.readState ?? null, facets });
      return (await cursor.all() as any[]).map((row) => ({ thread: parseThread(row.thread), score: row.score }));
    },
    async similarMessages(scopeKey: string, messageKey: string, embedding: number[], limit = 10) { const source = await this.message(scopeKey, messageKey); const cursor = await database.query('FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.accountKey == @accountKey && message._key != @messageKey && message.threadKey != @threadKey && message.embeddingContentVersion == 4 LET similarity = COSINE_SIMILARITY(message.embedding, @embedding) FILTER IS_NUMBER(similarity) SORT similarity DESC LIMIT @limit RETURN { message, similarity }', { scopeKey, accountKey: source.accountKey, messageKey, threadKey: source.threadKey, embedding, limit: Math.min(limit, 10) }); return (await cursor.all() as any[]).map((row) => ({ message: parseMessage(row.message), similarity: row.similarity })); },
    async mutateThreadState(input: any) { const now = new Date().toISOString(), mutation = input.mutation.kind, enabled = mutation === 'favorite' ? input.mutation.isFavorite : mutation === 'read-state' ? input.mutation.isRead : true; const cursor = await transaction([EMAIL_THREADS_COLLECTION, EMAIL_MESSAGES_COLLECTION, ORGANIZATION_CONNECTORS_COLLECTION], async (trx) => trx.query(`LET connector = DOCUMENT(@@connectors, @connectorKey) FILTER connector != null && connector.syncLeaseToken == @token && connector.syncLeaseExpiresAt > @now LET thread = DOCUMENT(emailThreads, @threadKey) FILTER thread != null && thread.scopeKey == @scopeKey && thread.accountKey == @accountKey LET labels = @mutation == "favorite" ? (@enabled ? PUSH(thread.labels || [], "STARRED", true) : REMOVE_VALUE(thread.labels || [], "STARRED")) : @mutation == "read-state" ? (@enabled ? REMOVE_VALUE(thread.labels || [], "UNREAD") : PUSH(thread.labels || [], "UNREAD", true)) : PUSH(thread.labels || [], "TRASH", true) LET changed = (FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.threadKey == @threadKey LET messageLabels = @mutation == "favorite" ? (@enabled ? PUSH(message.labels || [], "STARRED", true) : REMOVE_VALUE(message.labels || [], "STARRED")) : @mutation == "read-state" ? (@enabled ? REMOVE_VALUE(message.labels || [], "UNREAD") : PUSH(message.labels || [], "UNREAD", true)) : PUSH(message.labels || [], "TRASH", true) UPDATE message WITH MERGE({ labels: messageLabels, updatedAt: @now }, @mutation == "read-state" ? { unread: !@enabled } : {}) IN emailMessages RETURN 1) UPDATE thread WITH MERGE({ labels, updatedAt: @now }, @mutation == "favorite" ? { isFavorite: @enabled, starred: @enabled } : @mutation == "read-state" ? { unread: !@enabled } : { inInbox: true }) IN emailThreads RETURN NEW`, { '@connectors': ORGANIZATION_CONNECTORS_COLLECTION, connectorKey: input.lease.connectorKey, token: input.lease.token, scopeKey: input.scopeKey, accountKey: input.accountKey, threadKey: input.threadKey, mutation, enabled, now })); const value = await cursor.next(); if (!value) throw error('conflict', 'Email connector lease or selected thread changed before persistence'); return parseThread(value); },
    async deleteProviderThread(scopeKey: string, accountKey: string, providerThreadId: string, lease: { connectorKey: string; token: string }) { const key = stableKey('mail-thread', scopeKey, accountKey, providerThreadId), now = new Date().toISOString(); const cursor = await transaction([EMAIL_THREADS_COLLECTION, EMAIL_MESSAGES_COLLECTION, EMAIL_DRAFTS_COLLECTION, ORGANIZATION_CONNECTORS_COLLECTION], async (trx) => trx.query('LET connector = DOCUMENT(@@connectors, @connectorKey) FILTER connector != null && connector.syncLeaseToken == @token && connector.syncLeaseExpiresAt > @now LET messages = (FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.threadKey == @threadKey REMOVE message IN emailMessages RETURN 1) LET drafts = (FOR draft IN emailDrafts FILTER draft.scopeKey == @scopeKey && draft.threadKey == @threadKey REMOVE draft IN emailDrafts RETURN 1) LET thread = DOCUMENT(emailThreads, @threadKey) LET removed = thread != null && thread.scopeKey == @scopeKey ? FIRST(REMOVE thread IN emailThreads RETURN 1) : null RETURN LENGTH(messages) + LENGTH(drafts) + (removed == null ? 0 : 1)', { '@connectors': ORGANIZATION_CONNECTORS_COLLECTION, connectorKey: lease.connectorKey, token: lease.token, now, scopeKey, threadKey: key })); const count = await cursor.next(); if (count === undefined) throw error('conflict', 'Email synchronization lease was lost before deleting a provider thread'); return { documentsDeleted: Number(count), attachmentMutation: { documentKeys: [], imageKeys: [], collectionKeys: [] } }; },
    async reconcileInbox(scopeKey: string, accountKey: string, providerThreadIds: string[], lease: { connectorKey: string; token: string }) { const cursor = await database.query('LET connector = DOCUMENT(@@connectors, @connectorKey) FILTER connector != null && connector.syncLeaseToken == @token && connector.syncLeaseExpiresAt > @now RETURN (FOR thread IN emailThreads FILTER thread.scopeKey == @scopeKey && thread.accountKey == @accountKey && thread.providerThreadId NOT IN @keep SORT thread.providerThreadId RETURN thread.providerThreadId)', { '@connectors': ORGANIZATION_CONNECTORS_COLLECTION, connectorKey: lease.connectorKey, token: lease.token, now: new Date().toISOString(), scopeKey, accountKey, keep: providerThreadIds }); const value = await cursor.next(); if (!value) throw error('conflict', 'Email synchronization lease was lost before reconciling the inbox'); return value; },
    async clearTrash(input: { scopeKey: string; accountKey: string; providerMessageIds: string[]; trashSnapshotAt: string; lease: { connectorKey: string; token: string } }) {
      const now = new Date().toISOString();
      const cursor = await transaction([EMAIL_THREADS_COLLECTION, EMAIL_MESSAGES_COLLECTION, EMAIL_DRAFTS_COLLECTION, ORGANIZATION_CONNECTORS_COLLECTION], async (trx) => trx.query(`LET connector = DOCUMENT(@@connectors, @connectorKey) FILTER connector != null && connector.syncLeaseToken == @token && connector.syncLeaseExpiresAt > @now LET removedMessages = (FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.accountKey == @accountKey FILTER message.providerMessageId IN @providerMessageIds || ("TRASH" IN (message.labels || []) && message.updatedAt <= @snapshot) REMOVE message IN emailMessages RETURN OLD) LET threadKeys = UNIQUE(removedMessages[*].threadKey) LET emptyThreadKeys = (FOR threadKey IN threadKeys FILTER LENGTH(FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.threadKey == threadKey LIMIT 1 RETURN 1) == 0 RETURN threadKey) LET removedDrafts = (FOR draft IN emailDrafts FILTER draft.scopeKey == @scopeKey && draft.variant == "reply" && draft.threadKey IN emptyThreadKeys REMOVE draft IN emailDrafts RETURN 1) LET removedThreads = (FOR thread IN emailThreads FILTER thread.scopeKey == @scopeKey && thread._key IN emptyThreadKeys REMOVE thread IN emailThreads RETURN 1) RETURN { threadsDeleted: LENGTH(removedThreads), documentsDeleted: LENGTH(removedMessages) + LENGTH(removedDrafts) + LENGTH(removedThreads) }`, { '@connectors': ORGANIZATION_CONNECTORS_COLLECTION, connectorKey: input.lease.connectorKey, token: input.lease.token, now, scopeKey: input.scopeKey, accountKey: input.accountKey, providerMessageIds: input.providerMessageIds, snapshot: input.trashSnapshotAt }));
      const result = await cursor.next() as { threadsDeleted: number; documentsDeleted: number } | undefined;
      if (!result) throw error('conflict', 'Email connector lease was lost before clearing Trash');
      return { ...result, attachmentMutation: { documentKeys: [], imageKeys: [], collectionKeys: [] } };
    },
    async createMessageTranslation(input: Omit<DocumentVersion, 'key' | 'version' | 'createdAt'>) {
      const snapshot = documentVersionSchema.omit({ key: true, version: true, createdAt: true }).parse(input);
      const cursor = await database.query(`LET message = DOCUMENT(emailMessages, @messageKey) FILTER message != null && message.scopeKey == @scopeKey LET nextVersion = FIRST(FOR value IN documentVersions FILTER value.scopeKey == @scopeKey && value.documentKey == @messageKey COLLECT AGGREGATE maximum = MAX(value.version) RETURN (maximum || 0) + 1) INSERT MERGE(@snapshot, { _key: @key, version: nextVersion, createdAt: @now }) IN documentVersions RETURN NEW`, { messageKey: input.documentKey, scopeKey: input.scopeKey, snapshot, key: newId(), now: new Date().toISOString() });
      const value = await cursor.next(); if (!value) throw error('not_found'); return documentVersionSchema.parse(raw(value));
    },
    async listMessageTranslations(scopeKey: string, messageKey: string) { await this.message(scopeKey, messageKey); const cursor = await database.query('FOR value IN documentVersions FILTER value.scopeKey == @scopeKey && value.documentKey == @messageKey && value.type == "translation" SORT value.version DESC RETURN value', { scopeKey, messageKey }); return (await cursor.all()).map((value) => documentVersionSchema.parse(raw(value))); },
    async deleteMessageTranslations(scopeKey: string, messageKey: string, keys: string[]) { await this.message(scopeKey, messageKey); const cursor = await database.query('LET selected = (FOR value IN documentVersions FILTER value._key IN @keys && value.scopeKey == @scopeKey && value.documentKey == @messageKey && value.type == "translation" RETURN value) FILTER LENGTH(selected) == LENGTH(@keys) FOR value IN selected REMOVE value IN documentVersions RETURN OLD._key', { scopeKey, messageKey, keys }); const removed = await cursor.all(); if (removed.length !== keys.length) throw error('not_found', 'Every translation must belong to the selected email message'); return { messageKey, deletedKeys: keys }; },
    async createMessageSummary(input: Omit<DocumentSummary, 'version'>) { const summary = documentSummarySchema.omit({ version: true }).parse(input); const cursor = await database.query('LET message = DOCUMENT(emailMessages, @messageKey) FILTER message != null && message.scopeKey == @scopeKey LET nextVersion = FIRST(FOR value IN documentSummaries FILTER value.scopeKey == @scopeKey && value.documentKey == @messageKey COLLECT AGGREGATE maximum = MAX(value.version) RETURN (maximum || 0) + 1) INSERT MERGE(@summary, { version: nextVersion }) IN documentSummaries RETURN NEW', { messageKey: input.documentKey, scopeKey: input.scopeKey, summary: toArangoDoc(summary as DocumentSummary) }); const value = await cursor.next(); if (!value) throw error('not_found'); return documentSummarySchema.parse(raw(value)); },
    async listMessageSummaries(scopeKey: string, messageKey: string) { await this.message(scopeKey, messageKey); const cursor = await database.query('FOR value IN documentSummaries FILTER value.scopeKey == @scopeKey && value.documentKey == @messageKey SORT value.version DESC RETURN value', { scopeKey, messageKey }); return (await cursor.all()).map((value) => documentSummarySchema.parse(raw(value))); },
    async deleteMessageSummaries(scopeKey: string, messageKey: string, keys: string[]) {
      await this.message(scopeKey, messageKey);
      const now = new Date().toISOString();
      const cursor = await transaction(['documentSummaries', 'documentSummaryAudio', 'storageDeletionJobs'], async (trx) => trx.query('LET selected = (FOR value IN documentSummaries FILTER value._key IN @keys && value.scopeKey == @scopeKey && value.documentKey == @messageKey RETURN value) FILTER LENGTH(selected) == LENGTH(@keys) LET audioRows = (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && audio.summaryKey IN @keys RETURN audio) LET storageKeys = UNIQUE(audioRows[*].storageKey) LET jobs = (FOR storageKey IN storageKeys FILTER IS_STRING(storageKey) UPSERT { storageKey } INSERT { storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs RETURN 1) LET removedAudio = (FOR audio IN audioRows REMOVE audio IN documentSummaryAudio RETURN 1) LET removed = (FOR value IN selected REMOVE value IN documentSummaries RETURN OLD._key) RETURN { deletedKeys: removed, storageKeys }', { scopeKey, messageKey, keys, now }));
      const removed = await cursor.next() as { deletedKeys: string[]; storageKeys: string[] } | undefined;
      if (!removed || removed.deletedKeys.length !== keys.length) throw error('not_found', 'Every summary must belong to the selected email message');
      return { messageKey, deletedKeys: removed.deletedKeys, storageKeys: removed.storageKeys };
    },
    async readThreadPage(scopeKey: string, threadKey: string, limit: number, cursorValue?: string) {
      const detail = await this.thread(scopeKey, threadKey);
      const after = cursorValue ? JSON.parse(Buffer.from(cursorValue, 'base64url').toString('utf8')) : null;
      const eligible = detail.messages.filter((message) => !after || compareEmailMessages(message, after) > 0);
      const messages = eligible.slice(0, limit), last = messages.at(-1);
      return { thread: detail.thread, messages, nextCursor: eligible.length > limit && last ? Buffer.from(JSON.stringify({ v: 2, threadKey, sentAt: last.sentAt, providerMessageId: last.providerMessageId, key: last.key })).toString('base64url') : null };
    },
    async createDraft(input: EmailDraftCreate) {
      const timestamp = new Date().toISOString(), value = draftRecord(input, newId(), timestamp);
      const cursor = await database.query('INSERT @value IN emailDrafts RETURN NEW', { value: toArangoDoc(value) });
      return parseDraft(await cursor.next());
    },
    async createSubscriptionDraft(input: EmailDraftCreate & { variant: 'reply'; creationSource: 'subscription' }) {
      const timestamp = new Date().toISOString(), key = stableKey('mail-subscription-draft', input.scopeKey, input.messageKey), value = draftRecord(input, key, timestamp);
      const cursor = await database.query('UPSERT { _key: @key } INSERT @value UPDATE {} IN emailDrafts RETURN NEW', { key, value: toArangoDoc(value) });
      const draft = parseDraft(await cursor.next());
      if (draft.variant !== 'reply' || draft.creationSource !== 'subscription' || draft.messageKey !== input.messageKey) throw error('conflict', 'Automatic email draft identity is invalid');
      return draft;
    },
    async getDraft(scopeKey: string, draftKey: string) { const value = await get(EMAIL_DRAFTS_COLLECTION, parseDraft, scopeKey, draftKey); if (!value) throw error('not_found'); return value; },
    async subscriptionDraftForMessage(scopeKey: string, messageKey: string) { const value = await get(EMAIL_DRAFTS_COLLECTION, parseDraft, scopeKey, stableKey('mail-subscription-draft', scopeKey, messageKey)); return value?.variant === 'reply' && value.creationSource === 'subscription' && value.messageKey === messageKey ? value : null; },
    async listUnassignedDrafts(scopeKey: string) { return (await list(EMAIL_DRAFTS_COLLECTION, parseDraft, scopeKey)).filter((draft) => draft.variant === 'new' && draft.accountKey === scopeKey && ['generated', 'edited'].includes(draft.status)).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)); },
    async listDrafts(scopeKey: string, connectorKey?: string) {
      const drafts = (await list(EMAIL_DRAFTS_COLLECTION, parseDraft, scopeKey)).filter((draft) => draft.variant === 'reply' && draft.creationSource === 'subscription' && ['generated', 'edited'].includes(draft.status));
      if (!connectorKey) return drafts.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50);
      const threads = new Map((await list(EMAIL_THREADS_COLLECTION, parseThread, scopeKey)).map((thread) => [thread.key, thread]));
      return drafts.filter((draft) => draft.variant === 'reply' && threads.get(draft.threadKey)?.accountKey === connectorKey).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50);
    },
    async assignDraftConnector(scopeKey: string, draftKey: string, connectorKey: string) { const cursor = await database.query('FOR draft IN emailDrafts FILTER draft._key == @key && draft.scopeKey == @scopeKey && draft.variant == "new" && draft.accountKey IN [@scopeKey, @connectorKey] && draft.status IN ["generated", "edited"] UPDATE draft WITH { accountKey: @connectorKey, updatedAt: @now } IN emailDrafts RETURN NEW', { key: draftKey, scopeKey, connectorKey, now: new Date().toISOString() }); const value = await cursor.next(); if (!value) throw error('conflict', 'Legacy email draft could not be assigned to an inbox'); return parseDraft(value); },
    async outboundDraftAttachments(scopeKey: string, connectorKey: string, draftKey: string) { const draft = await get(EMAIL_DRAFTS_COLLECTION, parseDraft, scopeKey, draftKey); if (!draft || !['sending', 'sent'].includes(draft.status)) return null; const accountKey = draft.variant === 'new' ? draft.accountKey : (await get(EMAIL_THREADS_COLLECTION, parseThread, scopeKey, draft.threadKey))?.accountKey; return accountKey === connectorKey ? emailAttachmentRefsSchema.parse(draft.attachments ?? []) : null; },
    async searchDrafts(scopeKey: string, connectorKey: string, embedding: number[], query: string, minimumScore: number, limit: number) { const threads = new Map((await list(EMAIL_THREADS_COLLECTION, parseThread, scopeKey)).map((thread) => [thread.key, thread])); return (await list(EMAIL_DRAFTS_COLLECTION, parseDraft, scopeKey)).filter((draft) => draft.variant === 'reply' && draft.creationSource === 'subscription' && threads.get(draft.threadKey)?.accountKey === connectorKey && ['generated', 'edited'].includes(draft.status)).map((draft) => ({ draft, score: `${draft.generatedContent} ${draft.finalContent ?? ''}`.toLowerCase().includes(query.trim().toLowerCase()) ? 1 : 0 })).filter(({ score }) => score >= minimumScore).slice(0, limit); },
    async updateDraft(scopeKey: string, input: { draftKey: string; finalContent?: string; attachments?: EmailAttachmentRef[]; embedding?: number[] }) {
      const cursor = await database.query('FOR draft IN emailDrafts FILTER draft._key == @key && draft.scopeKey == @scopeKey && draft.status IN ["generated", "edited"] UPDATE draft WITH MERGE({ status: "edited", updatedAt: @now }, @content, @attachments, @embedding) IN emailDrafts RETURN NEW', { key: input.draftKey, scopeKey, now: new Date().toISOString(), content: input.finalContent === undefined ? {} : { finalContent: input.finalContent }, attachments: input.attachments === undefined ? {} : { attachments: emailAttachmentRefsSchema.parse(input.attachments) }, embedding: input.embedding === undefined ? {} : { embedding: input.embedding } });
      const value = await cursor.next(); if (!value) throw error('conflict', 'Draft is already sending or finalized'); return parseDraft(value);
    },
    async deleteDraft(scopeKey: string, draftKey: string) { const cursor = await database.query('FOR draft IN emailDrafts FILTER draft._key == @key && draft.scopeKey == @scopeKey && draft.status IN ["generated", "edited", "discarded"] REMOVE draft IN emailDrafts RETURN OLD._key', { key: draftKey, scopeKey }); const key = await cursor.next(); if (!key) throw error('conflict', 'Only generated, edited, or discarded drafts can be deleted'); return { deletedKey: key as string, storageKeys: [] as string[] }; },
    async claimDraft(scopeKey: string, draftKey: string) { const now = new Date().toISOString(), token = randomUUID(), stale = new Date(Date.now() - 1_800_000).toISOString(); const cursor = await database.query('FOR draft IN emailDrafts FILTER draft._key == @key && draft.scopeKey == @scopeKey && (draft.status IN ["generated", "edited"] || (draft.status == "sending" && draft.sendStartedAt < @stale)) UPDATE draft WITH { status: "sending", sendStartedAt: @now, sendLeaseToken: @token, updatedAt: @now } IN emailDrafts RETURN NEW', { key: draftKey, scopeKey, stale, now, token }); const value = await cursor.next(); if (!value) throw error('conflict', 'Draft was already sent or is being sent'); return parseDraft(value); },
    async renewDraftLease(draftKey: string, token: string) { const cursor = await database.query('FOR draft IN emailDrafts FILTER draft._key == @key && draft.status == "sending" && draft.sendLeaseToken == @token UPDATE draft WITH { sendStartedAt: @now, updatedAt: @now } IN emailDrafts RETURN true', { key: draftKey, token, now: new Date().toISOString() }); return await cursor.next() === true; },
    async finishDraft(draftKey: string, token: string, sent: boolean, providerMessageId?: string) { const cursor = await database.query('FOR draft IN emailDrafts FILTER draft._key == @key && draft.status == "sending" && draft.sendLeaseToken == @token UPDATE draft WITH UNSET(MERGE(draft, { status: @status, providerMessageId: @providerMessageId, updatedAt: @now }), ["sendStartedAt", "sendLeaseToken"]) IN emailDrafts OPTIONS { keepNull: false } RETURN NEW', { key: draftKey, token, status: sent ? 'sent' : 'edited', providerMessageId: providerMessageId ?? null, now: new Date().toISOString() }); const value = await cursor.next(); if (!value) throw error('conflict', 'Draft send lease was lost'); return parseDraft(value); },
    async attachmentResources(scopeKey: string, refs: EmailAttachmentRef[]) { const parsed = emailAttachmentRefsSchema.parse(refs); const cursor = await database.query('FOR ref IN @refs LET item = DOCUMENT(emailAttachments, ref.key) FILTER item != null && item.scopeKey == @scopeKey && item.status == "completed" && item.kind == ref.type RETURN { type: item.kind, key: item._key, name: item.filename, mimeType: item.mimeType, sizeBytes: item.sizeBytes, storageKey: item.storageKey }', { scopeKey, refs: parsed }); const values = await cursor.all() as any[]; if (values.length !== parsed.length) throw error('forbidden', 'Every attachment must belong to the authorized scope'); return values; },
    async resolveAttachments(scopeKey: string, refs: EmailAttachmentRef[]) { await this.attachmentResources(scopeKey, refs); return emailAttachmentRefsSchema.parse(refs); },
    async listReplyContext(scopeKey: string) { const values = (await list(EMAIL_REPLY_CONTEXT_COLLECTION, parseNote, scopeKey)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key)); if (values.length > 20 || values.reduce((sum, value) => sum + value.text.length, 0) > 24_000) throw error('conflict', 'Stored reply context exceeds its defensive limits'); return values; },
    async getReplyContext(scopeKey: string, noteKey: string) { const cursor = await database.query('LET value = DOCUMENT(emailReplyContext, @key) FILTER value != null && value.scopeKey == @scopeKey RETURN { value, revision: value._rev }', { key: noteKey, scopeKey }); const row = await cursor.next() as any; return row ? { note: parseNote(row.value), revision: z.string().min(1).parse(row.revision) } : null; },
    async createReplyContext(scopeKey: string, input: { name: string; text: string; embedding: number[] }) { const data = emailReplyContextDataSchema.parse(input), now = new Date().toISOString(), value = emailReplyContextRecordSchema.parse({ ...data, key: newId(), scopeKey, embedding: input.embedding, createdAt: now, updatedAt: now }); const cursor = await database.query('LET notes = (FOR note IN emailReplyContext FILTER note.scopeKey == @scopeKey RETURN note) FILTER LENGTH(notes) < 20 && SUM(notes[* RETURN LENGTH(CURRENT.text)]) + LENGTH(@text) <= 24000 INSERT @value IN emailReplyContext RETURN NEW', { scopeKey, text: value.text, value: toArangoDoc(value) }); const stored = await cursor.next(); if (!stored) throw error('conflict', 'Reply context is limited to 20 notes and 24,000 text characters'); return parseNote(stored); },
    async updateReplyContext(scopeKey: string, noteKey: string, expectedUpdatedAt: string, expectedRevision: string, input: { name: string; text: string; embedding: number[] }) { const data = emailReplyContextDataSchema.parse(input), now = new Date().toISOString(); const cursor = await database.query('LET current = DOCUMENT(emailReplyContext, @key) FILTER current != null && current.scopeKey == @scopeKey && current.updatedAt == @expectedUpdatedAt && current._rev == @expectedRevision LET otherLength = SUM(FOR note IN emailReplyContext FILTER note.scopeKey == @scopeKey && note._key != @key RETURN LENGTH(note.text)) FILTER otherLength + LENGTH(@text) <= 24000 UPDATE current WITH { name: @name, text: @text, embedding: @embedding, updatedAt: @now } IN emailReplyContext RETURN NEW', { key: noteKey, scopeKey, expectedUpdatedAt, expectedRevision, name: data.name, text: data.text, embedding: input.embedding, now }); const value = await cursor.next(); return value ? parseNote(value) : null; },
    async semanticReplyContext(scopeKey: string, embedding: number[], currentThreadKey: string, currentMessageKeys: string[]) { const cursor = await database.query(`FOR message IN emailMessages FILTER message.scopeKey == @scopeKey && message.threadKey != @currentThreadKey && message._key NOT IN @currentMessageKeys && message.embeddingContentVersion == 4 LET similarity = COSINE_SIMILARITY(message.embedding, @embedding) FILTER IS_NUMBER(similarity) && similarity >= 0.70 SORT similarity DESC, message._key ASC LIMIT 60 RETURN { message, similarity }`, { scopeKey, embedding, currentThreadKey, currentMessageKeys }); const rows = await cursor.all() as Array<{ message: unknown; similarity: number }>; const owners = new Set<string>(); const items: any[] = []; for (const row of rows) { const message = parseMessage(row.message); if (owners.has(message.threadKey)) continue; owners.add(message.threadKey); items.push({ kind: 'message', key: message.key, similarity: row.similarity, providerMessageId: message.providerMessageId, threadKey: message.threadKey, subject: message.subject, body: message.body, from: message.from, to: message.to, direction: message.direction, sentAt: message.sentAt, trueOutboundReply: message.direction === 'outbound' && (message.replyDepth > 0 || message.inReplyTo != null || message.parentMessageId != null) }); if (items.length >= 20 || JSON.stringify(items).length >= 24_000) break; } return items; },
    async deleteReplyContext(scopeKey: string, noteKeys: string[]) { const cursor = await database.query('LET matches = (FOR note IN emailReplyContext FILTER note.scopeKey == @scopeKey && note._key IN @keys RETURN note) FILTER LENGTH(matches) == LENGTH(@keys) FOR note IN matches REMOVE note IN emailReplyContext RETURN OLD._key', { scopeKey, keys: noteKeys }); const removed = await cursor.all(); if (removed.length !== noteKeys.length) throw error('not_found', 'Every reply-context note must belong to the authorized workspace'); return { deletedKeys: noteKeys }; },
    async listTones(scopeKey: string) { return (await list(EMAIL_TONES_COLLECTION, parseTone, scopeKey)).sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key)); },
    async searchTones(scopeKey: string, embedding: number[], query: string, minimumScore: number, limit: number) { const cursor = await database.query('FOR tone IN emailTones FILTER tone.scopeKey == @scopeKey LET direct = CONTAINS(LOWER(CONCAT_SEPARATOR(" ", tone.name, tone.instruction)), @query) LET score = COSINE_SIMILARITY(tone.embedding, @embedding) FILTER direct || IS_NUMBER(score) && score >= @minimumScore SORT direct DESC, score DESC LIMIT @limit RETURN { tone, score: direct ? 1 : score }', { scopeKey, embedding, query: query.trim().toLowerCase(), minimumScore, limit }); return (await cursor.all() as any[]).map((row) => ({ tone: parseTone(row.tone), score: row.score })); },
    async writingProfile(scopeKey: string, profileKey?: string, toneSlug?: string) { const tones = await this.listTones(scopeKey); const tone = profileKey ? tones.find((value) => value.key === profileKey) : toneSlug ? tones.find((value) => value.key === toneSlug || value.identifier === toneSlug || value.slug === toneSlug) : tones[0]; return tone ? { ...tone, tone: tone.instruction, style: '', structure: '', vocabulary: tone.instruction, conventions: tone.instruction } : null; },
    async getTone(scopeKey: string, toneKey: string) { return get(EMAIL_TONES_COLLECTION, parseTone, scopeKey, toneKey); },
    async createTone(scopeKey: string, input: { name: string; instruction: string; isFavorite: boolean; embedding: number[] }) { const now = new Date().toISOString(), key = newId(), data = emailToneDataSchema.parse({ identifier: key, name: input.name, instruction: input.instruction }), value = emailToneRecordSchema.parse({ ...data, key, scopeKey, embedding: input.embedding, isFavorite: input.isFavorite, createdAt: now, updatedAt: now }); const cursor = await database.query('INSERT @value IN emailTones RETURN NEW', { value: toArangoDoc(value) }); return parseTone(await cursor.next()); },
    async updateTone(scopeKey: string, toneKey: string, expectedUpdatedAt: string, patch: { name?: string; instruction?: string; isFavorite?: boolean; embedding?: number[] }) { const cursor = await database.query('FOR tone IN emailTones FILTER tone._key == @key && tone.scopeKey == @scopeKey && tone.updatedAt == @expected UPDATE tone WITH MERGE(@patch, { updatedAt: @now }) IN emailTones RETURN NEW', { key: toneKey, scopeKey, expected: expectedUpdatedAt, patch, now: new Date().toISOString() }); const value = await cursor.next(); return value ? parseTone(value) : null; },
    async deleteTone(scopeKey: string, toneKey: string) { const cursor = await database.query('FOR tone IN emailTones FILTER tone._key == @key && tone.scopeKey == @scopeKey && tone.slug == null REMOVE tone IN emailTones RETURN OLD._key', { key: toneKey, scopeKey }); const key = await cursor.next(); if (!key) throw error('forbidden', 'Built-in email tones cannot be deleted'); return { deletedKey: key as string, storageKeys: [] as string[] }; },
    async initializeTones(scopeKey: string, embed?: (text: string) => Promise<number[]>) { for (const tone of [{ slug: 'casual', name: 'Casual', instruction: 'Use conversational language, natural contractions, and an approachable tone.' }, { slug: 'formal', name: 'Formal', instruction: 'Use professional language, complete sentences, and a clear conventional structure.' }, { slug: 'direct', name: 'Direct', instruction: 'Lead with the answer or action and avoid hedging.' }] as const) { const key = stableKey('mail-tone', scopeKey, tone.slug), now = new Date().toISOString(), embedding = embed ? await embed(tone.name) : Array(EMBEDDING_DIMENSIONS).fill(0), value = emailToneRecordSchema.parse({ ...tone, key, scopeKey, embedding, isFavorite: false, createdAt: now, updatedAt: now }); await database.query('UPSERT { _key: @key } INSERT @value UPDATE {} IN emailTones', { key, value: toArangoDoc(value) }); } return this.listTones(scopeKey); },
  };
}
