import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { db } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing';
import { conversationAttachmentReferenceSchema, type ConversationAttachmentReference } from './schemas';

export const CONVERSATION_ATTACHMENT_ARTIFACTS_COLLECTION = 'conversationAttachmentArtifacts';
export const CONVERSATION_ATTACHMENT_ARTIFACT_TTL_MS = 30 * 24 * 60 * 60_000;
export const CONVERSATION_ATTACHMENT_LEASE_MS = 5 * 60_000;
export const CONVERSATION_ATTACHMENT_MAX_ATTEMPTS = 5;

const filenameSchema = z.string().trim().min(1).max(255);
const documentMimeSchema = z.enum(['text/plain', 'text/markdown', 'text/x-markdown', 'application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document']);
export const conversationAttachmentArtifactSchema = z.object({
  key: z.string().cuid(), ownerKey: z.string().cuid(), teamKey: z.string().trim().min(1).max(160), scopeKey: z.string().cuid(), userKey: z.string().cuid(),
  conversationKey: z.string().cuid(), requestKey: z.string().trim().min(1).max(200), userMessageKey: z.string().cuid().optional(),
  teamAssurance: z.object({ teamMembershipKey: z.string().cuid(), teamMfaVersion: z.number().int().nonnegative() }).strict().optional(),
  kind: z.enum(['document', 'image']), filename: filenameSchema, mimeType: z.union([documentMimeSchema, z.literal('image/png')]), sizeBytes: z.number().int().positive().max(25 * 1024 * 1024),
  width: z.number().int().positive().max(16_384).optional(), height: z.number().int().positive().max(16_384).optional(),
  stagedStorageKey: z.string().trim().min(1), stagedSha256: z.string().regex(/^[a-f0-9]{64}$/), documentContent: z.string().trim().min(1).optional(), documentMetadata: z.record(z.unknown()).optional(),
  status: z.enum(['PREPARED', 'CLAIMED', 'PROCESSING', 'COMPLETED', 'FAILED']), finalReference: conversationAttachmentReferenceSchema.optional(),
  attempts: z.number().int().nonnegative(), availableAt: z.string().datetime(), leaseToken: z.string().trim().min(1).optional(), leaseExpiresAt: z.string().datetime().optional(), error: z.string().trim().min(1).max(4_000).optional(),
  createdAt: z.string().datetime(), expiresAt: z.string().datetime(),
}).strict().superRefine((artifact, context) => {
  if (artifact.kind === 'image' && (artifact.mimeType !== 'image/png' || !artifact.width || !artifact.height || artifact.documentContent)) context.addIssue({ code: 'custom', path: ['kind'], message: 'Image artifacts require canonical PNG metadata.' });
  if (artifact.kind === 'document' && (!documentMimeSchema.safeParse(artifact.mimeType).success || artifact.width || artifact.height)) context.addIssue({ code: 'custom', path: ['kind'], message: 'Document artifacts require a supported document MIME type.' });
  if ((artifact.status === 'PROCESSING') !== Boolean(artifact.leaseToken && artifact.leaseExpiresAt)) context.addIssue({ code: 'custom', path: ['leaseToken'], message: 'Only processing artifacts require a complete lease.' });
  if ((artifact.status === 'COMPLETED') !== Boolean(artifact.finalReference)) context.addIssue({ code: 'custom', path: ['finalReference'], message: 'Only completed artifacts require a final reference.' });
});
export type ConversationAttachmentArtifact = z.infer<typeof conversationAttachmentArtifactSchema>;
export type AttachmentOwner = { teamKey: string; scopeKey: string; userKey: string };
type Database = Pick<typeof db, 'query'>;
const parse = (row: unknown) => conversationAttachmentArtifactSchema.parse(withArangoKey(row as Record<string, unknown>));

export interface ConversationAttachmentArtifactRepository {
  insertPrepared(records: ConversationAttachmentArtifact[]): Promise<ConversationAttachmentArtifact[]>;
  readBound(owner: AttachmentOwner, conversationKey: string, requestKey: string, keys: string[]): Promise<ConversationAttachmentArtifact[]>;
  readClaimed(owner: AttachmentOwner, userMessageKey: string, keys: string[]): Promise<ConversationAttachmentArtifact[]>;
  read(key: string): Promise<ConversationAttachmentArtifact | null>;
  lease(key: string, token: string, now: string, leaseExpiresAt: string): Promise<ConversationAttachmentArtifact | null>;
  renew(key: string, token: string, leaseExpiresAt: string): Promise<boolean>;
  complete(key: string, token: string, reference: ConversationAttachmentReference): Promise<boolean>;
  retry(key: string, token: string, error: string, availableAt: string, terminal: boolean): Promise<boolean>;
  listRecoverable(now: string, limit?: number): Promise<ConversationAttachmentArtifact[]>;
  settleMessage(userMessageKey: string): Promise<{ userKey: string; conversationKey: string; status: 'PENDING' | 'COMPLETED' | 'PARTIAL' | 'FAILED'; references: ConversationAttachmentReference[] } | null>;
  listExpired(now: string, limit?: number): Promise<ConversationAttachmentArtifact[]>;
  removeExpired(key: string, expiresAt: string, now: string): Promise<boolean>;
}

export function createConversationAttachmentArtifactRepository(database: Database = db): ConversationAttachmentArtifactRepository {
  return {
    async insertPrepared(records) {
      const values = records.map((record) => toArangoDoc(conversationAttachmentArtifactSchema.parse(record)));
      const cursor = await database.query('FOR value IN @values UPSERT { _key: value._key } INSERT value UPDATE {} IN @@artifacts RETURN NEW', { '@artifacts': CONVERSATION_ATTACHMENT_ARTIFACTS_COLLECTION, values });
      return (await cursor.all()).map(parse);
    },
    async readBound(owner, conversationKey, requestKey, keys) {
      const cursor = await database.query('FOR artifact IN @@artifacts FILTER artifact._key IN @keys && artifact.teamKey == @teamKey && artifact.scopeKey == @scopeKey && artifact.userKey == @userKey && artifact.conversationKey == @conversationKey && artifact.requestKey == @requestKey SORT POSITION(@keys, artifact._key) RETURN artifact', { '@artifacts': CONVERSATION_ATTACHMENT_ARTIFACTS_COLLECTION, ...owner, conversationKey, requestKey, keys });
      return (await cursor.all()).map(parse);
    },
    async readClaimed(owner, userMessageKey, keys) {
      const cursor = await database.query('FOR artifact IN @@artifacts FILTER artifact._key IN @keys && artifact.teamKey == @teamKey && artifact.scopeKey == @scopeKey && artifact.userKey == @userKey && artifact.userMessageKey == @userMessageKey && artifact.status IN ["CLAIMED", "PROCESSING", "COMPLETED", "FAILED"] SORT POSITION(@keys, artifact._key) RETURN artifact', { '@artifacts': CONVERSATION_ATTACHMENT_ARTIFACTS_COLLECTION, ...owner, userMessageKey, keys });
      return (await cursor.all()).map(parse);
    },
    async read(key) { const cursor = await database.query('FOR artifact IN @@artifacts FILTER artifact._key == @key LIMIT 1 RETURN artifact', { '@artifacts': CONVERSATION_ATTACHMENT_ARTIFACTS_COLLECTION, key }); const row = await cursor.next(); return row ? parse(row) : null; },
    async lease(key, token, now, leaseExpiresAt) {
      const cursor = await database.query('FOR artifact IN @@artifacts FILTER artifact._key == @key && artifact.attempts < @maximumAttempts && artifact.availableAt <= @now && (artifact.status IN ["CLAIMED", "FAILED"] || (artifact.status == "PROCESSING" && artifact.leaseExpiresAt <= @now)) UPDATE artifact WITH { status: "PROCESSING", attempts: artifact.attempts + 1, leaseToken: @token, leaseExpiresAt: @leaseExpiresAt, error: null } IN @@artifacts OPTIONS { keepNull: false } RETURN NEW', { '@artifacts': CONVERSATION_ATTACHMENT_ARTIFACTS_COLLECTION, key, token, now, leaseExpiresAt, maximumAttempts: CONVERSATION_ATTACHMENT_MAX_ATTEMPTS });
      const row = await cursor.next(); return row ? parse(row) : null;
    },
    async renew(key, token, leaseExpiresAt) {
      const cursor = await database.query('FOR artifact IN @@artifacts FILTER artifact._key == @key && artifact.status == "PROCESSING" && artifact.leaseToken == @token UPDATE artifact WITH { leaseExpiresAt: @leaseExpiresAt } IN @@artifacts RETURN true', { '@artifacts': CONVERSATION_ATTACHMENT_ARTIFACTS_COLLECTION, key, token, leaseExpiresAt });
      return Boolean(await cursor.next());
    },
    async complete(key, token, reference) {
      const cursor = await database.query('FOR artifact IN @@artifacts FILTER artifact._key == @key && artifact.status == "PROCESSING" && artifact.leaseToken == @token UPDATE artifact WITH { status: "COMPLETED", finalReference: @reference, leaseToken: null, leaseExpiresAt: null, error: null } IN @@artifacts OPTIONS { keepNull: false } RETURN true', { '@artifacts': CONVERSATION_ATTACHMENT_ARTIFACTS_COLLECTION, key, token, reference: conversationAttachmentReferenceSchema.parse(reference) });
      return Boolean(await cursor.next());
    },
    async retry(key, token, error, availableAt, terminal) {
      const cursor = await database.query('FOR artifact IN @@artifacts FILTER artifact._key == @key && artifact.status == "PROCESSING" && artifact.leaseToken == @token UPDATE artifact WITH { status: "FAILED", availableAt: @availableAt, error: @error, leaseToken: null, leaseExpiresAt: null, attempts: @terminal ? @maximumAttempts : artifact.attempts } IN @@artifacts OPTIONS { keepNull: false } RETURN true', { '@artifacts': CONVERSATION_ATTACHMENT_ARTIFACTS_COLLECTION, key, token, error: error.slice(0, 4_000) || 'Attachment persistence failed.', availableAt, terminal, maximumAttempts: CONVERSATION_ATTACHMENT_MAX_ATTEMPTS });
      return Boolean(await cursor.next());
    },
    async listRecoverable(now, limit = 500) {
      const cursor = await database.query('FOR artifact IN @@artifacts FILTER artifact.attempts < @maximumAttempts && artifact.availableAt <= @now && (artifact.status IN ["CLAIMED", "FAILED"] || (artifact.status == "PROCESSING" && artifact.leaseExpiresAt <= @now)) SORT artifact.availableAt, artifact._key LIMIT @limit RETURN artifact', { '@artifacts': CONVERSATION_ATTACHMENT_ARTIFACTS_COLLECTION, now, limit, maximumAttempts: CONVERSATION_ATTACHMENT_MAX_ATTEMPTS });
      return (await cursor.all()).map(parse);
    },
    async settleMessage(userMessageKey) {
      const cursor = await database.query('LET artifacts = (FOR artifact IN @@artifacts FILTER artifact.userMessageKey == @userMessageKey RETURN artifact) FILTER LENGTH(artifacts) > 0 LET active = LENGTH(FOR artifact IN artifacts FILTER artifact.status IN ["CLAIMED", "PROCESSING"] || (artifact.status == "FAILED" && artifact.attempts < @maximumAttempts) RETURN 1) LET references = (FOR artifact IN artifacts FILTER artifact.status == "COMPLETED" SORT artifact.createdAt, artifact._key RETURN artifact.finalReference) LET status = active > 0 ? "PENDING" : LENGTH(references) == LENGTH(artifacts) ? "COMPLETED" : LENGTH(references) > 0 ? "PARTIAL" : "FAILED" LET visibleReferences = active > 0 ? [] : references LET message = DOCUMENT(@@messages, @userMessageKey) FILTER message != null UPDATE message WITH { attachments: visibleReferences, attachmentStatus: status, pendingAttachmentKeys: active > 0 ? message.pendingAttachmentKeys : null } IN @@messages OPTIONS { keepNull: false } RETURN { userKey: message.userKey, conversationKey: message.conversationKey, status, references: visibleReferences }', { '@artifacts': CONVERSATION_ATTACHMENT_ARTIFACTS_COLLECTION, '@messages': 'conversationMessages', userMessageKey, maximumAttempts: CONVERSATION_ATTACHMENT_MAX_ATTEMPTS });
      const row = await cursor.next();
      return row ? row as { userKey: string; conversationKey: string; status: 'PENDING' | 'COMPLETED' | 'PARTIAL' | 'FAILED'; references: ConversationAttachmentReference[] } : null;
    },
    async listExpired(now, limit = 500) {
      const cursor = await database.query('FOR artifact IN @@artifacts FILTER artifact.expiresAt <= @now SORT artifact.expiresAt LIMIT @limit RETURN artifact', { '@artifacts': CONVERSATION_ATTACHMENT_ARTIFACTS_COLLECTION, now, limit });
      return (await cursor.all()).map(parse);
    },
    async removeExpired(key, expiresAt, now) {
      const cursor = await database.query('FOR artifact IN @@artifacts FILTER artifact._key == @key && artifact.expiresAt == @expiresAt && artifact.expiresAt <= @now REMOVE artifact IN @@artifacts RETURN true', { '@artifacts': CONVERSATION_ATTACHMENT_ARTIFACTS_COLLECTION, key, expiresAt, now });
      return Boolean(await cursor.next());
    },
  };
}

let repository: ConversationAttachmentArtifactRepository | undefined;
export const getDefaultConversationAttachmentArtifactRepository = () => repository ??= createConversationAttachmentArtifactRepository();
export const artifactSha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
export const newAttachmentLeaseToken = () => randomUUID();

export async function cleanupExpiredConversationAttachmentArtifacts(dependencies: { repository?: ConversationAttachmentArtifactRepository; storage?: Pick<DocumentObjectStorage, 'delete'>; now?: () => string } = {}) {
  const repository = dependencies.repository ?? getDefaultConversationAttachmentArtifactRepository(); const storage = dependencies.storage ?? documentStorage; const now = (dependencies.now ?? (() => new Date().toISOString()))(); let removed = 0;
  for (const artifact of await repository.listExpired(now)) {
    await storage.delete(artifact.stagedStorageKey);
    if (await repository.removeExpired(artifact.key, artifact.expiresAt, now)) removed += 1;
  }
  return { removed };
}
