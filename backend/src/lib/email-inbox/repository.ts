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
import { ensureMailFolders, mailFolderKeys, mailInboxFolderKey } from './folders';
import { documentVersionSchema, type DocumentVersion } from '@/lib/db/document-versions.node';
import { documentSummarySchema, type DocumentSummary } from '@/lib/db/document-summaries.node';
import type { InboxCategory } from './classification';
import { ORGANIZATION_CONNECTORS_COLLECTION } from './connector-schema';
import { compareEmailMessages } from './message-order';
import { IMAGE_COLLECTION_HIGHLIGHTS_COLLECTION } from '@/lib/db/image-collection-highlights.node';
import { IMAGE_COLLECTION_MEMORIES_COLLECTION } from '@/lib/db/image-collection-memories.node';
import type { StagedEmailAttachment } from './attachment-ingestion';
import type { PreparedDocumentRepresentation } from '@/lib/ai/document-processing';

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
export type ProviderThreadMetadataState = {
  providerThreadId: string;
  messages: Array<{ providerMessageId: string; labels: string[]; sentAt: string }>;
};
const emailCursorSchema = z.object({ v: z.literal(2), threadKey: z.string().cuid(), sentAt: z.string().datetime(), providerMessageId: z.string().min(1), key: z.string().cuid() }).strict();
export function encodeEmailCursor(value: z.infer<typeof emailCursorSchema>) { return Buffer.from(JSON.stringify(emailCursorSchema.parse(value))).toString('base64url'); }
export function decodeEmailCursor(value: string, threadKey: string) {
  const parsed = emailCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  if (parsed.threadKey !== threadKey) throw new EmailRepositoryError('conflict', 'Email cursor belongs to another thread');
  return parsed;
}
export const EMAIL_OVERVIEW_FACETS = ['urgent', 'important', 'filtered', 'favorite'] as const;
export type EmailOverviewFacet = typeof EMAIL_OVERVIEW_FACETS[number];
export type EmailOverviewReadState = 'read' | 'unread';
export type EmailOverviewLegacyFilter = 'all' | 'important' | 'urgent' | 'needs_action' | 'filtered' | 'unread' | 'favorite' | 'trash';
export type EmailOverviewRepositoryQuery = {
  filter: EmailOverviewLegacyFilter;
  readState?: never;
  facets?: never;
  search?: string;
  cursor?: string;
  limit?: number;
} | {
  filter?: never;
  readState: EmailOverviewReadState;
  facets: EmailOverviewFacet[];
  search?: string;
  cursor?: string;
  limit?: number;
};
export function normalizeEmailOverviewFacets(facets: readonly EmailOverviewFacet[]) {
  const enabled = new Set(facets);
  return EMAIL_OVERVIEW_FACETS.filter((facet) => enabled.has(facet));
}
const overviewCursorSchema = z.object({ v: z.literal(2), fingerprint: z.string().length(64), lastMessageAt: z.string().datetime(), key: z.string().cuid() }).strict();
function encodeOverviewCursor(value: z.infer<typeof overviewCursorSchema>) { return Buffer.from(JSON.stringify(overviewCursorSchema.parse(value))).toString('base64url'); }
function decodeOverviewCursor(value: string, fingerprint: string) {
  const parsed = overviewCursorSchema.parse(JSON.parse(Buffer.from(value, 'base64url').toString('utf8')));
  if (parsed.fingerprint !== fingerprint) throw new EmailRepositoryError('conflict', 'Inbox cursor belongs to another connector, scope, or query');
  return parsed;
}

export class EmailRepositoryError extends Error {
  constructor(readonly reason: 'not_found' | 'forbidden' | 'conflict', message: string = reason) { super(message); }
}

function stableKey(kind: string, ...values: string[]) {
  return `c${createHash('sha256').update([kind, ...values].join('\0')).digest('hex').slice(0, 24)}`;
}

export const emailThreadKey = (scopeKey: string, accountKey: string, providerThreadId: string) => stableKey('mail-thread', scopeKey, accountKey, providerThreadId);
export const emailMessageKey = (scopeKey: string, accountKey: string, providerMessageId: string) => stableKey('mail-message', scopeKey, accountKey, providerMessageId);
export const emailSubscriptionDraftKey = (scopeKey: string, messageKey: string) => stableKey('mail-subscription-draft', scopeKey, messageKey);

function normalizedProviderThreadState(value: ProviderThreadMetadataState) {
  return JSON.stringify([...value.messages]
    .map((message) => ({ providerMessageId: message.providerMessageId, labels: [...new Set(message.labels)].sort(), sentAt: message.sentAt }))
    .sort((left, right) => left.providerMessageId.localeCompare(right.providerMessageId)));
}

export function draftKeyFromOutboundMessageId(value?: string) {
  const match = /^<vorinthex-([a-z0-9]+)@vorinthex\.com>$/.exec(value ?? '');
  return match && z.string().cuid().safeParse(match[1]).success ? match[1] : null;
}

function parsedDocument(raw: unknown): Document {
  return emailArchiveDocumentSchema.parse(withArangoKey(raw as Record<string, unknown>));
}

function withoutRecordFields<T extends { key: string; scopeKey: string; embedding: number[]; createdAt: string; updatedAt: string }>(value: T) {
  const { key: _key, scopeKey: _scopeKey, embedding: _embedding, createdAt: _createdAt, updatedAt: _updatedAt, ...data } = value;
  return data;
}

const defaultTones = [
  { slug: 'casual', name: 'Casual', instruction: 'Use conversational language, natural contractions, and an approachable tone.' },
  { slug: 'formal', name: 'Formal', instruction: 'Use professional language, complete sentences, and a clear conventional structure.' },
  { slug: 'direct', name: 'Direct', instruction: 'Lead with the answer or action and avoid hedging.' },
] as const;
const legacyDefaultTones = [
  { slug: 'warm' as const, name: 'Warm', description: 'Friendly and considerate.', instruction: 'Sound approachable, appreciative, and human.' },
  { slug: 'concise' as const, name: 'Concise', instruction: 'Lead with the point, use short sentences, and include only necessary details.' },
] as const;
const legacyToneContent = (tone: { slug: NonNullable<EmailTone['slug']>; name: string; description?: string; instruction: string }) => tone.description ? `# ${tone.name}\n\n<!-- vorinthex-mail-tone ${JSON.stringify({ version: 1, slug: tone.slug })} -->\n\n${tone.description}\n\n## Instruction\n\n${tone.instruction}` : encodeEmailToneContent(tone);

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
  const mailDeletion = async <T>(operation: (executor: Pick<typeof db, 'query'>) => Promise<T>, fenceConnector = false): Promise<T> => database.beginTransaction
    ? withDatabaseTransaction<T>(database as typeof db, { read: ['scopes', 'scopeMembers', 'userOrganizations'], write: ['folders', 'documents', 'documentVersions', 'documentSummaries', 'documentSummaryAudio', 'documentAudioVersions', 'emailAttachmentBindings', 'images', 'imageCaptions', 'collectionImages', 'imageIdentities', IMAGE_COLLECTION_MEMORIES_COLLECTION, IMAGE_COLLECTION_HIGHLIGHTS_COLLECTION, 'placeImages', 'collections', 'trips', 'tagAssignments', 'shares', 'userHiddens', 'storageDeletionJobs', ...(fenceConnector ? [ORGANIZATION_CONNECTORS_COLLECTION] : [])] }, operation)
    : operation(database);
  const contentDeletion = async <T>(operation: (executor: Pick<typeof db, 'query'>) => Promise<T>): Promise<T> => database.beginTransaction
    ? withDatabaseTransaction<T>(database as typeof db, { read: [], write: ['documents', 'documentVersions', 'documentSummaries', 'documentSummaryAudio', 'documentAudioVersions', 'storageDeletionJobs'] }, operation)
    : operation(database);
  const cleanAttachmentDocumentReferences = async (executor: Pick<typeof db, 'query'>, scopeKey: string, targetKeys: string[], updatedAt: string) => {
    if (!targetKeys.length) return;
    await executor.query(`FOR document IN documents FILTER document.scopeKey == @scopeKey LET payload = document.mutationPolicy == "system-only" ? JSON_PARSE(document.content) : null LET hasRefs = payload != null && payload.kind IN ["mail-reply-draft", "mail-new-draft"] && IS_ARRAY(payload.data.attachments) && LENGTH(FOR ref IN payload.data.attachments FILTER ref.key IN @targetKeys RETURN 1) > 0 LET hasCover = document.coverImageKey IN @targetKeys FILTER hasRefs || hasCover LET data = hasRefs ? MERGE(payload.data, { attachments: (FOR ref IN payload.data.attachments FILTER ref.key NOT IN @targetKeys RETURN ref) }) : null LET patch = MERGE(hasRefs ? { content: JSON_STRINGIFY(MERGE(payload, { data })) } : {}, hasCover ? { coverImageKey: null } : {}, { updatedAt: @updatedAt }) UPDATE document WITH patch IN documents OPTIONS { keepNull: false }`, { scopeKey, targetKeys, updatedAt });
  };
  const cleanOrphanAttachmentCaptions = async (executor: Pick<typeof db, 'query'>, captionKeys: string[]) => {
    if (!captionKeys.length) return;
    await executor.query('FOR caption IN imageCaptions FILTER caption._key IN @captionKeys FILTER LENGTH(FOR retained IN images FILTER retained.imageCaptionKey == caption._key LIMIT 1 RETURN 1) == 0 REMOVE caption IN imageCaptions', { captionKeys });
  };
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
  const listFolderDocuments = async (scopeKey: string, folderKey: string, mutationPolicy: 'user' | 'system-only') => {
    const cursor = await database.query('FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == @mutationPolicy && (!HAS(document, "_internalDeletion") || document._internalDeletion == null) RETURN document', { scopeKey, folderKey, mutationPolicy });
    return (await cursor.all()).flatMap((raw) => {
      try { return [parsedDocument(raw)]; } catch { return []; }
    });
  };
  const getDocument = async (scopeKey: string, key: string, folderKey: string, mutationPolicy: 'user' | 'system-only') => {
    const cursor = await database.query('FOR document IN documents FILTER document._key == @key && document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == @mutationPolicy && (!HAS(document, "_internalDeletion") || document._internalDeletion == null) LIMIT 1 RETURN document', { scopeKey, key, folderKey, mutationPolicy });
    const raw = await cursor.next();
    return raw ? parsedDocument(raw) : null;
  };
  const insertDocument = async (document: Document) => {
    const cursor = await database.query('INSERT @document IN documents RETURN NEW', { document: toArangoDoc(document) });
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
    async unchangedProviderThreadIds(scopeKey: string, accountKey: string, threads: ProviderThreadMetadataState[]) {
      if (!threads.length) return new Set<string>();
      const requestedIds = [...new Set(threads.map(({ providerThreadId }) => providerThreadId))];
      const cursor = await database.query(`LET threadRows = (FOR document IN documents
          FILTER document.scopeKey == @scopeKey && document.mutationPolicy == "system-only"
          LET payload = JSON_PARSE(document.content)
          FILTER payload.version == 1 && payload.kind == "mail-thread" && payload.data.accountKey == @accountKey && payload.data.providerThreadId IN @providerThreadIds
           FILTER document.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, "communication-mail-threads")), 24))
          RETURN { key: document._key, providerThreadId: payload.data.providerThreadId })
        LET threadKeys = threadRows[*].key
        LET providerThreadIdsByKey = ZIP(threadKeys, threadRows[*].providerThreadId)
        LET messageRows = (FOR document IN documents
          FILTER document.scopeKey == @scopeKey && document.mutationPolicy == "system-only"
          LET payload = JSON_PARSE(document.content)
          FILTER payload.version == 1 && payload.kind == "mail-message" && payload.data.accountKey == @accountKey && payload.data.threadKey IN threadKeys
           FILTER document.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, CONCAT("mail-inbox\\u0000", @accountKey))), 24))
          RETURN { providerThreadId: providerThreadIdsByKey[payload.data.threadKey], providerMessageId: payload.data.providerMessageId, labels: payload.data.labels || [], sentAt: payload.data.sentAt })
        RETURN { providerThreadIds: threadRows[*].providerThreadId, messages: messageRows }`, {
        scopeKey, accountKey, providerThreadIds: requestedIds,
      });
      const rows = await cursor.next() as { providerThreadIds: string[]; messages: Array<ProviderThreadMetadataState['messages'][number] & { providerThreadId: string }> } | undefined;
      const storedStates = new Map((rows?.providerThreadIds ?? []).map((providerThreadId) => [providerThreadId, { providerThreadId, messages: [] as ProviderThreadMetadataState['messages'] }]));
      for (const { providerThreadId, ...message } of rows?.messages ?? []) storedStates.get(providerThreadId)?.messages.push(message);
      const stored = new Map([...storedStates].map(([providerThreadId, state]) => [providerThreadId, normalizedProviderThreadState(state)]));
      return new Set(threads.flatMap((thread) => stored.get(thread.providerThreadId) === normalizedProviderThreadState(thread) ? [thread.providerThreadId] : []));
    },
    async providerThreadIdForMessage(scopeKey: string, accountKey: string, providerMessageId: string) {
      const cursor = await database.query(`FOR message IN documents
        FILTER message.scopeKey == @scopeKey && message.mutationPolicy == "system-only"
        LET messagePayload = JSON_PARSE(message.content)
        FILTER messagePayload.version == 1 && messagePayload.kind == "mail-message" && messagePayload.data.accountKey == @accountKey && messagePayload.data.providerMessageId == @providerMessageId
         FILTER message.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, CONCAT("mail-inbox\\u0000", @accountKey))), 24))
        LET thread = DOCUMENT(documents, messagePayload.data.threadKey)
        LET threadPayload = thread == null ? null : JSON_PARSE(thread.content)
        FILTER threadPayload != null && threadPayload.version == 1 && threadPayload.kind == "mail-thread" && threadPayload.data.accountKey == @accountKey
         FILTER thread.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, "communication-mail-threads")), 24))
        LIMIT 1 RETURN threadPayload.data.providerThreadId`, { scopeKey, accountKey, providerMessageId });
      return await cursor.next() as string | null;
    },
    async syncThread(input: {
      thread: Omit<EmailThread, 'key' | 'createdAt' | 'updatedAt'> & { archiveRepresentation?: PreparedDocumentRepresentation };
      messages: Array<Omit<EmailMessage, 'key' | 'threadKey' | 'createdAt' | 'updatedAt' | 'attachmentAvailability'> & Partial<Pick<EmailMessage, 'attachmentAvailability'>> & { archiveRepresentation?: PreparedDocumentRepresentation }>;
      reconcileMessages?: boolean;
      lease?: { kind: 'sync' | 'send'; connectorKey: string; token: string };
      attachmentCommits?: StagedEmailAttachment[];
    }) {
      if (input.messages.some((message) => message.scopeKey !== input.thread.scopeKey || message.accountKey !== input.thread.accountKey)) {
        throw new EmailRepositoryError('conflict', 'Email thread and messages must belong to the same account and scope');
      }
      if (new Set(input.messages.map(({ providerMessageId }) => providerMessageId)).size !== input.messages.length) throw new EmailRepositoryError('conflict', 'Email provider message IDs must be unique within a thread');
      const timestamp = new Date().toISOString();
      const threadKey = emailThreadKey(input.thread.scopeKey, input.thread.accountKey, input.thread.providerThreadId);
      const inboxCursor = await database.query('LET connector = DOCUMENT(organizationConnectors, @connectorKey) LET inbox = DOCUMENT(folders, @inboxFolderKey) FILTER connector != null && connector.scopeKey == @scopeKey && connector.provider == "gmail" && connector.status != "revoked" && connector.syncEnabled != false && inbox != null && inbox.scopeKey == @scopeKey && inbox.managedPurpose == "mail-inbox" && inbox.managedOwnerKey == connector._key && inbox.mutationPolicy == "system-container" RETURN inbox.name', { scopeKey: input.thread.scopeKey, connectorKey: input.thread.accountKey, inboxFolderKey: mailInboxFolderKey(input.thread.scopeKey, input.thread.accountKey) });
      const inboxName = await inboxCursor.next() as string | undefined;
      if (!inboxName) throw new EmailRepositoryError('conflict', 'Email inbox metadata is missing');
       const folders = mailFolderKeys(input.thread.scopeKey);
       const inboxFolderKey = mailInboxFolderKey(input.thread.scopeKey, input.thread.accountKey);
      const { archiveRepresentation: threadRepresentation, ...threadInput } = input.thread;
      const threadPayload = emailThreadPayloadSchema.parse({ version: 1, kind: 'mail-thread', data: withoutRecordFields({ ...threadInput, key: threadKey, createdAt: timestamp, updatedAt: timestamp }) });
       const threadDocument = archiveDocument({ key: threadKey, scopeKey: input.thread.scopeKey, folderKey: folders.threads, name: input.thread.subject, payload: threadPayload, embedding: input.thread.embedding, representation: threadRepresentation, createdAt: timestamp, updatedAt: timestamp, archiveVisibility: 'domain-only' });
      return mailDeletion(async (trx) => {
        let attachmentMutation = { documentKeys: [] as string[], imageKeys: [] as string[], collectionKeys: [] as string[] };
        if (input.lease) {
          const tokenField = input.lease.kind === 'sync' ? 'syncLeaseToken' : 'sendLeaseToken';
          const expiryField = input.lease.kind === 'sync' ? 'syncLeaseExpiresAt' : 'sendLeaseExpiresAt';
          const leaseCursor = await trx.query(`FOR connector IN @@connectors
            FILTER connector._key == @connectorKey && connector.status != "revoked" && connector.syncEnabled != false
            FILTER connector[@tokenField] == @leaseToken && connector[@expiryField] > @checkedAt
            UPDATE connector WITH {} IN @@connectors RETURN true`, { '@connectors': ORGANIZATION_CONNECTORS_COLLECTION, connectorKey: input.lease.connectorKey, leaseToken: input.lease.token, tokenField, expiryField, checkedAt: timestamp });
          if (await leaseCursor.next() !== true) throw new EmailRepositoryError('conflict', `Email ${input.lease.kind} lease was lost before persistence`);
        }
        const threadIdentity = await trx.query(`LET existing = DOCUMENT(documents, @key)
          FILTER existing == null || (existing.scopeKey == @scopeKey && existing.folderKey == @folderKey && existing.mutationPolicy == "system-only" && JSON_PARSE(existing.content).version == 1 && JSON_PARSE(existing.content).kind == "mail-thread" && JSON_PARSE(existing.content).data.accountKey == @accountKey && JSON_PARSE(existing.content).data.providerThreadId == @providerThreadId)
          RETURN true`, { key: threadKey, scopeKey: input.thread.scopeKey, folderKey: folders.threads, accountKey: input.thread.accountKey, providerThreadId: input.thread.providerThreadId });
        if (await threadIdentity.next() !== true) throw new EmailRepositoryError('conflict', 'Deterministic email thread key belongs to another provider identity');
        const threadCursor = await trx.query('UPSERT { _key: @key } INSERT @document UPDATE MERGE(@document, { _key: OLD._key, createdAt: OLD.createdAt }) IN documents RETURN NEW', { key: threadKey, document: toArangoDoc(threadDocument) });
        const thread = decodeEmailThread(parsedDocument(await threadCursor.next()));
        for (const inputMessage of input.messages) {
          const messageKey = emailMessageKey(inputMessage.scopeKey, inputMessage.accountKey, inputMessage.providerMessageId);
          const { archiveRepresentation, ...messageInput } = inputMessage;
          const data = withoutRecordFields({ ...messageInput, threadKey, key: messageKey, createdAt: timestamp, updatedAt: timestamp });
          const payload = emailMessagePayloadSchema.parse({ version: 1, kind: 'mail-message', data });
           const document = archiveDocument({ key: messageKey, scopeKey: inputMessage.scopeKey, folderKey: inboxFolderKey, name: inputMessage.subject, payload, embedding: inputMessage.embedding, representation: archiveRepresentation, createdAt: timestamp, updatedAt: timestamp, archiveVisibility: 'visible' });
          const messageIdentity = await trx.query(`LET existing = DOCUMENT(documents, @key)
            FILTER existing == null || (existing.scopeKey == @scopeKey && existing.folderKey == @folderKey && existing.mutationPolicy == "system-only" && JSON_PARSE(existing.content).version == 1 && JSON_PARSE(existing.content).kind == "mail-message" && JSON_PARSE(existing.content).data.accountKey == @accountKey && JSON_PARSE(existing.content).data.providerMessageId == @providerMessageId)
             RETURN true`, { key: messageKey, scopeKey: inputMessage.scopeKey, folderKey: inboxFolderKey, accountKey: inputMessage.accountKey, providerMessageId: inputMessage.providerMessageId });
          if (await messageIdentity.next() !== true) throw new EmailRepositoryError('conflict', 'Deterministic email message key belongs to another provider identity');
          await trx.query('UPSERT { _key: @key } INSERT @document UPDATE MERGE(@document, { _key: OLD._key, createdAt: OLD.createdAt }) IN documents', { key: messageKey, document: toArangoDoc(document) });
          const recoveredDraftKey = inputMessage.direction === 'outbound' && inputMessage.labels?.includes('SENT') ? draftKeyFromOutboundMessageId(inputMessage.messageIdHeader) : null;
          if (recoveredDraftKey) {
            await trx.query(`FOR draft IN documents FILTER draft._key == @draftKey && draft.scopeKey == @scopeKey && draft.folderKey == @draftFolderKey && draft.mutationPolicy == "system-only"
              LET payload = JSON_PARSE(draft.content)
              FILTER payload.version == 1 && payload.kind IN ["mail-reply-draft", "mail-new-draft"] && payload.data.status IN ["sending", "sent"]
              LET data = UNSET(MERGE(payload.data, { status: "sent", providerMessageId: @providerMessageId }), ["sendStartedAt", "sendLeaseToken"])
              UPDATE draft WITH { content: JSON_STRINGIFY(MERGE(payload, { data })), updatedAt: @timestamp } IN documents`, { draftKey: recoveredDraftKey, scopeKey: inputMessage.scopeKey, draftFolderKey: folders.drafts, providerMessageId: inputMessage.providerMessageId, timestamp });
          }
        }
        for (const attachment of input.attachmentCommits ?? []) {
          const relationKey = stableKey('email-attachment-collection-image', attachment.bindingKey);
          const committed = await trx.query(`LET binding = DOCUMENT(emailAttachmentBindings, @bindingKey) FILTER binding != null && binding.status == "processing" && binding.leaseToken == @attachmentLeaseToken && binding.leaseExpiresAt > @timestamp FILTER binding.scopeKey == @scopeKey && binding.connectorKey == @accountKey && binding.targetType == @targetType && binding.targetKey == @targetKey LET member = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET scopeMember = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == @scopeKey && item.userOrganizationKey == @membershipKey && item.status == "active" LIMIT 1 RETURN item) FILTER member != null && member.status == "active" && scope != null && member.organizationId == scope.organizationKey && (member.orgRole IN ["owner", "admin"] || scopeMember != null) LET target = @targetType == "document" ? DOCUMENT(documents, @targetKey) : DOCUMENT(images, @targetKey) LET collection = @targetType == "image" ? DOCUMENT(collections, @collectionKey) : null FILTER target != null && target.scopeKey == @scopeKey FILTER (@targetType == "document" && target.managedPurpose == "mail-attachment" && target.managedOwnerKey == @bindingKey) || (@targetType == "image" && @targetKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "email-attachment-target", @bindingKey)), 24)) && target.mutationPolicy == "system-only" && collection != null && collection.scopeKey == @scopeKey && collection.purpose == "email-media" && collection.mutationPolicy == "system-only") LET relation = @targetType == "image" ? FIRST(UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @targetKey } INSERT { _key: @relationKey, scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @targetKey, addedByKey: @membershipKey, createdAt: @timestamp } UPDATE {} IN collectionImages RETURN NEW) : null UPDATE binding WITH { status: "completed", leaseToken: null, leaseExpiresAt: null, updatedAt: @timestamp } IN emailAttachmentBindings OPTIONS { keepNull: false } RETURN true`, { bindingKey: attachment.bindingKey, attachmentLeaseToken: attachment.leaseToken, scopeKey: input.thread.scopeKey, accountKey: input.thread.accountKey, targetType: attachment.targetType, targetKey: attachment.targetKey, collectionKey: attachment.collectionKey ?? null, membershipKey: attachment.membershipKey, relationKey, timestamp });
          if (await committed.next() !== true) throw new EmailRepositoryError('conflict', 'Attachment staging lease or target changed before mail persistence');
        }
        if (input.reconcileMessages !== false) {
            const keep = input.messages.map(({ providerMessageId }) => emailMessageKey(input.thread.scopeKey, input.thread.accountKey, providerMessageId));
          const cleanupCursor = await trx.query(`LET stale = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "system-only" && document._key NOT IN @keep LET payload = JSON_PARSE(document.content) FILTER payload.version == 1 && payload.kind == "mail-message" && payload.data.threadKey == @threadKey RETURN document)
            LET staleKeys = stale[*]._key
            LET staleProviderMessageIds = (FOR document IN stale LET payload = JSON_PARSE(document.content) FILTER payload.kind == "mail-message" RETURN payload.data.providerMessageId)
            LET attachmentBindings = (FOR binding IN emailAttachmentBindings FILTER binding.scopeKey == @scopeKey && binding.connectorKey == @accountKey && binding.providerMessageId IN staleProviderMessageIds RETURN binding)
            LET attachmentDocuments = (FOR binding IN attachmentBindings FILTER binding.targetType == "document" LET document = DOCUMENT(documents, binding.targetKey) FILTER document != null && document.scopeKey == @scopeKey && document.managedPurpose == "mail-attachment" && document.managedOwnerKey == binding._key RETURN document)
            LET attachmentDocumentKeys = attachmentDocuments[*]._key
            LET attachmentImages = (FOR binding IN attachmentBindings FILTER binding.targetType == "image" && binding.targetKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "email-attachment-target", binding._key)), 24)) LET image = DOCUMENT(images, binding.targetKey) FILTER image != null && image.scopeKey == @scopeKey && image.mutationPolicy == "system-only" RETURN image)
            LET attachmentTargetKeys = UNION(attachmentDocumentKeys, attachmentImages[*]._key)
            LET affectedCollectionKeys = UNIQUE(UNION((FOR relation IN collectionImages FILTER relation.imageKey IN attachmentImages[*]._key RETURN relation.collectionKey), (FOR highlight IN imageCollecitionHightlights FILTER highlight.scopeKey == @scopeKey && LENGTH(INTERSECTION(highlight.imageKeys, attachmentImages[*]._key)) > 0 RETURN highlight.collectionKey), (FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.coverImageKey IN attachmentImages[*]._key RETURN collection._key)))
            LET attachmentRefDocuments = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.mutationPolicy == "system-only" LET payload = JSON_PARSE(document.content) FILTER payload.kind IN ["mail-reply-draft", "mail-new-draft"] && IS_ARRAY(payload.data.attachments) && LENGTH(FOR ref IN payload.data.attachments FILTER ref.key IN attachmentTargetKeys RETURN 1) > 0 RETURN { document, payload })
            LET attachmentCoverDocuments = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.coverImageKey IN attachmentImages[*]._key RETURN document)
            LET cleanedAttachmentRefs = []
            LET dependentDocumentKeys = UNION(staleKeys, attachmentDocumentKeys)
            LET summaryKeys = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey IN dependentDocumentKeys RETURN summary._key)
            LET candidateStorageKeys = UNIQUE(FLATTEN(UNION((FOR document IN documents FILTER document._key IN dependentDocumentKeys RETURN UNION(IS_STRING(document.storageKey) ? [document.storageKey] : [], IS_ARRAY(document.sourceStorageKeys) ? document.sourceStorageKeys : [], IS_ARRAY(document.speechStorageKeys) ? document.speechStorageKeys : [])), (FOR image IN attachmentImages FILTER IS_STRING(image.storageKey) RETURN image.storageKey), (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey IN dependentDocumentKeys && IS_STRING(version.storageKey) RETURN version.storageKey), (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey IN dependentDocumentKeys && IS_STRING(audio.storageKey) RETURN audio.storageKey), (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && (audio.documentKey IN dependentDocumentKeys || audio.summaryKey IN summaryKeys) && IS_STRING(audio.storageKey) RETURN audio.storageKey)), 2))
            LET attachmentStorageKeys = (FOR storageKey IN candidateStorageKeys FILTER LENGTH(FOR document IN documents FILTER document._key NOT IN dependentDocumentKeys && (document.storageKey == storageKey || storageKey IN (document.sourceStorageKeys || []) || storageKey IN (document.speechStorageKeys || [])) LIMIT 1 RETURN 1) == 0 FILTER LENGTH(FOR image IN images FILTER image._key NOT IN attachmentImages[*]._key && image.storageKey == storageKey LIMIT 1 RETURN 1) == 0 FILTER LENGTH(FOR version IN documentVersions FILTER version.documentKey NOT IN dependentDocumentKeys && version.storageKey == storageKey LIMIT 1 RETURN 1) == 0 FILTER LENGTH(FOR audio IN documentAudioVersions FILTER audio.documentKey NOT IN dependentDocumentKeys && audio.storageKey == storageKey LIMIT 1 RETURN 1) == 0 FILTER LENGTH(FOR audio IN documentSummaryAudio FILTER audio.documentKey NOT IN dependentDocumentKeys && audio.summaryKey NOT IN summaryKeys && audio.storageKey == storageKey LIMIT 1 RETURN 1) == 0 RETURN storageKey)
            LET attachmentJobs = []
            LET removedAttachmentRelations = (FOR relation IN collectionImages FILTER relation.imageKey IN attachmentImages[*]._key REMOVE relation IN collectionImages RETURN 1)
            LET removedAttachmentIdentities = (FOR relation IN imageIdentities FILTER relation.imageKey IN attachmentImages[*]._key REMOVE relation IN imageIdentities RETURN 1)
            LET removedAttachmentMemories = (FOR memory IN imageCollectionMemories FILTER memory.scopeKey == @scopeKey && memory.imageKey IN attachmentImages[*]._key REMOVE memory IN imageCollectionMemories RETURN 1)
            LET cleanedAttachmentHighlights = (FOR highlight IN imageCollecitionHightlights FILTER highlight.scopeKey == @scopeKey && LENGTH(INTERSECTION(highlight.imageKeys, attachmentImages[*]._key)) > 0 UPDATE highlight WITH { imageKeys: MINUS(highlight.imageKeys, attachmentImages[*]._key), updatedAt: @timestamp } IN imageCollecitionHightlights RETURN 1)
            LET removedAttachmentPlaces = (FOR relation IN placeImages FILTER relation.scopeKey == @scopeKey && relation.imageKey IN attachmentImages[*]._key REMOVE relation IN placeImages RETURN 1)
            LET cleanedAttachmentFolders = (FOR folder IN folders FILTER folder.scopeKey == @scopeKey && folder.coverImageKey IN attachmentImages[*]._key UPDATE folder WITH { coverImageKey: null, updatedAt: @timestamp } IN folders OPTIONS { keepNull: false } RETURN 1)
            LET cleanedAttachmentCollections = (FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.coverImageKey IN attachmentImages[*]._key UPDATE collection WITH { coverImageKey: null, updatedAt: @timestamp } IN collections OPTIONS { keepNull: false } RETURN 1)
            LET cleanedAttachmentTrips = (FOR trip IN trips FILTER trip.scopeKey == @scopeKey && trip.coverImageKey IN attachmentImages[*]._key UPDATE trip WITH { coverImageKey: null, updatedAt: @timestamp } IN trips OPTIONS { keepNull: false } RETURN 1)
            LET cleanedAttachmentCovers = []
            LET removedAttachmentTags = (FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && assignment.sourceType == "image" && assignment.sourceKey IN attachmentImages[*]._key REMOVE assignment IN tagAssignments RETURN 1)
            LET removedAttachmentShares = (FOR share IN shares FILTER share.scopeKey == @scopeKey && share.sourceType == "image" && share.sourceKey IN attachmentImages[*]._key REMOVE share IN shares RETURN 1)
            LET removedAttachmentHiddens = (FOR hidden IN userHiddens FILTER hidden.source == "image" && hidden.sourceKey IN attachmentImages[*]._key REMOVE hidden IN userHiddens RETURN 1)
            LET removedAttachmentImages = (FOR image IN attachmentImages REMOVE image IN images RETURN 1)
            LET removedAttachmentCaptions = []
            LET removedAttachmentDocuments = []
            LET removedAttachmentBindings = (FOR binding IN attachmentBindings REMOVE binding IN emailAttachmentBindings RETURN 1)
            LET jobs = (FOR storageKey IN attachmentStorageKeys UPSERT { storageKey } INSERT { storageKey, createdAt: @timestamp } UPDATE {} IN storageDeletionJobs RETURN 1)
            LET removedSummaryAudio = (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && (audio.documentKey IN dependentDocumentKeys || audio.summaryKey IN summaryKeys) REMOVE audio IN documentSummaryAudio RETURN 1)
            LET removedSummaries = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey IN dependentDocumentKeys REMOVE summary IN documentSummaries RETURN 1)
            LET removedVersions = (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey IN dependentDocumentKeys REMOVE version IN documentVersions RETURN 1)
            LET removedAudioVersions = (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey IN dependentDocumentKeys REMOVE audio IN documentAudioVersions RETURN 1)
            LET removedDocuments = (FOR document IN UNION_DISTINCT(attachmentDocuments, stale) REMOVE document IN documents RETURN 1)
             RETURN { attachmentTargetKeys, attachmentDocumentKeys, attachmentImageKeys: attachmentImages[*]._key, affectedCollectionKeys, attachmentCaptionKeys: attachmentImages[*].imageCaptionKey }`, { scopeKey: input.thread.scopeKey, folderKey: inboxFolderKey, threadKey, accountKey: input.thread.accountKey, keep, timestamp });
          const cleanup = await cleanupCursor.next() as { attachmentTargetKeys: string[]; attachmentDocumentKeys: string[]; attachmentImageKeys: string[]; affectedCollectionKeys: string[]; attachmentCaptionKeys: string[] } | undefined;
          await cleanAttachmentDocumentReferences(trx, input.thread.scopeKey, cleanup?.attachmentTargetKeys ?? [], timestamp);
          await cleanOrphanAttachmentCaptions(trx, cleanup?.attachmentCaptionKeys ?? []);
          attachmentMutation = { documentKeys: cleanup?.attachmentDocumentKeys ?? [], imageKeys: cleanup?.attachmentImageKeys ?? [], collectionKeys: cleanup?.affectedCollectionKeys ?? [] };
        }
        return Object.assign(thread, { attachmentMutation });
      }, Boolean(input.lease));
    },
    async overview(scopeKey: string, connectorKey: string, query: EmailOverviewRepositoryQuery) {
      const search = query.search?.trim().toLowerCase() ?? '';
      const facets = 'facets' in query ? normalizeEmailOverviewFacets(query.facets ?? []) : [];
      const readState = 'readState' in query ? query.readState : null;
      const filter = 'filter' in query ? query.filter ?? 'all' : null;
      const limit = query.limit ?? 50;
      const fingerprint = createHash('sha256').update(JSON.stringify({ scopeKey, connectorKey, filter, readState, facets, search })).digest('hex');
      const after = query.cursor ? decodeOverviewCursor(query.cursor, fingerprint) : null;
      const cursor = await database.query(`LET inbox = (FOR document IN documents
        FILTER document.scopeKey == @scopeKey && document.mutationPolicy == "system-only"
        LET payload = JSON_PARSE(document.content)
        FILTER payload.kind == "mail-thread" && payload.data.accountKey == @connectorKey && payload.data.inInbox != false
         FILTER document.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, "communication-mail-threads")), 24))
        RETURN { document, data: payload.data })
        LET matching = (FOR row IN inbox
          LET isTrash = "TRASH" IN (row.data.labels || [])
          FILTER @filter != null
            ? ((@filter == "trash" && isTrash) || (!isTrash && (@filter == "all" || (@filter == "important" && row.data.inboxCategory == "Important") || (@filter == "urgent" && row.data.inboxCategory == "Urgent") || (@filter == "needs_action" && row.data.state == "needs_action") || (@filter == "filtered" && row.data.inboxCategory == "Filtered") || (@filter == "unread" && row.data.unread == true) || (@filter == "favorite" && row.data.isFavorite == true))))
            : (!isTrash && row.data.unread == (@readState == "unread") && LENGTH(@facets) > 0 && (("urgent" IN @facets && row.data.inboxCategory == "Urgent") || ("important" IN @facets && row.data.inboxCategory == "Important") || ("filtered" IN @facets && row.data.inboxCategory == "Filtered") || ("favorite" IN @facets && row.data.isFavorite == true)))
          LET direct = @search == "" || LENGTH(FOR message IN documents
            FILTER message.scopeKey == @scopeKey && message.mutationPolicy == "system-only"
            LET messagePayload = JSON_PARSE(message.content)
            FILTER messagePayload.version == 1 && messagePayload.kind == "mail-message" && messagePayload.data.accountKey == @connectorKey && messagePayload.data.threadKey == row.document._key
            FILTER message.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, CONCAT("mail-inbox\\u0000", @connectorKey))), 24))
            FILTER CONTAINS(LOWER(CONCAT_SEPARATOR(" ", messagePayload.data.from, messagePayload.data.subject, messagePayload.data.body)), @search)
            LIMIT 1 RETURN 1) > 0
          FILTER direct
          FILTER @after == null || row.data.lastMessageAt < @after.lastMessageAt || (row.data.lastMessageAt == @after.lastMessageAt && row.document._key > @after.key)
          SORT row.data.lastMessageAt DESC, row.document._key ASC LIMIT @pageSize RETURN row.document)
        LET active = (FOR row IN inbox FILTER "TRASH" NOT IN (row.data.labels || []) RETURN row)
        RETURN { documents: matching, counts: { all: LENGTH(active), important: LENGTH(FOR row IN active FILTER row.data.inboxCategory == "Important" RETURN 1), urgent: LENGTH(FOR row IN active FILTER row.data.inboxCategory == "Urgent" RETURN 1), needsAction: LENGTH(FOR row IN active FILTER row.data.state == "needs_action" RETURN 1), filtered: LENGTH(FOR row IN active FILTER row.data.inboxCategory == "Filtered" RETURN 1), unread: LENGTH(FOR row IN active FILTER row.data.unread == true RETURN 1), favorite: LENGTH(FOR row IN active FILTER row.data.isFavorite == true RETURN 1), trash: LENGTH(inbox) - LENGTH(active) } }`, { scopeKey, connectorKey, filter, readState, facets, search, after, pageSize: limit + 1 });
      const result = await cursor.next() as { documents: unknown[]; counts: Record<string, number> } | undefined;
      const decoded = (result?.documents ?? []).map((document) => decodeEmailThread(parsedDocument(document)));
      const threads = decoded.slice(0, limit);
      const last = threads.at(-1);
      const nextCursor = decoded.length > limit && last ? encodeOverviewCursor({ v: 2, fingerprint, lastMessageAt: last.lastMessageAt, key: last.key }) : null;
      return { threads, nextCursor, counts: result?.counts ?? { all: 0, important: 0, urgent: 0, needsAction: 0, filtered: 0, unread: 0, favorite: 0, trash: 0 } };
    },
    async searchThreads(scopeKey: string, connectorKey: string, embedding: number[], query: string, minimumScore: number, limit: number, filters: { readState?: EmailOverviewReadState; facets?: EmailOverviewFacet[] } = {}) {
      const normalizedQuery = query.trim().toLowerCase();
      const facets = filters.facets === undefined ? null : normalizeEmailOverviewFacets(filters.facets);
      const cursor = await database.query(`FOR document IN documents
        FILTER document.scopeKey == @scopeKey && document.mutationPolicy == "system-only"
        FILTER IS_ARRAY(document.embedding) && LENGTH(document.embedding) == LENGTH(@embedding)
        LET payload = JSON_PARSE(document.content)
        FILTER payload.version == 1 && payload.kind == "mail-message" && payload.data.accountKey == @connectorKey && payload.data.embeddingContentVersion == 4
        FILTER document.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, CONCAT("mail-inbox\\u0000", @connectorKey))), 24))
        LET thread = DOCUMENT(documents, payload.data.threadKey)
        LET threadPayload = thread == null ? null : JSON_PARSE(thread.content)
        FILTER thread != null && thread.scopeKey == @scopeKey && thread.mutationPolicy == "system-only"
        FILTER thread.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, "communication-mail-threads")), 24))
        FILTER threadPayload.version == 1 && threadPayload.kind == "mail-thread" && threadPayload.data.accountKey == @connectorKey && threadPayload.data.inInbox != false
        FILTER "TRASH" NOT IN (threadPayload.data.labels || [])
        FILTER @readState == null || threadPayload.data.unread == (@readState == "unread")
        FILTER @facets == null || LENGTH(@facets) > 0 && (("urgent" IN @facets && threadPayload.data.inboxCategory == "Urgent") || ("important" IN @facets && threadPayload.data.inboxCategory == "Important") || ("filtered" IN @facets && threadPayload.data.inboxCategory == "Filtered") || ("favorite" IN @facets && threadPayload.data.isFavorite == true))
        LET direct = CONTAINS(LOWER(CONCAT_SEPARATOR(" ", payload.data.from, payload.data.subject, payload.data.body)), @query)
        LET similarity = COSINE_SIMILARITY(document.embedding, @embedding)
        LET score = direct ? 1 : similarity
        FILTER direct || IS_NUMBER(similarity) && similarity >= @minimumScore
        COLLECT threadKey = payload.data.threadKey INTO candidates = { document: document, payload: payload, thread: thread, threadPayload: threadPayload, score: score }
        LET selected = FIRST(FOR candidate IN candidates SORT candidate.score DESC, candidate.payload.data.sentAt DESC, candidate.document._key ASC LIMIT 1 RETURN candidate)
        SORT selected.score DESC, selected.threadPayload.data.lastMessageAt DESC, selected.thread._key ASC
        LIMIT @limit
        RETURN { document: selected.thread, score: selected.score }`, { scopeKey, connectorKey, embedding, query: normalizedQuery, minimumScore, limit, readState: filters.readState ?? null, facets });
      return (await cursor.all() as Array<{ document: unknown; score: number }>).flatMap(({ document, score }) => {
        try { return [{ thread: decodeEmailThread(parsedDocument(document)), score }]; } catch { return []; }
      });
    },
    async thread(scopeKey: string, threadKey: string) {
       const document = await getDocument(scopeKey, threadKey, mailFolderKeys(scopeKey).threads, 'system-only');
       if (!document) throw new EmailRepositoryError('not_found');
       let thread: EmailThread;
       try { thread = decodeEmailThread(document); } catch { throw new EmailRepositoryError('not_found'); }
       if (thread.inInbox === false) throw new EmailRepositoryError('not_found');
       const messages = (await listFolderDocuments(scopeKey, mailInboxFolderKey(scopeKey, thread.accountKey), 'system-only')).flatMap((candidate) => {
        try { const message = decodeEmailMessage(candidate); return message.threadKey === threadKey ? [message] : []; } catch { return []; }
      }).sort(compareEmailMessages);
      return { thread, messages };
    },
    async message(scopeKey: string, messageKey: string) {
      const cursor = await database.query(`LET document = DOCUMENT(documents, @messageKey)
        FILTER document != null && document.scopeKey == @scopeKey && document.mutationPolicy == "system-only"
        LET payload = JSON_PARSE(document.content)
        FILTER payload.version == 1 && payload.kind == "mail-message"
         FILTER document.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, CONCAT("mail-inbox\\u0000", payload.data.accountKey))), 24))
        RETURN document`, { scopeKey, messageKey });
      const document = await cursor.next();
      if (!document) throw new EmailRepositoryError('not_found');
      try { return decodeEmailMessage(parsedDocument(document)); } catch { throw new EmailRepositoryError('not_found'); }
    },
    async mailbox(scopeKey: string, accountKey: string) {
      const cursor = await database.query(`FOR document IN documents FILTER document.scopeKey == @scopeKey && document.mutationPolicy == "system-only"
        LET payload = JSON_PARSE(document.content)
        FILTER payload.version == 1 && payload.data.accountKey == @accountKey && payload.kind IN ["mail-thread", "mail-message"]
         FILTER document.folderKey == (payload.kind == "mail-thread" ? CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, "communication-mail-threads")), 24)) : CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, CONCAT("mail-inbox\\u0000", @accountKey))), 24)))
        RETURN document`, { scopeKey, accountKey });
      const documents = (await cursor.all()).flatMap((raw) => { try { return [parsedDocument(raw)]; } catch { return []; } });
      const threads = documents.flatMap((document) => { try { const value = decodeEmailThread(document); return value.accountKey === accountKey ? [value] : []; } catch { return []; } });
      const threadKeys = new Set(threads.map(({ key }) => key));
      const messages = documents.flatMap((document) => { try { const value = decodeEmailMessage(document); return value.accountKey === accountKey && threadKeys.has(value.threadKey) ? [value] : []; } catch { return []; } });
      return { threads, messages };
    },
    async similarMessages(scopeKey: string, messageKey: string, embedding: number[], limit = 10) {
      const source = await this.message(scopeKey, messageKey);
      const cursor = await database.query(`FOR document IN documents
        FILTER document.scopeKey == @scopeKey && document.mutationPolicy == "system-only" && document._key != @messageKey
        FILTER IS_ARRAY(document.embedding) && LENGTH(document.embedding) == LENGTH(@embedding)
        LET payload = JSON_PARSE(document.content)
        FILTER payload.version == 1 && payload.kind == "mail-message" && payload.data.threadKey != @currentThreadKey && payload.data.accountKey == @accountKey
         FILTER document.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, CONCAT("mail-inbox\\u0000", @accountKey))), 24))
        FILTER payload.data.embeddingContentVersion == 4
        LET similarity = COSINE_SIMILARITY(document.embedding, @embedding)
        FILTER IS_NUMBER(similarity)
        COLLECT threadKey = payload.data.threadKey INTO candidates
        LET selected = FIRST(FOR candidate IN candidates SORT candidate.similarity DESC, candidate.document._key ASC LIMIT 1 RETURN candidate)
        SORT selected.similarity DESC, selected.document._key ASC
        LIMIT @limit
        RETURN { document: selected.document, similarity: selected.similarity }`, { scopeKey, messageKey, currentThreadKey: source.threadKey, accountKey: source.accountKey, embedding, limit: Math.min(limit, 10) });
      return (await cursor.all() as Array<{ document: unknown; similarity: number }>).flatMap(({ document, similarity }) => {
        try { return [{ message: decodeEmailMessage(parsedDocument(document)), similarity }]; } catch { return []; }
      });
    },
    async mutateThreadState(input: { scopeKey: string; accountKey: string; threadKey: string; mutation: { kind: 'favorite'; isFavorite: boolean } | { kind: 'read-state'; isRead: boolean } | { kind: 'trash' }; lease: { connectorKey: string; token: string } }) {
      const updatedAt = new Date().toISOString();
      const mutation = input.mutation.kind;
      const enabled = mutation === 'favorite' ? input.mutation.isFavorite : mutation === 'read-state' ? input.mutation.isRead : true;
      const raw = await mailDeletion(async (trx) => {
        const cursor = await trx.query(`LET connector = DOCUMENT(@@connectors, @connectorKey)
          FILTER connector != null && connector.status != "revoked" && connector.syncEnabled != false
          FILTER connector.syncLeaseToken == @leaseToken && connector.syncLeaseExpiresAt > @updatedAt
          LET thread = DOCUMENT(documents, @threadKey)
           FILTER thread != null && thread.scopeKey == @scopeKey && thread.folderKey == @threadFolderKey && thread.mutationPolicy == "system-only"
          LET threadPayload = JSON_PARSE(thread.content)
          FILTER threadPayload.version == 1 && threadPayload.kind == "mail-thread" && threadPayload.data.accountKey == @accountKey
          LET threadLabels = @mutation == "favorite" ? (@enabled ? PUSH(threadPayload.data.labels || [], "STARRED", true) : REMOVE_VALUE(threadPayload.data.labels || [], "STARRED")) : @mutation == "read-state" ? (@enabled ? REMOVE_VALUE(threadPayload.data.labels || [], "UNREAD") : PUSH(threadPayload.data.labels || [], "UNREAD", true)) : PUSH(threadPayload.data.labels || [], "TRASH", true)
          LET messages = (FOR document IN documents
             FILTER document.scopeKey == @scopeKey && document.folderKey == @inboxFolderKey && document.mutationPolicy == "system-only"
            LET payload = JSON_PARSE(document.content)
            FILTER payload.version == 1 && payload.kind == "mail-message" && payload.data.threadKey == @threadKey && payload.data.accountKey == @accountKey
            LET labels = @mutation == "favorite" ? (@enabled ? PUSH(payload.data.labels || [], "STARRED", true) : REMOVE_VALUE(payload.data.labels || [], "STARRED")) : @mutation == "read-state" ? (@enabled ? REMOVE_VALUE(payload.data.labels || [], "UNREAD") : PUSH(payload.data.labels || [], "UNREAD", true)) : PUSH(payload.data.labels || [], "TRASH", true)
            LET data = @mutation == "read-state" ? MERGE(payload.data, { unread: !@enabled, labels }) : MERGE(payload.data, { labels })
            UPDATE document WITH { content: JSON_STRINGIFY(MERGE(payload, { data })), updatedAt: @updatedAt } IN documents RETURN 1)
          LET threadData = @mutation == "favorite" ? MERGE(threadPayload.data, { isFavorite: @enabled, starred: @enabled, labels: threadLabels }) : @mutation == "read-state" ? MERGE(threadPayload.data, { unread: !@enabled, starred: "STARRED" IN threadLabels, isFavorite: "STARRED" IN threadLabels, labels: threadLabels }) : MERGE(threadPayload.data, { inInbox: true, labels: threadLabels })
          UPDATE thread WITH { content: JSON_STRINGIFY(MERGE(threadPayload, { data: threadData })), updatedAt: @updatedAt } IN documents RETURN NEW`, {
          '@connectors': ORGANIZATION_CONNECTORS_COLLECTION, connectorKey: input.lease.connectorKey, leaseToken: input.lease.token,
           scopeKey: input.scopeKey, threadFolderKey: mailFolderKeys(input.scopeKey).threads, inboxFolderKey: mailInboxFolderKey(input.scopeKey, input.accountKey), accountKey: input.accountKey, threadKey: input.threadKey, mutation, enabled, updatedAt,
        });
        return cursor.next();
      }, true);
      if (!raw) throw new EmailRepositoryError('conflict', 'Email connector lease or selected thread changed before persistence');
      return decodeEmailThread(parsedDocument(raw));
    },
    async clearTrash(input: { scopeKey: string; accountKey: string; providerMessageIds: string[]; trashSnapshotAt: string; lease: { connectorKey: string; token: string } }) {
      const checkedAt = new Date().toISOString();
      return mailDeletion(async (trx) => {
        const cursor = await trx.query(`LET connector = DOCUMENT(@@connectors, @connectorKey)
          FILTER connector != null && connector.status != "revoked" && connector.syncEnabled != false
          FILTER connector.syncLeaseToken == @leaseToken && connector.syncLeaseExpiresAt > @checkedAt
           LET trashedMessages = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey == @inboxFolderKey && document.mutationPolicy == "system-only" LET payload = JSON_PARSE(document.content) FILTER payload.version == 1 && payload.kind == "mail-message" && payload.data.accountKey == @accountKey FILTER payload.data.providerMessageId IN @providerMessageIds || ("TRASH" IN (payload.data.labels || []) && document.updatedAt <= @trashSnapshotAt) RETURN { document, data: payload.data })
          LET threadKeys = UNIQUE(trashedMessages[*].data.threadKey)
          LET emptyThreadKeys = (FOR threadKey IN threadKeys
             LET survivor = FIRST(FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey == @inboxFolderKey && document.mutationPolicy == "system-only" LET payload = JSON_PARSE(document.content) FILTER payload.version == 1 && payload.kind == "mail-message" && payload.data.threadKey == threadKey && payload.data.accountKey == @accountKey && NOT (payload.data.providerMessageId IN @providerMessageIds || ("TRASH" IN (payload.data.labels || []) && document.updatedAt <= @trashSnapshotAt)) LIMIT 1 RETURN true)
            FILTER survivor == null RETURN threadKey)
           LET threads = (FOR document IN documents FILTER document._key IN emptyThreadKeys && document.scopeKey == @scopeKey && document.folderKey == @threadFolderKey && document.mutationPolicy == "system-only" LET payload = JSON_PARSE(document.content) FILTER payload.version == 1 && payload.kind == "mail-thread" && payload.data.accountKey == @accountKey RETURN document)
          LET drafts = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey == @draftFolderKey && document.mutationPolicy == "system-only" LET payload = JSON_PARSE(document.content) FILTER payload.version == 1 && payload.kind == "mail-reply-draft" && payload.data.threadKey IN emptyThreadKeys RETURN document)
          LET stale = UNION(trashedMessages[*].document, threads, drafts)
           LET staleKeys = stale[*]._key
           LET staleProviderMessageIds = trashedMessages[*].data.providerMessageId
           LET attachmentBindings = (FOR binding IN emailAttachmentBindings FILTER binding.scopeKey == @scopeKey && binding.connectorKey == @accountKey && binding.providerMessageId IN staleProviderMessageIds RETURN binding)
           LET attachmentDocuments = (FOR binding IN attachmentBindings FILTER binding.targetType == "document" LET document = DOCUMENT(documents, binding.targetKey) FILTER document != null && document.scopeKey == @scopeKey && document.managedPurpose == "mail-attachment" && document.managedOwnerKey == binding._key RETURN document)
           LET attachmentDocumentKeys = attachmentDocuments[*]._key
           LET attachmentImages = (FOR binding IN attachmentBindings FILTER binding.targetType == "image" && binding.targetKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "email-attachment-target", binding._key)), 24)) LET image = DOCUMENT(images, binding.targetKey) FILTER image != null && image.scopeKey == @scopeKey && image.mutationPolicy == "system-only" RETURN image)
           LET attachmentTargetKeys = UNION(attachmentDocumentKeys, attachmentImages[*]._key)
           LET affectedCollectionKeys = UNIQUE(UNION((FOR relation IN collectionImages FILTER relation.imageKey IN attachmentImages[*]._key RETURN relation.collectionKey), (FOR highlight IN imageCollecitionHightlights FILTER highlight.scopeKey == @scopeKey && LENGTH(INTERSECTION(highlight.imageKeys, attachmentImages[*]._key)) > 0 RETURN highlight.collectionKey), (FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.coverImageKey IN attachmentImages[*]._key RETURN collection._key)))
           LET attachmentRefDocuments = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.mutationPolicy == "system-only" LET payload = JSON_PARSE(document.content) FILTER payload.kind IN ["mail-reply-draft", "mail-new-draft"] && IS_ARRAY(payload.data.attachments) && LENGTH(FOR ref IN payload.data.attachments FILTER ref.key IN attachmentTargetKeys RETURN 1) > 0 RETURN { document, payload })
           LET attachmentCoverDocuments = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.coverImageKey IN attachmentImages[*]._key RETURN document)
           LET cleanedAttachmentRefs = []
           LET dependentDocumentKeys = UNION(staleKeys, attachmentDocumentKeys)
           LET summaryKeys = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey IN dependentDocumentKeys RETURN summary._key)
           LET candidateStorageKeys = UNIQUE(FLATTEN(UNION((FOR document IN documents FILTER document._key IN dependentDocumentKeys RETURN UNION(IS_STRING(document.storageKey) ? [document.storageKey] : [], IS_ARRAY(document.sourceStorageKeys) ? document.sourceStorageKeys : [], IS_ARRAY(document.speechStorageKeys) ? document.speechStorageKeys : [])), (FOR image IN attachmentImages FILTER IS_STRING(image.storageKey) RETURN image.storageKey), (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey IN dependentDocumentKeys && IS_STRING(version.storageKey) RETURN version.storageKey), (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey IN dependentDocumentKeys && IS_STRING(audio.storageKey) RETURN audio.storageKey), (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && (audio.documentKey IN dependentDocumentKeys || audio.summaryKey IN summaryKeys) && IS_STRING(audio.storageKey) RETURN audio.storageKey)), 2))
           LET attachmentStorageKeys = (FOR storageKey IN candidateStorageKeys FILTER LENGTH(FOR document IN documents FILTER document._key NOT IN dependentDocumentKeys && (document.storageKey == storageKey || storageKey IN (document.sourceStorageKeys || []) || storageKey IN (document.speechStorageKeys || [])) LIMIT 1 RETURN 1) == 0 FILTER LENGTH(FOR image IN images FILTER image._key NOT IN attachmentImages[*]._key && image.storageKey == storageKey LIMIT 1 RETURN 1) == 0 FILTER LENGTH(FOR version IN documentVersions FILTER version.documentKey NOT IN dependentDocumentKeys && version.storageKey == storageKey LIMIT 1 RETURN 1) == 0 FILTER LENGTH(FOR audio IN documentAudioVersions FILTER audio.documentKey NOT IN dependentDocumentKeys && audio.storageKey == storageKey LIMIT 1 RETURN 1) == 0 FILTER LENGTH(FOR audio IN documentSummaryAudio FILTER audio.documentKey NOT IN dependentDocumentKeys && audio.summaryKey NOT IN summaryKeys && audio.storageKey == storageKey LIMIT 1 RETURN 1) == 0 RETURN storageKey)
           LET attachmentJobs = []
           LET removedAttachmentRelations = (FOR relation IN collectionImages FILTER relation.imageKey IN attachmentImages[*]._key REMOVE relation IN collectionImages RETURN 1)
           LET removedAttachmentIdentities = (FOR relation IN imageIdentities FILTER relation.imageKey IN attachmentImages[*]._key REMOVE relation IN imageIdentities RETURN 1)
           LET removedAttachmentMemories = (FOR memory IN imageCollectionMemories FILTER memory.scopeKey == @scopeKey && memory.imageKey IN attachmentImages[*]._key REMOVE memory IN imageCollectionMemories RETURN 1)
           LET cleanedAttachmentHighlights = (FOR highlight IN imageCollecitionHightlights FILTER highlight.scopeKey == @scopeKey && LENGTH(INTERSECTION(highlight.imageKeys, attachmentImages[*]._key)) > 0 UPDATE highlight WITH { imageKeys: MINUS(highlight.imageKeys, attachmentImages[*]._key), updatedAt: @checkedAt } IN imageCollecitionHightlights RETURN 1)
           LET removedAttachmentPlaces = (FOR relation IN placeImages FILTER relation.scopeKey == @scopeKey && relation.imageKey IN attachmentImages[*]._key REMOVE relation IN placeImages RETURN 1)
           LET cleanedAttachmentFolders = (FOR folder IN folders FILTER folder.scopeKey == @scopeKey && folder.coverImageKey IN attachmentImages[*]._key UPDATE folder WITH { coverImageKey: null, updatedAt: @checkedAt } IN folders OPTIONS { keepNull: false } RETURN 1)
           LET cleanedAttachmentCollections = (FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.coverImageKey IN attachmentImages[*]._key UPDATE collection WITH { coverImageKey: null, updatedAt: @checkedAt } IN collections OPTIONS { keepNull: false } RETURN 1)
           LET cleanedAttachmentTrips = (FOR trip IN trips FILTER trip.scopeKey == @scopeKey && trip.coverImageKey IN attachmentImages[*]._key UPDATE trip WITH { coverImageKey: null, updatedAt: @checkedAt } IN trips OPTIONS { keepNull: false } RETURN 1)
            LET cleanedAttachmentCovers = []
           LET removedAttachmentTags = (FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && assignment.sourceType == "image" && assignment.sourceKey IN attachmentImages[*]._key REMOVE assignment IN tagAssignments RETURN 1)
           LET removedAttachmentShares = (FOR share IN shares FILTER share.scopeKey == @scopeKey && share.sourceType == "image" && share.sourceKey IN attachmentImages[*]._key REMOVE share IN shares RETURN 1)
           LET removedAttachmentHiddens = (FOR hidden IN userHiddens FILTER hidden.source == "image" && hidden.sourceKey IN attachmentImages[*]._key REMOVE hidden IN userHiddens RETURN 1)
           LET removedAttachmentImages = (FOR image IN attachmentImages REMOVE image IN images RETURN 1)
           LET removedAttachmentCaptions = []
           LET removedAttachmentDocuments = []
           LET removedAttachmentBindings = (FOR binding IN attachmentBindings REMOVE binding IN emailAttachmentBindings RETURN 1)
            LET jobs = (FOR storageKey IN attachmentStorageKeys UPSERT { storageKey } INSERT { storageKey, createdAt: @checkedAt } UPDATE {} IN storageDeletionJobs RETURN 1)
           LET removedSummaryAudio = (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && (audio.documentKey IN dependentDocumentKeys || audio.summaryKey IN summaryKeys) REMOVE audio IN documentSummaryAudio RETURN 1)
           LET removedSummaries = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey IN dependentDocumentKeys REMOVE summary IN documentSummaries RETURN 1)
           LET removedVersions = (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey IN dependentDocumentKeys REMOVE version IN documentVersions RETURN 1)
           LET removedAudioVersions = (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey IN dependentDocumentKeys REMOVE audio IN documentAudioVersions RETURN 1)
            LET removedDocuments = (FOR document IN UNION_DISTINCT(attachmentDocuments, stale) REMOVE document IN documents RETURN 1)
              RETURN { threadsDeleted: LENGTH(threads), documentsDeleted: LENGTH(stale), emptyThreadKeys, survivingThreadKeys: MINUS(threadKeys, emptyThreadKeys), attachmentTargetKeys, attachmentDocumentKeys, attachmentImageKeys: attachmentImages[*]._key, affectedCollectionKeys, attachmentCaptionKeys: attachmentImages[*].imageCaptionKey }`, { '@connectors': ORGANIZATION_CONNECTORS_COLLECTION, connectorKey: input.lease.connectorKey, leaseToken: input.lease.token, checkedAt, scopeKey: input.scopeKey, threadFolderKey: mailFolderKeys(input.scopeKey).threads, inboxFolderKey: mailInboxFolderKey(input.scopeKey, input.accountKey), draftFolderKey: mailFolderKeys(input.scopeKey).drafts, accountKey: input.accountKey, providerMessageIds: input.providerMessageIds, trashSnapshotAt: input.trashSnapshotAt });
          const result = await cursor.next() as { threadsDeleted: number; documentsDeleted: number; emptyThreadKeys: string[]; survivingThreadKeys: string[]; attachmentTargetKeys: string[]; attachmentDocumentKeys: string[]; attachmentImageKeys: string[]; affectedCollectionKeys: string[]; attachmentCaptionKeys: string[] } | undefined;
          if (!result) throw new EmailRepositoryError('conflict', 'Email connector lease was lost before clearing Trash');
          await cleanAttachmentDocumentReferences(trx, input.scopeKey, result.attachmentTargetKeys ?? [], checkedAt);
          await cleanOrphanAttachmentCaptions(trx, result.attachmentCaptionKeys ?? []);
         if (result.survivingThreadKeys.length) {
          await trx.query(`FOR threadKey IN @threadKeys
            LET thread = DOCUMENT(documents, threadKey)
             FILTER thread != null && thread.scopeKey == @scopeKey && thread.folderKey == @threadFolderKey && thread.mutationPolicy == "system-only"
            LET payload = JSON_PARSE(thread.content)
            FILTER payload.version == 1 && payload.kind == "mail-thread"
             LET messages = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey == @inboxFolderKey && document.mutationPolicy == "system-only" LET messagePayload = JSON_PARSE(document.content) FILTER messagePayload.version == 1 && messagePayload.kind == "mail-message" && messagePayload.data.threadKey == threadKey && messagePayload.data.accountKey == @accountKey RETURN messagePayload.data)
            LET labels = (FOR message IN messages FOR label IN (message.labels || []) RETURN DISTINCT label)
            LET data = MERGE(payload.data, { labels, unread: "UNREAD" IN labels, starred: "STARRED" IN labels, isFavorite: "STARRED" IN labels, inInbox: "INBOX" IN labels || "SPAM" IN labels || "TRASH" IN labels })
             UPDATE thread WITH { content: JSON_STRINGIFY(MERGE(payload, { data })), updatedAt: @checkedAt } IN documents`, { threadKeys: result.survivingThreadKeys, scopeKey: input.scopeKey, threadFolderKey: mailFolderKeys(input.scopeKey).threads, inboxFolderKey: mailInboxFolderKey(input.scopeKey, input.accountKey), accountKey: input.accountKey, checkedAt });
        }
        return { threadsDeleted: result.threadsDeleted, documentsDeleted: result.documentsDeleted, attachmentMutation: { documentKeys: result.attachmentDocumentKeys, imageKeys: result.attachmentImageKeys, collectionKeys: result.affectedCollectionKeys } };
      }, true);
    },
    async createMessageTranslation(input: Omit<DocumentVersion, 'key' | 'version' | 'createdAt'>) {
      const snapshot = documentVersionSchema.omit({ key: true, version: true, createdAt: true }).parse(input);
      const raw = await generatedWrite('documentVersions', async (executor) => {
        const cursor = await executor.query(`LET document = DOCUMENT(documents, @documentKey)
          FILTER document != null && document.scopeKey == @scopeKey && document.mutationPolicy == "system-only"
          LET payload = JSON_PARSE(document.content) FILTER payload.kind == "mail-message"
           FILTER document.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, CONCAT("mail-inbox\\u0000", payload.data.accountKey))), 24))
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
    async deleteMessageTranslations(scopeKey: string, messageKey: string, translationKeys: string[]) {
      return contentDeletion(async (trx) => {
        const cursor = await trx.query(`LET document = DOCUMENT(documents, @messageKey)
          FILTER document != null && document.scopeKey == @scopeKey && document.mutationPolicy == "system-only"
          LET payload = JSON_PARSE(document.content) FILTER payload.kind == "mail-message"
           FILTER document.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, CONCAT("mail-inbox\\u0000", payload.data.accountKey))), 24))
          LET selected = (FOR version IN documentVersions FILTER version._key IN @translationKeys && version.scopeKey == @scopeKey && version.documentKey == @messageKey && version.type == "translation" RETURN version)
          FILTER LENGTH(selected) == LENGTH(@translationKeys)
          LET removed = (FOR version IN selected REMOVE version IN documentVersions RETURN OLD._key)
          RETURN { messageKey: @messageKey, deletedKeys: @translationKeys }`, { scopeKey, messageKey, translationKeys });
        const result = await cursor.next() as { messageKey: string; deletedKeys: string[] } | undefined;
        if (!result) throw new EmailRepositoryError('not_found', 'Every translation must belong to the selected email message');
        return result;
      });
    },
    async createMessageSummary(input: Omit<DocumentSummary, 'version'>) {
      const summary = documentSummarySchema.omit({ version: true }).parse(input);
      const raw = await generatedWrite('documentSummaries', async (executor) => {
        const cursor = await executor.query(`LET document = DOCUMENT(documents, @documentKey)
          FILTER document != null && document.scopeKey == @scopeKey && document.mutationPolicy == "system-only"
          LET payload = JSON_PARSE(document.content) FILTER payload.kind == "mail-message"
           FILTER document.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, CONCAT("mail-inbox\\u0000", payload.data.accountKey))), 24))
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
    async deleteMessageSummaries(scopeKey: string, messageKey: string, summaryKeys: string[]) {
      return contentDeletion(async (trx) => {
        const now = new Date().toISOString();
        const cursor = await trx.query(`LET document = DOCUMENT(documents, @messageKey)
          FILTER document != null && document.scopeKey == @scopeKey && document.mutationPolicy == "system-only"
          LET payload = JSON_PARSE(document.content) FILTER payload.kind == "mail-message"
           FILTER document.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, CONCAT("mail-inbox\\u0000", payload.data.accountKey))), 24))
          LET selected = (FOR summary IN documentSummaries FILTER summary._key IN @summaryKeys && summary.scopeKey == @scopeKey && summary.documentKey == @messageKey RETURN summary)
          FILTER LENGTH(selected) == LENGTH(@summaryKeys)
          LET storageKeys = UNIQUE(FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && audio.summaryKey IN @summaryKeys && IS_STRING(audio.storageKey) RETURN audio.storageKey)
          LET jobs = (FOR storageKey IN storageKeys UPSERT { storageKey } INSERT { storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs RETURN 1)
          LET removedAudio = (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && audio.summaryKey IN @summaryKeys REMOVE audio IN documentSummaryAudio RETURN 1)
          LET removed = (FOR summary IN selected REMOVE summary IN documentSummaries RETURN OLD._key)
          RETURN { messageKey: @messageKey, deletedKeys: @summaryKeys, storageKeys }`, { scopeKey, messageKey, summaryKeys, now });
        const result = await cursor.next() as { messageKey: string; deletedKeys: string[]; storageKeys: string[] } | undefined;
        if (!result) throw new EmailRepositoryError('not_found', 'Every summary must belong to the selected email message');
        return result;
      });
    },
    async readThreadPage(scopeKey: string, threadKey: string, limit: number, cursorValue?: string) {
      const detail = await this.thread(scopeKey, threadKey);
      const after = cursorValue ? decodeEmailCursor(cursorValue, threadKey) : null;
      const eligible = detail.messages.filter((message) => !after || compareEmailMessages(message, after) > 0);
      const page = eligible.slice(0, limit);
      const last = page.at(-1);
      return { thread: detail.thread, messages: page, nextCursor: eligible.length > limit && last ? encodeEmailCursor({ v: 2, threadKey, sentAt: last.sentAt, providerMessageId: last.providerMessageId, key: last.key }) : null };
    },
    async deleteProviderThread(scopeKey: string, accountKey: string, providerThreadId: string, lease: { connectorKey: string; token: string }) {
      const threadKey = stableKey('mail-thread', scopeKey, accountKey, providerThreadId);
      const checkedAt = new Date().toISOString();
      const cursor = await mailDeletion(async (executor) => {
        const deletionCursor = await executor.query(`LET connector = DOCUMENT(@@connectors, @connectorKey)
        FILTER connector != null && connector.status != "revoked" && connector.syncEnabled != false
        FILTER connector.syncLeaseToken == @leaseToken && connector.syncLeaseExpiresAt > @checkedAt
         LET stale = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.mutationPolicy == "system-only" LET payload = JSON_PARSE(document.content) FILTER payload.version == 1 && ((document.folderKey == @threadFolderKey && document._key == @threadKey && payload.kind == "mail-thread" && payload.data.accountKey == @accountKey) || (document.folderKey == @inboxFolderKey && payload.kind == "mail-message" && payload.data.threadKey == @threadKey && payload.data.accountKey == @accountKey) || (document.folderKey == @draftFolderKey && payload.kind == "mail-reply-draft" && payload.data.threadKey == @threadKey)) RETURN document)
        LET staleKeys = stale[*]._key
        LET staleProviderMessageIds = (FOR document IN stale LET payload = JSON_PARSE(document.content) FILTER payload.kind == "mail-message" RETURN payload.data.providerMessageId)
        LET attachmentBindings = (FOR binding IN emailAttachmentBindings FILTER binding.scopeKey == @scopeKey && binding.connectorKey == @accountKey && binding.providerMessageId IN staleProviderMessageIds RETURN binding)
        LET attachmentDocuments = (FOR binding IN attachmentBindings FILTER binding.targetType == "document" LET document = DOCUMENT(documents, binding.targetKey) FILTER document != null && document.scopeKey == @scopeKey && document.managedPurpose == "mail-attachment" && document.managedOwnerKey == binding._key RETURN document)
        LET attachmentDocumentKeys = attachmentDocuments[*]._key
        LET attachmentImages = (FOR binding IN attachmentBindings FILTER binding.targetType == "image" && binding.targetKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "email-attachment-target", binding._key)), 24)) LET image = DOCUMENT(images, binding.targetKey) FILTER image != null && image.scopeKey == @scopeKey && image.mutationPolicy == "system-only" RETURN image)
        LET attachmentTargetKeys = UNION(attachmentDocumentKeys, attachmentImages[*]._key)
        LET affectedCollectionKeys = UNIQUE(UNION((FOR relation IN collectionImages FILTER relation.imageKey IN attachmentImages[*]._key RETURN relation.collectionKey), (FOR highlight IN imageCollecitionHightlights FILTER highlight.scopeKey == @scopeKey && LENGTH(INTERSECTION(highlight.imageKeys, attachmentImages[*]._key)) > 0 RETURN highlight.collectionKey), (FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.coverImageKey IN attachmentImages[*]._key RETURN collection._key)))
        LET attachmentRefDocuments = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.mutationPolicy == "system-only" LET payload = JSON_PARSE(document.content) FILTER payload.kind IN ["mail-reply-draft", "mail-new-draft"] && IS_ARRAY(payload.data.attachments) && LENGTH(FOR ref IN payload.data.attachments FILTER ref.key IN attachmentTargetKeys RETURN 1) > 0 RETURN { document, payload })
        LET attachmentCoverDocuments = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.coverImageKey IN attachmentImages[*]._key RETURN document)
        LET cleanedAttachmentRefs = []
        LET dependentDocumentKeys = UNION(staleKeys, attachmentDocumentKeys)
        LET summaryKeys = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey IN dependentDocumentKeys RETURN summary._key)
        LET candidateStorageKeys = UNIQUE(FLATTEN(UNION((FOR document IN documents FILTER document._key IN dependentDocumentKeys RETURN UNION(IS_STRING(document.storageKey) ? [document.storageKey] : [], IS_ARRAY(document.sourceStorageKeys) ? document.sourceStorageKeys : [], IS_ARRAY(document.speechStorageKeys) ? document.speechStorageKeys : [])), (FOR image IN attachmentImages FILTER IS_STRING(image.storageKey) RETURN image.storageKey), (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey IN dependentDocumentKeys && IS_STRING(version.storageKey) RETURN version.storageKey), (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey IN dependentDocumentKeys && IS_STRING(audio.storageKey) RETURN audio.storageKey), (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && (audio.documentKey IN dependentDocumentKeys || audio.summaryKey IN summaryKeys) && IS_STRING(audio.storageKey) RETURN audio.storageKey)), 2))
        LET attachmentStorageKeys = (FOR storageKey IN candidateStorageKeys FILTER LENGTH(FOR document IN documents FILTER document._key NOT IN dependentDocumentKeys && (document.storageKey == storageKey || storageKey IN (document.sourceStorageKeys || []) || storageKey IN (document.speechStorageKeys || [])) LIMIT 1 RETURN 1) == 0 FILTER LENGTH(FOR image IN images FILTER image._key NOT IN attachmentImages[*]._key && image.storageKey == storageKey LIMIT 1 RETURN 1) == 0 FILTER LENGTH(FOR version IN documentVersions FILTER version.documentKey NOT IN dependentDocumentKeys && version.storageKey == storageKey LIMIT 1 RETURN 1) == 0 FILTER LENGTH(FOR audio IN documentAudioVersions FILTER audio.documentKey NOT IN dependentDocumentKeys && audio.storageKey == storageKey LIMIT 1 RETURN 1) == 0 FILTER LENGTH(FOR audio IN documentSummaryAudio FILTER audio.documentKey NOT IN dependentDocumentKeys && audio.summaryKey NOT IN summaryKeys && audio.storageKey == storageKey LIMIT 1 RETURN 1) == 0 RETURN storageKey)
        LET attachmentJobs = []
        LET removedAttachmentRelations = (FOR relation IN collectionImages FILTER relation.imageKey IN attachmentImages[*]._key REMOVE relation IN collectionImages RETURN 1)
        LET removedAttachmentIdentities = (FOR relation IN imageIdentities FILTER relation.imageKey IN attachmentImages[*]._key REMOVE relation IN imageIdentities RETURN 1)
        LET removedAttachmentMemories = (FOR memory IN imageCollectionMemories FILTER memory.scopeKey == @scopeKey && memory.imageKey IN attachmentImages[*]._key REMOVE memory IN imageCollectionMemories RETURN 1)
        LET cleanedAttachmentHighlights = (FOR highlight IN imageCollecitionHightlights FILTER highlight.scopeKey == @scopeKey && LENGTH(INTERSECTION(highlight.imageKeys, attachmentImages[*]._key)) > 0 UPDATE highlight WITH { imageKeys: MINUS(highlight.imageKeys, attachmentImages[*]._key), updatedAt: @checkedAt } IN imageCollecitionHightlights RETURN 1)
        LET removedAttachmentPlaces = (FOR relation IN placeImages FILTER relation.scopeKey == @scopeKey && relation.imageKey IN attachmentImages[*]._key REMOVE relation IN placeImages RETURN 1)
        LET cleanedAttachmentFolders = (FOR folder IN folders FILTER folder.scopeKey == @scopeKey && folder.coverImageKey IN attachmentImages[*]._key UPDATE folder WITH { coverImageKey: null, updatedAt: @checkedAt } IN folders OPTIONS { keepNull: false } RETURN 1)
        LET cleanedAttachmentCollections = (FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.coverImageKey IN attachmentImages[*]._key UPDATE collection WITH { coverImageKey: null, updatedAt: @checkedAt } IN collections OPTIONS { keepNull: false } RETURN 1)
        LET cleanedAttachmentTrips = (FOR trip IN trips FILTER trip.scopeKey == @scopeKey && trip.coverImageKey IN attachmentImages[*]._key UPDATE trip WITH { coverImageKey: null, updatedAt: @checkedAt } IN trips OPTIONS { keepNull: false } RETURN 1)
        LET cleanedAttachmentCovers = []
        LET removedAttachmentTags = (FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && assignment.sourceType == "image" && assignment.sourceKey IN attachmentImages[*]._key REMOVE assignment IN tagAssignments RETURN 1)
        LET removedAttachmentShares = (FOR share IN shares FILTER share.scopeKey == @scopeKey && share.sourceType == "image" && share.sourceKey IN attachmentImages[*]._key REMOVE share IN shares RETURN 1)
        LET removedAttachmentHiddens = (FOR hidden IN userHiddens FILTER hidden.source == "image" && hidden.sourceKey IN attachmentImages[*]._key REMOVE hidden IN userHiddens RETURN 1)
        LET removedAttachmentImages = (FOR image IN attachmentImages REMOVE image IN images RETURN 1)
        LET removedAttachmentCaptions = []
        LET removedAttachmentDocuments = []
        LET removedAttachmentBindings = (FOR binding IN attachmentBindings REMOVE binding IN emailAttachmentBindings RETURN 1)
        LET jobs = (FOR storageKey IN attachmentStorageKeys UPSERT { storageKey } INSERT { storageKey, createdAt: @checkedAt } UPDATE {} IN storageDeletionJobs RETURN 1)
        LET removedSummaryAudio = (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && (audio.documentKey IN dependentDocumentKeys || audio.summaryKey IN summaryKeys) REMOVE audio IN documentSummaryAudio RETURN 1)
        LET removedSummaries = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey IN dependentDocumentKeys REMOVE summary IN documentSummaries RETURN 1)
        LET removedVersions = (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey IN dependentDocumentKeys REMOVE version IN documentVersions RETURN 1)
        LET removedAudioVersions = (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey IN dependentDocumentKeys REMOVE audio IN documentAudioVersions RETURN 1)
        LET removed = (FOR document IN UNION_DISTINCT(attachmentDocuments, stale) REMOVE document IN documents RETURN 1)
         RETURN { count: LENGTH(stale), attachmentTargetKeys, attachmentDocumentKeys, attachmentImageKeys: attachmentImages[*]._key, affectedCollectionKeys, attachmentCaptionKeys: attachmentImages[*].imageCaptionKey }`, { '@connectors': ORGANIZATION_CONNECTORS_COLLECTION, connectorKey: lease.connectorKey, leaseToken: lease.token, checkedAt, scopeKey, threadFolderKey: mailFolderKeys(scopeKey).threads, inboxFolderKey: mailInboxFolderKey(scopeKey, accountKey), draftFolderKey: mailFolderKeys(scopeKey).drafts, accountKey, threadKey });
        const result = await deletionCursor.next() as { count: number; attachmentTargetKeys: string[]; attachmentDocumentKeys: string[]; attachmentImageKeys: string[]; affectedCollectionKeys: string[]; attachmentCaptionKeys: string[] } | undefined;
        if (result) {
          await cleanAttachmentDocumentReferences(executor, scopeKey, result.attachmentTargetKeys ?? [], checkedAt);
          await cleanOrphanAttachmentCaptions(executor, result.attachmentCaptionKeys ?? []);
         }
        return result;
      }, true);
      if (!cursor) throw new EmailRepositoryError('conflict', 'Email synchronization lease was lost before deleting a provider thread');
      return { documentsDeleted: cursor.count, attachmentMutation: { documentKeys: cursor.attachmentDocumentKeys ?? [], imageKeys: cursor.attachmentImageKeys ?? [], collectionKeys: cursor.affectedCollectionKeys ?? [] } };
    },
    async reconcileInbox(scopeKey: string, accountKey: string, providerThreadIds: string[], lease: { connectorKey: string; token: string }) {
      const keep = providerThreadIds.map((providerThreadId) => stableKey('mail-thread', scopeKey, accountKey, providerThreadId));
      const checkedAt = new Date().toISOString();
      const cursor = await mailDeletion(async (executor) => executor.query(`LET connector = DOCUMENT(@@connectors, @connectorKey)
        FILTER connector != null && connector.status != "revoked" && connector.syncEnabled != false
        FILTER connector.syncLeaseToken == @leaseToken && connector.syncLeaseExpiresAt > @checkedAt
         LET stale = (FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey == @threadFolderKey && document.mutationPolicy == "system-only" && document._key NOT IN @keep LET payload = JSON_PARSE(document.content) FILTER payload.version == 1 && payload.kind == "mail-thread" && payload.data.accountKey == @accountKey && IS_STRING(payload.data.providerThreadId) SORT payload.data.providerThreadId RETURN payload.data.providerThreadId)
         RETURN stale`, { '@connectors': ORGANIZATION_CONNECTORS_COLLECTION, connectorKey: lease.connectorKey, leaseToken: lease.token, checkedAt, scopeKey, threadFolderKey: mailFolderKeys(scopeKey).threads, accountKey, keep }), true);
      const stale = await cursor.next() as string[] | undefined;
      if (!stale) throw new EmailRepositoryError('conflict', 'Email synchronization lease was lost before reconciling the inbox');
      return stale;
    },
    async writingProfile(scopeKey: string, profileKey?: string, toneSlug?: string) {
      const documents = [
        ...await listFolderDocuments(scopeKey, mailFolderKeys(scopeKey).tones, 'system-only'),
        ...await listFolderDocuments(scopeKey, mailFolderKeys(scopeKey).tones, 'user'),
      ];
      const profiles = documents.flatMap((document) => {
        try { return [decodeEmailWritingProfile(document)]; } catch { return []; }
      });
      const profile = profileKey ? profiles.find(({ key }) => key === profileKey) : undefined;
      if (profile) return profile;
      const tones = await this.listTones(scopeKey);
      const tone = profileKey
        ? tones.find(({ key }) => key === profileKey)
        : toneSlug
          ? tones.find(({ key, identifier, slug }) => key === toneSlug || identifier === toneSlug || slug === toneSlug)
          : tones[0];
      return tone ? { ...tone, tone: tone.instruction, style: '', structure: '', vocabulary: tone.instruction, conventions: tone.instruction } : null;
    },
    async createDraft(input: EmailDraftCreate) {
      const folders = await ensureMailFolders(database, input.scopeKey);
      const timestamp = new Date().toISOString();
      const key = newId();
      const data = withoutRecordFields({ ...input, key, createdAt: timestamp, updatedAt: timestamp });
      const kind = input.variant === 'new' ? 'mail-new-draft' : 'mail-reply-draft';
      const payload = emailDraftPayloadSchema.parse({ version: 1, kind, data });
      const name = input.variant === 'new' ? input.subject.trim() || '(No subject)' : `Reply ${input.threadKey}`;
      const document = archiveDocument({ key, scopeKey: input.scopeKey, folderKey: folders.drafts, name, payload, embedding: input.embedding, createdAt: timestamp, updatedAt: timestamp });
      return decodeEmailDraft(await insertDocument(document));
    },
    async createSubscriptionDraft(input: EmailDraftCreate & { variant: 'reply'; creationSource: 'subscription' }) {
      const folders = await ensureMailFolders(database, input.scopeKey);
      const timestamp = new Date().toISOString();
      const key = emailSubscriptionDraftKey(input.scopeKey, input.messageKey);
      const data = withoutRecordFields({ ...input, key, createdAt: timestamp, updatedAt: timestamp });
      const payload = emailDraftPayloadSchema.parse({ version: 1, kind: 'mail-reply-draft', data });
      const document = archiveDocument({ key, scopeKey: input.scopeKey, folderKey: folders.drafts, name: `Reply ${input.threadKey}`, payload, embedding: input.embedding, createdAt: timestamp, updatedAt: timestamp });
      const cursor = await database.query('UPSERT { _key: @key } INSERT @document UPDATE {} IN documents RETURN NEW', { key, document: toArangoDoc(document) });
      const draft = decodeEmailDraft(parsedDocument(await cursor.next()));
      if (draft.variant !== 'reply' || draft.creationSource !== 'subscription' || draft.messageKey !== input.messageKey) throw new EmailRepositoryError('conflict', 'Automatic email draft identity is invalid');
      return draft;
    },
    async subscriptionDraftForMessage(scopeKey: string, messageKey: string) {
      const document = await getDocument(scopeKey, emailSubscriptionDraftKey(scopeKey, messageKey), mailFolderKeys(scopeKey).drafts, 'system-only');
      if (!document) return null;
      try {
        const draft = decodeEmailDraft(document);
        return draft.variant === 'reply' && draft.creationSource === 'subscription' && draft.messageKey === messageKey ? draft : null;
      } catch { return null; }
    },
    async getDraft(scopeKey: string, draftKey: string) {
      const document = await getDocument(scopeKey, draftKey, mailFolderKeys(scopeKey).drafts, 'system-only');
      if (!document) throw new EmailRepositoryError('not_found');
      try { return decodeEmailDraft(document); } catch { throw new EmailRepositoryError('not_found'); }
    },
    async outboundDraftAttachments(scopeKey: string, connectorKey: string, draftKey: string) {
      const cursor = await database.query(`FOR draft IN documents
        FILTER draft._key == @draftKey && draft.scopeKey == @scopeKey && draft.folderKey == @draftFolderKey && draft.mutationPolicy == "system-only"
        LET payload = JSON_PARSE(draft.content)
        FILTER payload.version == 1 && payload.kind IN ["mail-reply-draft", "mail-new-draft"] && payload.data.status IN ["sending", "sent"]
        LET thread = payload.kind == "mail-reply-draft" ? DOCUMENT(documents, payload.data.threadKey) : null
        LET threadPayload = thread == null ? null : JSON_PARSE(thread.content)
        FILTER (payload.kind == "mail-new-draft" && payload.data.accountKey == @connectorKey)
           || (payload.kind == "mail-reply-draft" && thread != null && thread.scopeKey == @scopeKey && thread.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, "communication-mail-threads")), 24)) && thread.mutationPolicy == "system-only" && threadPayload.version == 1 && threadPayload.kind == "mail-thread" && threadPayload.data.accountKey == @connectorKey)
        LIMIT 1 RETURN payload.data.attachments || []`, { scopeKey, connectorKey, draftKey, draftFolderKey: mailFolderKeys(scopeKey).drafts });
      const refs = await cursor.next();
      return refs === undefined || refs === null ? null : emailAttachmentRefsSchema.parse(refs);
    },
    async assignDraftConnector(scopeKey: string, draftKey: string, connectorKey: string) {
      const updatedAt = new Date().toISOString();
      const cursor = await database.query(`FOR document IN documents
        FILTER document._key == @draftKey && document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "system-only"
        LET payload = JSON_PARSE(document.content)
        FILTER payload.version == 1 && payload.kind == "mail-new-draft" && payload.data.accountKey IN [@scopeKey, @connectorKey] && payload.data.status IN ["generated", "edited"]
        UPDATE document WITH { content: JSON_STRINGIFY(MERGE(payload, { data: MERGE(payload.data, { accountKey: @connectorKey }) })), updatedAt: @updatedAt } IN documents RETURN NEW`, { scopeKey, folderKey: mailFolderKeys(scopeKey).drafts, draftKey, connectorKey, updatedAt });
      const raw = await cursor.next();
      if (!raw) throw new EmailRepositoryError('conflict', 'Legacy email draft could not be assigned to an inbox');
      return decodeEmailDraft(parsedDocument(raw));
    },
    async listUnassignedDrafts(scopeKey: string) {
      const drafts = await listFolderDocuments(scopeKey, mailFolderKeys(scopeKey).drafts, 'system-only');
      return drafts.map(decodeEmailDraft).filter((draft) => draft.variant === 'new' && draft.accountKey === scopeKey && (draft.status === 'generated' || draft.status === 'edited')).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    },
    async listDrafts(scopeKey: string, connectorKey?: string) {
      const drafts = await listFolderDocuments(scopeKey, mailFolderKeys(scopeKey).drafts, 'system-only');
      const decoded = drafts.map(decodeEmailDraft).filter((draft) => draft.variant === 'reply' && draft.creationSource === 'subscription' && (draft.status === 'generated' || draft.status === 'edited'));
      if (!connectorKey) return decoded.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50);
       const threadCursor = await database.query(`FOR document IN documents FILTER document.scopeKey == @scopeKey && document.folderKey == @threadFolderKey && document.mutationPolicy == "system-only" LET payload = JSON_PARSE(document.content) FILTER payload.version == 1 && payload.kind == "mail-thread" RETURN document`, { scopeKey, threadFolderKey: mailFolderKeys(scopeKey).threads });
      const threads = new Map((await threadCursor.all()).flatMap((raw) => {
        let document: Document;
        try { document = parsedDocument(raw); } catch { return []; }
        try { const thread = decodeEmailThread(document); return [[thread.key, thread] as const]; } catch { return []; }
      }));
      return decoded.filter((draft) => draft.variant === 'new' ? draft.accountKey === connectorKey : threads.get(draft.threadKey)?.accountKey === connectorKey).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 50);
    },
    async searchDrafts(scopeKey: string, connectorKey: string, embedding: number[], query: string, minimumScore: number, limit: number) {
      const normalizedQuery = query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
      const cursor = await database.query(`FOR document IN documents
        FILTER document.scopeKey == @scopeKey && document.folderKey == @draftFolderKey && document.mutationPolicy == "system-only"
        LET payload = JSON_PARSE(document.content)
        FILTER payload.version == 1 && payload.kind == "mail-reply-draft" && payload.data.creationSource == "subscription" && payload.data.status IN ["generated", "edited"]
        LET thread = DOCUMENT(documents, payload.data.threadKey)
        LET threadPayload = thread == null ? null : JSON_PARSE(thread.content)
        FILTER thread != null && thread.scopeKey == @scopeKey && thread.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, "communication-mail-threads")), 24)) && thread.mutationPolicy == "system-only" && threadPayload.version == 1 && threadPayload.kind == "mail-thread" && threadPayload.data.accountKey == @connectorKey
        LET direct = CONTAINS(LOWER(CONCAT_SEPARATOR(" ", document.name, document.content)), @query)
        LET score = IS_ARRAY(document.embedding) && LENGTH(document.embedding) == LENGTH(@embedding) ? COSINE_SIMILARITY(document.embedding, @embedding) : null
        FILTER direct || (IS_NUMBER(score) && score >= @minimumScore)
        SORT direct DESC, score DESC, document.updatedAt DESC, document._key ASC
        LIMIT @limit
        RETURN { document, score: direct ? 1 : score }`, { scopeKey, connectorKey, draftFolderKey: mailFolderKeys(scopeKey).drafts, embedding, query: normalizedQuery, minimumScore, limit });
      return (await cursor.all() as Array<{ document: unknown; score: number }>).flatMap(({ document, score }) => {
        try { return [{ draft: decodeEmailDraft(parsedDocument(document)), score }]; } catch { return []; }
      });
    },
    async updateDraft(scopeKey: string, input: { draftKey: string; finalContent?: string; attachments?: EmailAttachmentRef[]; embedding?: number[] }) {
      const updatedAt = new Date().toISOString();
      const cursor = await database.query(`FOR document IN documents
        FILTER document._key == @draftKey && document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "system-only"
        LET payload = JSON_PARSE(document.content)
        FILTER payload.version == 1 && payload.kind IN ["mail-reply-draft", "mail-new-draft"] && payload.data.status IN ["generated", "edited"]
        LET contentPatch = @hasFinalContent ? { finalContent: @finalContent } : {}
        LET attachmentPatch = @hasAttachments ? { attachments: @attachments } : {}
        LET documentPatch = MERGE({ content: JSON_STRINGIFY(MERGE(payload, { data: MERGE(payload.data, contentPatch, attachmentPatch, { status: "edited" }) })), updatedAt: @updatedAt }, @hasFinalContent ? { embedding: @embedding } : {})
        UPDATE document WITH documentPatch IN documents RETURN NEW`, {
        scopeKey, folderKey: mailFolderKeys(scopeKey).drafts, draftKey: input.draftKey,
        hasFinalContent: input.finalContent !== undefined, finalContent: input.finalContent ?? null,
        hasAttachments: input.attachments !== undefined, attachments: input.attachments ?? null,
        embedding: input.embedding ?? null, updatedAt,
      });
      const raw = await cursor.next();
      if (!raw) throw new EmailRepositoryError('conflict', 'Draft is already sending or finalized');
      return decodeEmailDraft(parsedDocument(raw));
    },
    async deleteDraft(scopeKey: string, draftKey: string) {
      const result = await contentDeletion(async (executor) => {
        const cursor = await executor.query(`LET document = DOCUMENT(documents, @draftKey)
          LET payload = document == null ? null : JSON_PARSE(document.content)
          FILTER document != null && document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "system-only" && payload.version == 1 && payload.kind IN ["mail-reply-draft", "mail-new-draft"] && payload.data.status IN ["generated", "edited", "discarded"]
          LET summaryKeys = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey == @draftKey RETURN summary._key)
          LET versionStorageKeys = (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey == @draftKey && IS_STRING(version.storageKey) RETURN version.storageKey)
          LET audioStorageKeys = (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey == @draftKey && IS_STRING(audio.storageKey) RETURN audio.storageKey)
          LET summaryAudioStorageKeys = (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && (audio.documentKey == @draftKey || audio.summaryKey IN summaryKeys) && IS_STRING(audio.storageKey) RETURN audio.storageKey)
          LET storageKeys = UNIQUE(APPEND(
            APPEND(APPEND(IS_STRING(document.storageKey) ? [document.storageKey] : [], IS_ARRAY(document.sourceStorageKeys) ? document.sourceStorageKeys : []), IS_ARRAY(document.speechStorageKeys) ? document.speechStorageKeys : []),
            UNION(versionStorageKeys, audioStorageKeys, summaryAudioStorageKeys)))
          LET jobs = (FOR storageKey IN storageKeys UPSERT { storageKey } INSERT { storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs RETURN 1)
          LET removedSummaryAudio = (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && (audio.documentKey == @draftKey || audio.summaryKey IN summaryKeys) REMOVE audio IN documentSummaryAudio RETURN 1)
          LET removedSummaries = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey == @draftKey REMOVE summary IN documentSummaries RETURN 1)
          LET removedVersions = (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey == @draftKey REMOVE version IN documentVersions RETURN 1)
          LET removedAudioVersions = (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey == @draftKey REMOVE audio IN documentAudioVersions RETURN 1)
          REMOVE document IN documents RETURN { deletedKey: OLD._key, storageKeys }`, { scopeKey, folderKey: mailFolderKeys(scopeKey).drafts, draftKey, now: new Date().toISOString() });
        return await cursor.next() as { deletedKey: string; storageKeys: string[] } | undefined;
      });
      if (!result) throw new EmailRepositoryError('conflict', 'Only generated, edited, or discarded drafts can be deleted');
      return result;
    },
    async claimDraft(scopeKey: string, draftKey: string) {
      const updatedAt = new Date().toISOString();
      const staleBefore = new Date(Date.now() - 30 * 60_000).toISOString();
      const sendLeaseToken = randomUUID();
      const cursor = await database.query(`FOR document IN documents
        FILTER document._key == @draftKey && document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "system-only"
        LET payload = JSON_PARSE(document.content)
        FILTER payload.version == 1 && payload.kind IN ["mail-reply-draft", "mail-new-draft"]
        FILTER payload.data.status IN ["generated", "edited"] || (payload.data.status == "sending" && (payload.data.sendStartedAt == null || payload.data.sendStartedAt < @staleBefore))
        UPDATE document WITH { content: JSON_STRINGIFY(MERGE(payload, { data: MERGE(payload.data, { status: "sending", sendStartedAt: @updatedAt, sendLeaseToken: @sendLeaseToken }) })), updatedAt: @updatedAt } IN documents
        RETURN NEW`, { scopeKey, folderKey: mailFolderKeys(scopeKey).drafts, draftKey, staleBefore, updatedAt, sendLeaseToken });
      const raw = await cursor.next();
      if (!raw) throw new EmailRepositoryError('conflict', 'Draft was already sent or is being sent');
      return decodeEmailDraft(parsedDocument(raw));
    },
    async renewDraftLease(draftKey: string, sendLeaseToken: string) {
      const updatedAt = new Date().toISOString();
      const cursor = await database.query(`FOR document IN documents FILTER document._key == @draftKey && document.mutationPolicy == "system-only" && document.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", document.scopeKey, "communication-mail-drafts")), 24)) LET payload = JSON_PARSE(document.content) FILTER payload.version == 1 && payload.kind IN ["mail-reply-draft", "mail-new-draft"] && payload.data.status == "sending" && payload.data.sendLeaseToken == @sendLeaseToken UPDATE document WITH { content: JSON_STRINGIFY(MERGE(payload, { data: MERGE(payload.data, { sendStartedAt: @updatedAt }) })), updatedAt: @updatedAt } IN documents RETURN 1`, { draftKey, sendLeaseToken, updatedAt });
      return Boolean(await cursor.next());
    },
    async finishDraft(draftKey: string, sendLeaseToken: string, sent: boolean, providerMessageId?: string) {
      const updatedAt = new Date().toISOString();
      const cursor = await database.query(`FOR document IN documents FILTER document._key == @draftKey && document.mutationPolicy == "system-only" && document.folderKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", document.scopeKey, "communication-mail-drafts")), 24)) LET payload = JSON_PARSE(document.content) FILTER payload.version == 1 && payload.kind IN ["mail-reply-draft", "mail-new-draft"] && payload.data.status == "sending" && payload.data.sendLeaseToken == @sendLeaseToken UPDATE document WITH { content: JSON_STRINGIFY(MERGE(payload, { data: UNSET(MERGE(payload.data, { status: @status, providerMessageId: @providerMessageId }), ["sendStartedAt", "sendLeaseToken"]) })), updatedAt: @updatedAt } IN documents OPTIONS { keepNull: false } RETURN NEW`, { draftKey, sendLeaseToken, status: sent ? 'sent' : 'edited', providerMessageId: providerMessageId ?? null, updatedAt });
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
        FILTER document.scopeKey == @scopeKey && document.mutationPolicy == "system-only"
        FILTER document._key != @currentThreadKey && document._key NOT IN @currentMessageKeys
        FILTER IS_ARRAY(document.embedding) && LENGTH(document.embedding) == LENGTH(@embedding)
        LET payload = JSON_PARSE(document.content)
        FILTER payload.version == 1 && payload.kind IN ["mail-thread", "mail-message"]
         FILTER document.folderKey == (payload.kind == "mail-thread" ? CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, "communication-mail-threads")), 24)) : CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "managed-mail-folder", @scopeKey, CONCAT("mail-inbox\\u0000", payload.data.accountKey))), 24)))
        FILTER payload.kind != "mail-message" || payload.data.threadKey != @currentThreadKey
          FILTER payload.data.embeddingContentVersion == 4
        LET similarity = COSINE_SIMILARITY(document.embedding, @embedding)
        FILTER IS_NUMBER(similarity) && similarity >= @minimumSimilarity
        SORT similarity DESC, document._key ASC
        LIMIT @candidateLimit
        RETURN { document, similarity }`, {
        scopeKey,
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
      const cursor = await database.query(`FOR document IN documents
        FILTER document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "system-only"
        LET payload = JSON_PARSE(document.content)
        FILTER payload.kind == "mail-reply-context" && payload.version == 1
        SORT document.createdAt ASC, document._key ASC LIMIT 21 RETURN document`, { scopeKey, folderKey: mailFolderKeys(scopeKey).replyContext });
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
          LET otherTextLength = SUM(FOR candidate IN documents FILTER candidate.scopeKey == @scopeKey && candidate.folderKey == @folderKey && candidate.mutationPolicy == "system-only" && candidate._key != @noteKey LET payload = JSON_PARSE(candidate.content) FILTER payload.kind == "mail-reply-context" && payload.version == 1 RETURN LENGTH(payload.data.text))
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
    async initializeTones(scopeKey: string, embedTone?: (text: string) => Promise<number[]>) {
      const folders = await ensureMailFolders(database, scopeKey);
      const timestamp = new Date().toISOString();
      const placeholder = Array(EMBEDDING_DIMENSIONS).fill(0);
      const legacyDocuments = new Map((await listFolderDocuments(scopeKey, folders.tones, 'user')).map((document) => [document.key, document]));
      for (const legacy of legacyDefaultTones) {
        const key = stableKey('mail-tone', scopeKey, legacy.slug);
        const stored = legacyDocuments.get(key);
        if (!stored) continue;
        let decoded: EmailTone;
        try { decoded = decodeEmailTone(stored); } catch { continue; }
        const defaultContent = legacyToneContent(legacy);
        const untouched = decoded.name === legacy.name && decoded.instruction === legacy.instruction && !decoded.isFavorite && stored.content === defaultContent && stored.createdAt === stored.updatedAt;
        let removed = false;
        if (untouched) {
          const cursor = await database.query(`FOR document IN documents
            FILTER document._key == @key && document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "user" && document.content == @content && document.isFavorite != true && document.createdAt == document.updatedAt
            LET hasVersions = LENGTH(FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey == @key LIMIT 1 RETURN 1) > 0
            LET hasSummaries = LENGTH(FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey == @key LIMIT 1 RETURN 1) > 0
            FILTER !hasVersions && !hasSummaries
            REMOVE document IN documents RETURN true`, { key, scopeKey, folderKey: folders.tones, content: defaultContent });
          removed = await cursor.next() === true;
        }
        if (!removed) {
          const customContent = encodeEmailToneContent({ name: decoded.name, instruction: decoded.instruction });
          await database.query('FOR document IN documents FILTER document._key == @key && document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "user" && document.content == @expectedContent UPDATE document WITH { content: @customContent, updatedAt: @updatedAt } IN documents RETURN NEW', { key, scopeKey, folderKey: folders.tones, expectedContent: stored.content, customContent, updatedAt: timestamp });
        }
      }
      const existing = new Map((await listFolderDocuments(scopeKey, folders.tones, 'user')).map((document) => [document.key, document]));
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
      const documents = await listFolderDocuments(scopeKey, folders.tones, 'user');
      if (embedTone) for (const stored of documents) {
        let decoded: EmailTone;
        try { decoded = decodeEmailTone(stored); } catch { continue; }
        const semanticText = emailToneSemanticText(decoded);
        const canonicalContent = encodeEmailToneContent({ identifier: decoded.identifier, slug: decoded.slug, name: decoded.name, instruction: decoded.instruction });
        const expectedChunks = chunkDocumentContent(semanticText);
        const stale = stored.content !== canonicalContent
          || stored.emailToneEmbeddingVersion !== 1
          || stored.semanticContentHash !== documentSemanticHash(semanticText)
          || stored.semanticChunkCount !== expectedChunks.length
          || stored.contentChunks?.length !== expectedChunks.length
          || expectedChunks.some((chunk, index) => stored.contentChunks?.[index] !== chunk)
          || stored.chunkEmbeddings?.length !== expectedChunks.length;
        if (!stale) continue;
        const embedding = await embedTone(semanticText);
        const prepared = prepareEmailToneDocument({ ...stored, name: decoded.name, content: canonicalContent }, decoded, embedding);
        await database.query('FOR document IN documents FILTER document._key == @key && document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "user" && document.content == @expectedContent UPDATE document WITH @patch IN documents', { key: stored.key, scopeKey, folderKey: folders.tones, expectedContent: stored.content, patch: { name: decoded.name, content: canonicalContent, embedding: prepared.embedding, contentChunks: prepared.contentChunks, chunkEmbeddings: prepared.chunkEmbeddings, semanticChunkCount: prepared.semanticChunkCount, semanticContentHash: prepared.semanticContentHash, emailToneEmbeddingVersion: 1 } });
      }
      return this.listTones(scopeKey);
    },
    async listTones(scopeKey: string) {
      const documents = await listFolderDocuments(scopeKey, mailFolderKeys(scopeKey).tones, 'user');
      return documents.flatMap((document) => {
        try { return [decodeEmailTone(document)]; } catch { return []; }
      }).sort((a, b) => {
        const aIndex = defaultTones.findIndex(({ slug }) => slug === a.slug), bIndex = defaultTones.findIndex(({ slug }) => slug === b.slug);
        const rank = (index: number) => index < 0 ? defaultTones.length : index;
        return rank(aIndex) - rank(bIndex) || a.createdAt.localeCompare(b.createdAt) || a.key.localeCompare(b.key);
      });
    },
    async searchTones(scopeKey: string, embedding: number[], query: string, minimumScore: number, limit: number) {
      const normalizedQuery = query.normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US');
      const cursor = await database.query(`FOR document IN documents
        FILTER document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "user"
        FILTER IS_ARRAY(document.embedding) && LENGTH(document.embedding) == LENGTH(@embedding)
        LET direct = CONTAINS(LOWER(CONCAT_SEPARATOR(" ", document.name, document.content)), @query)
        LET score = COSINE_SIMILARITY(document.embedding, @embedding)
        FILTER direct || (IS_NUMBER(score) && score >= @minimumScore)
        SORT direct DESC, score DESC, document.updatedAt DESC, document._key ASC
        LIMIT @limit
        RETURN { document, score: direct ? 1 : score }`, { scopeKey, folderKey: mailFolderKeys(scopeKey).tones, embedding, query: normalizedQuery, minimumScore, limit });
      return (await cursor.all() as Array<{ document: unknown; score: number }>).flatMap(({ document, score }) => {
        try { return [{ tone: decodeEmailTone(parsedDocument(document)), score }]; } catch { return []; }
      });
    },
    async getTone(scopeKey: string, toneKey: string): Promise<EmailTone | null> {
      const document = await getDocument(scopeKey, toneKey, mailFolderKeys(scopeKey).tones, 'user');
      if (!document) return null;
      try { return decodeEmailTone(document); } catch { return null; }
    },
    async createTone(scopeKey: string, input: { name: string; instruction: string; isFavorite: boolean; embedding: number[] }): Promise<EmailTone> {
      const folders = await ensureMailFolders(database, scopeKey);
      const timestamp = new Date().toISOString();
      const key = newId();
      const data = emailTonePayloadSchema.shape.data.parse({ identifier: key, name: input.name, instruction: input.instruction });
      const document = archiveDocument({ key, scopeKey, folderKey: folders.tones, name: input.name, payload: emailTonePayloadSchema.parse({ version: 1, kind: 'mail-tone', data }), embedding: input.embedding, createdAt: timestamp, updatedAt: timestamp, mutationPolicy: 'user' });
      document.content = encodeEmailToneContent(data);
      document.isFavorite = input.isFavorite;
      const persistedDocument = prepareEmailToneDocument(document, data, input.embedding);
      const cursor = await database.query('INSERT @document IN documents RETURN NEW', { document: toArangoDoc(persistedDocument) });
      return decodeEmailTone(parsedDocument(await cursor.next()));
    },
    async updateTone(scopeKey: string, toneKey: string, expectedUpdatedAt: string, patch: { name?: string; instruction?: string; isFavorite?: boolean; embedding?: number[] }): Promise<EmailTone | null> {
      const current = await getDocument(scopeKey, toneKey, mailFolderKeys(scopeKey).tones, 'user');
      if (!current) return null;
      let tone: EmailTone;
      try { tone = decodeEmailTone(current); } catch { return null; }
      const data = emailTonePayloadSchema.shape.data.parse({ identifier: tone.identifier, slug: tone.slug, name: patch.name ?? tone.name, instruction: patch.instruction ?? tone.instruction });
      const content = encodeEmailToneContent(data);
      const embedding = patch.embedding ?? tone.embedding;
      const prepared = prepareEmailToneDocument({ ...current, name: data.name, content }, data, embedding);
      const cursor = await database.query(`FOR document IN documents FILTER document._key == @toneKey && document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "user" && document.content == @expectedContent && document.updatedAt == @expectedUpdatedAt
        UPDATE document WITH MERGE({ name: @name, content: @content, embedding: @embedding, contentChunks: @contentChunks, chunkEmbeddings: @chunkEmbeddings, semanticChunkCount: @semanticChunkCount, semanticContentHash: @semanticContentHash, emailToneEmbeddingVersion: 1, updatedAt: @updatedAt }, @setFavorite ? { isFavorite: @isFavorite } : {}) IN documents OPTIONS { keepNull: false }
        RETURN NEW`, { scopeKey, folderKey: mailFolderKeys(scopeKey).tones, toneKey, expectedContent: current.content, expectedUpdatedAt, name: data.name, content, embedding, contentChunks: prepared.contentChunks, chunkEmbeddings: prepared.chunkEmbeddings, semanticChunkCount: prepared.semanticChunkCount, semanticContentHash: prepared.semanticContentHash, updatedAt: new Date().toISOString(), setFavorite: patch.isFavorite !== undefined, isFavorite: patch.isFavorite ?? false });
      const raw = await cursor.next();
      return raw ? decodeEmailTone(parsedDocument(raw)) : null;
    },
    async deleteTone(scopeKey: string, toneKey: string) {
      const current = await getDocument(scopeKey, toneKey, mailFolderKeys(scopeKey).tones, 'user');
      if (!current) throw new EmailRepositoryError('forbidden', 'Built-in email tones cannot be deleted');
      let tone: EmailTone;
      try { tone = decodeEmailTone(current); } catch { throw new EmailRepositoryError('forbidden', 'Built-in email tones cannot be deleted'); }
      if (tone.slug) throw new EmailRepositoryError('forbidden', 'Built-in email tones cannot be deleted');
      const result = await contentDeletion(async (executor) => {
        const cursor = await executor.query(`LET document = DOCUMENT(documents, @toneKey)
          FILTER document != null && document.scopeKey == @scopeKey && document.folderKey == @folderKey && document.mutationPolicy == "user" && document.content == @expectedContent && document.updatedAt == @expectedUpdatedAt
          LET summaryKeys = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey == @toneKey RETURN summary._key)
          LET versionStorageKeys = (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey == @toneKey && IS_STRING(version.storageKey) RETURN version.storageKey)
          LET audioStorageKeys = (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey == @toneKey && IS_STRING(audio.storageKey) RETURN audio.storageKey)
          LET summaryAudioStorageKeys = (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && (audio.documentKey == @toneKey || audio.summaryKey IN summaryKeys) && IS_STRING(audio.storageKey) RETURN audio.storageKey)
          LET storageKeys = UNIQUE(APPEND(
            APPEND(APPEND(IS_STRING(document.storageKey) ? [document.storageKey] : [], IS_ARRAY(document.sourceStorageKeys) ? document.sourceStorageKeys : []), IS_ARRAY(document.speechStorageKeys) ? document.speechStorageKeys : []),
            UNION(versionStorageKeys, audioStorageKeys, summaryAudioStorageKeys)))
          LET jobs = (FOR storageKey IN storageKeys UPSERT { storageKey } INSERT { storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs RETURN 1)
          LET removedSummaryAudio = (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && (audio.documentKey == @toneKey || audio.summaryKey IN summaryKeys) REMOVE audio IN documentSummaryAudio RETURN 1)
          LET removedSummaries = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey == @toneKey REMOVE summary IN documentSummaries RETURN 1)
          LET removedVersions = (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey == @toneKey REMOVE version IN documentVersions RETURN 1)
          LET removedAudioVersions = (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey == @toneKey REMOVE audio IN documentAudioVersions RETURN 1)
          REMOVE document IN documents RETURN { deletedKey: OLD._key, storageKeys }`, { scopeKey, folderKey: mailFolderKeys(scopeKey).tones, toneKey, expectedContent: current.content, expectedUpdatedAt: current.updatedAt, now: new Date().toISOString() });
        return await cursor.next() as { deletedKey: string; storageKeys: string[] } | undefined;
      });
      if (!result) throw new EmailRepositoryError('forbidden', 'Built-in email tones cannot be deleted');
      return result;
    },
  };
}

export type EmailRepository = ReturnType<typeof createEmailRepository>;
