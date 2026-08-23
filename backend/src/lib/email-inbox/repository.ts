import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db, withTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { documentSchema, type Document } from '@/lib/db/documents.node';
import { newId } from '@/lib/ids';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import {
  archiveDocument,
  decodeEmailDraft,
  decodeEmailMessage,
  decodeEmailThread,
  decodeEmailTone,
  decodeEmailWritingProfile,
  encodeEmailToneContent,
  emailAttachmentRefsSchema,
  emailDraftPayloadSchema,
  emailMessagePayloadSchema,
  emailThreadPayloadSchema,
  emailTonePayloadSchema,
  type EmailAttachmentRef,
  type EmailDraft,
  type EmailDraftCreate,
  type EmailMessage,
  type EmailThread,
} from './archive-payloads';
import { ensureMailFolders, mailFolderKeys } from './folders';

type Database = Pick<typeof db, 'query' | 'collection'>;
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

function parsedDocument(raw: unknown): Document {
  return documentSchema.parse(withArangoKey(raw as Record<string, unknown>));
}

function withoutRecordFields<T extends { key: string; scopeKey: string; embedding: number[]; createdAt: string; updatedAt: string }>(value: T) {
  const { key: _key, scopeKey: _scopeKey, embedding: _embedding, createdAt: _createdAt, updatedAt: _updatedAt, ...data } = value;
  return data;
}

const defaultTones = [
  { slug: 'concise', name: 'Concise', description: 'Brief and focused.', instruction: 'Use short sentences and include only necessary details.' },
  { slug: 'warm', name: 'Warm', description: 'Friendly and considerate.', instruction: 'Sound approachable, appreciative, and human.' },
  { slug: 'formal', name: 'Formal', description: 'Polished and professional.', instruction: 'Use professional language and a clear conventional structure.' },
  { slug: 'direct', name: 'Direct', description: 'Clear and decisive.', instruction: 'Lead with the answer or action and avoid hedging.' },
] as const;

export function createEmailRepository(database: Database = db) {
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
    return (await cursor.all()).map(parsedDocument);
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
      return withTransaction({ read: [], write: ['documents'] }, async (trx) => {
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
          await trx.query('FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey == @folderKey && document._key NOT IN @keep LET payload = JSON_PARSE(document.content) FILTER payload.kind == "mail-message" && payload.data.threadKey == @threadKey REMOVE document IN documents', { scopeKey: input.thread.scopeKey, folderKey: folders.threads, threadKey, keep });
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
          FILTER @filter == "all" || (@filter == "important" && row.data.priority IN ["high", "urgent"]) || (@filter == "urgent" && row.data.priority == "urgent") || (@filter == "needs_action" && row.data.state == "needs_action") || (@filter == "filtered" && row.data.state == "filtered") || (@filter == "unread" && row.data.unread == true) || (@filter == "favorite" && row.data.isFavorite == true)
          FILTER @search == "" || CONTAINS(LOWER(CONCAT_SEPARATOR(" ", row.data.subject, row.data.summary, row.data.snippet)), @search)
          FILTER @after == null || row.data.lastMessageAt < @after.lastMessageAt || (row.data.lastMessageAt == @after.lastMessageAt && row.document._key > @after.key)
          SORT row.data.lastMessageAt DESC, row.document._key ASC LIMIT @pageSize RETURN row.document)
        RETURN { documents: matching, counts: { all: LENGTH(inbox), important: LENGTH(FOR row IN inbox FILTER row.data.priority IN ["high", "urgent"] RETURN 1), urgent: LENGTH(FOR row IN inbox FILTER row.data.priority == "urgent" RETURN 1), needsAction: LENGTH(FOR row IN inbox FILTER row.data.state == "needs_action" RETURN 1), filtered: LENGTH(FOR row IN inbox FILTER row.data.state == "filtered" RETURN 1), unread: LENGTH(FOR row IN inbox FILTER row.data.unread == true RETURN 1), favorite: LENGTH(FOR row IN inbox FILTER row.data.isFavorite == true RETURN 1) } }`, { scopeKey, connectorKey, folderKey: mailFolderKeys(scopeKey).threads, filter, search: normalized, after, pageSize: limit + 1 });
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
      await database.query('FOR document IN documents FILTER document.scopeKey == @scopeKey LET payload = JSON_PARSE(document.content) FILTER document._key == @threadKey || (payload.kind == "mail-message" && payload.data.threadKey == @threadKey) REMOVE document IN documents', { scopeKey, threadKey });
    },
    async reconcileInbox(scopeKey: string, accountKey: string, providerThreadIds: string[]) {
      const keep = providerThreadIds.map((providerThreadId) => stableKey('mail-thread', scopeKey, accountKey, providerThreadId));
      const documents = await listFolderDocuments(scopeKey, mailFolderKeys(scopeKey).threads);
      for (const document of documents) {
        try { const thread = decodeEmailThread(document); if (thread.accountKey === accountKey && !keep.includes(thread.key) && thread.inInbox !== false) await updatePayload(scopeKey, thread.key, decodeEmailThread, emailThreadPayloadSchema, { inInbox: false }); } catch { /* Other document kind. */ }
      }
    },
    async reconcileThreadMessages(scopeKey: string, threadKey: string, providerMessageIds: string[]) {
      const documents = await listFolderDocuments(scopeKey, mailFolderKeys(scopeKey).threads);
      for (const document of documents) {
        try { const message = decodeEmailMessage(document); if (message.threadKey === threadKey && !providerMessageIds.includes(message.providerMessageId)) await database.collection('documents').remove(message.key); } catch { /* Other document kind. */ }
      }
    },
    async writingProfile(scopeKey: string, profileKey?: string, toneSlug?: string, embedTone?: (text: string) => Promise<number[]>) {
      const documents = await listFolderDocuments(scopeKey, mailFolderKeys(scopeKey).tones);
      const profiles = documents.flatMap((document) => {
        try { return [decodeEmailWritingProfile(document)]; } catch { return []; }
      });
      const profile = profileKey ? profiles.find(({ key }) => key === profileKey) : undefined;
      if (profile) return profile;
      const tones = await this.listTones(scopeKey, embedTone);
      const tone = profileKey ? tones.find(({ key }) => key === profileKey) : tones.find(({ slug }) => slug === toneSlug) ?? tones[0];
      return tone ? { ...tone, tone: tone.instruction, style: tone.description, structure: tone.description, vocabulary: tone.instruction, conventions: tone.instruction } : null;
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
    async listTones(scopeKey: string, embedTone?: (text: string) => Promise<number[]>) {
      const folders = await ensureMailFolders(database, scopeKey);
      const timestamp = new Date().toISOString();
      const placeholder = Array(EMBEDDING_DIMENSIONS).fill(0);
      const existing = new Map((await listFolderDocuments(scopeKey, folders.tones)).map((document) => [document.key, document]));
      for (const tone of defaultTones) {
        const key = stableKey('mail-tone', scopeKey, tone.slug);
        const stored = existing.get(key);
        if (stored) {
          if (embedTone && stored.embedding.every((value) => value === 0)) {
            await database.collection('documents').update(key, { embedding: await embedTone(stored.content) });
          }
          continue;
        }
        const content = encodeEmailToneContent(tone);
        const embedding = embedTone ? await embedTone(content) : placeholder;
        const document = archiveDocument({ key, scopeKey, folderKey: folders.tones, name: tone.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data: tone }), embedding, createdAt: timestamp, updatedAt: timestamp, mutationPolicy: 'user' });
        document.content = content;
        await database.query('UPSERT { _key: @key } INSERT @document UPDATE {} IN documents', { key, document: toArangoDoc(document) });
      }
      return (await listFolderDocuments(scopeKey, folders.tones)).flatMap((document) => {
        try { return [decodeEmailTone(document)]; } catch { return []; }
      }).sort((a, b) => defaultTones.findIndex(({ slug }) => slug === a.slug) - defaultTones.findIndex(({ slug }) => slug === b.slug));
    },
  };
}

export type EmailRepository = ReturnType<typeof createEmailRepository>;
