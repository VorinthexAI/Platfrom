import { createHash, randomUUID } from 'node:crypto';
import { db } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { documentStorage, type DocumentObjectStorage } from '@/lib/ai/document-processing/storage';
import { parseDocument, type DocumentParseDependencies } from '@/lib/ai/document-processing';
import { processImage, type ImageProcessingDependencies } from '@/lib/ai/image-processing';
import { sanitizeGalleryImage } from '@/lib/gallery/image-location';
import { documentSchema, type Document } from '@/lib/db/documents.node';
import { imageSchema } from '@/lib/db/images.node';
import { EMAIL_ATTACHMENTS_COLLECTION, emailAttachmentSchema, type EmailAttachment } from '@/lib/db/email-attachments.node';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { discoverGmailAttachmentParts, GmailPermanentAttachmentError, gmailAttachmentParts, messageBodies, type GmailAttachmentPart, type GmailClient, type GmailMessageResource } from './gmail';
import type { EmailAttachmentRef } from './archive-payloads';
import { emailExportContainerKeys } from './export-container-keys';

export { emailArchiveInboxFolderKey, emailArchiveRootFolderKey, emailMediaCollectionKey } from './export-container-keys';

const PROCESSING_LEASE_MS = 30 * 60_000;
const PROCESSING_HEARTBEAT_MS = 5 * 60_000;
const zeroEmbedding = () => Array(EMBEDDING_DIMENSIONS).fill(0);
const stableKey = (kind: string, ...values: string[]) => `c${createHash('sha256').update([kind, ...values].join('\0')).digest('hex').slice(0, 24)}`;
const safeSegment = (value: string) => value.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 120) || 'attachment';
export class EmailAttachmentIngestionError extends Error {
  constructor(readonly code: 'ATTACHMENT_CONFLICT' | 'ATTACHMENT_BUSY' | 'ATTACHMENT_ACCESS_REVOKED' | 'ATTACHMENT_PERSIST_FAILED', message: string, readonly retryable: boolean) { super(message); }
}

type AttachmentSource = { key: string; organizationKey: string; scopeKey: string; connectorKey: string; providerMessageId: string; partPath: string; contentHash: string; sourceMimeType: string; sourceFilename: string; sourceSize: number; targetType: 'document' | 'image'; targetKey: string };
type AttachmentView = AttachmentSource & { status: 'processing' | 'completed'; leaseToken?: string; leaseExpiresAt?: string; createdAt: string; updatedAt: string; storageKey?: string };
const view = (attachment: EmailAttachment): AttachmentView => ({ key: attachment.key, organizationKey: attachment.organizationKey, scopeKey: attachment.scopeKey, connectorKey: attachment.connectorKey, providerMessageId: attachment.providerMessageId, partPath: attachment.partPath, contentHash: attachment.contentHash, sourceMimeType: attachment.mimeType, sourceFilename: attachment.filename, sourceSize: attachment.sizeBytes, targetType: attachment.kind, targetKey: attachment.key, status: attachment.status, ...(attachment.leaseToken ? { leaseToken: attachment.leaseToken } : {}), ...(attachment.leaseExpiresAt ? { leaseExpiresAt: attachment.leaseExpiresAt } : {}), ...(attachment.storageKey ? { storageKey: attachment.storageKey } : {}), createdAt: attachment.createdAt, updatedAt: attachment.updatedAt });
const parse = (value: unknown) => emailAttachmentSchema.parse(withArangoKey(value as Record<string, unknown>));

export interface EmailAttachmentRepository {
  activeMembership(input: { organizationKey: string; scopeKey: string; preferredMembershipKey: string }): Promise<string>;
  completed(input: Omit<AttachmentSource, 'contentHash' | 'targetKey'>, membershipKey: string): Promise<AttachmentView | null>;
  claim(input: AttachmentSource, membershipKey: string, leaseToken: string, now: string, leaseExpiresAt: string): Promise<{ status: 'claimed' | 'replay'; binding: AttachmentView }>;
  persistStorage(bindingKey: string, leaseToken: string, storageKey: string, now: string): Promise<boolean>;
  renew(bindingKey: string, leaseToken: string, connectorLeaseToken: string, now: string, leaseExpiresAt: string): Promise<boolean>;
  complete(bindingKey: string, leaseToken: string, targetType: 'document' | 'image', targetKey: string, collectionKey: string | undefined, membershipKey: string, now: string): Promise<boolean>;
  compensateTarget(bindingKey: string, leaseToken: string, targetType: 'document' | 'image', targetKey: string, scopeKey: string, now: string): Promise<void>;
  release(bindingKey: string, leaseToken: string): Promise<void>;
}

export interface StagedEmailAttachment { bindingKey: string; leaseToken: string; targetType: 'document' | 'image'; targetKey: string; collectionKey?: string; membershipKey: string; storageKey?: string }
export interface StagedEmailAttachments { refs: EmailAttachmentRef[]; staged: StagedEmailAttachment[]; availability?: 'none' | 'complete' | 'truncated' | 'failed'; unavailableCount?: number }

export function createEmailAttachmentRepository(database = db): EmailAttachmentRepository {
  const authorize = `LET member = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET scopeMember = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == @scopeKey && item.userOrganizationKey == @membershipKey && item.status == "active" LIMIT 1 RETURN item) FILTER member != null && member.status == "active" && member.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey FILTER member.orgRole IN ["owner", "admin"] || scopeMember != null`;
  return {
    async activeMembership(input) { const cursor = await database.query('LET scope = DOCUMENT(scopes, @scopeKey) FILTER scope != null && scope.organizationKey == @organizationKey FOR member IN userOrganizations FILTER member.organizationId == @organizationKey && member.status == "active" LET scopeMember = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == @scopeKey && item.userOrganizationKey == member._key && item.status == "active" LIMIT 1 RETURN item) FILTER member.orgRole IN ["owner", "admin"] || scopeMember != null SORT member._key == @preferredMembershipKey DESC, member._key ASC LIMIT 1 RETURN member._key', input); const key = await cursor.next() as string | undefined; if (!key) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'No active connector scope membership is available for attachment ingestion.', false); return key; },
    async completed(input, membershipKey) { const cursor = await database.query(`${authorize} LET attachment = DOCUMENT(@@attachments, @key) FILTER attachment == null || attachment.status == "completed" RETURN attachment`, { '@attachments': EMAIL_ATTACHMENTS_COLLECTION, ...input, membershipKey }); const raw = await cursor.next(); if (raw === undefined) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Active connector scope membership is required for attachment ingestion.', false); if (!raw) return null; const value = parse(raw); if (value.connectorKey !== input.connectorKey || value.providerMessageId !== input.providerMessageId || value.partPath !== input.partPath || value.kind !== input.targetType || value.mimeType !== input.sourceMimeType || value.filename !== input.sourceFilename || value.sizeBytes !== input.sourceSize) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'The Gmail attachment source identity resolved to different metadata.', false); return view(value); },
    async claim(input, membershipKey, leaseToken, now, leaseExpiresAt) { const existingCursor = await database.query(`${authorize} RETURN DOCUMENT(@@attachments, @key)`, { '@attachments': EMAIL_ATTACHMENTS_COLLECTION, ...input, membershipKey }); const existingRaw = await existingCursor.next(); if (existingRaw === undefined) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Active connector scope membership is required for attachment ingestion.', false); const existing = existingRaw ? parse(existingRaw) : null; if (existing && (existing.connectorKey !== input.connectorKey || existing.providerMessageId !== input.providerMessageId || existing.partPath !== input.partPath || existing.kind !== input.targetType || existing.contentHash !== input.contentHash)) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'The Gmail attachment source identity resolved to different bytes or metadata.', false); if (existing?.status === 'completed') return { status: 'replay', binding: view(existing) }; if (existing?.leaseExpiresAt && existing.leaseExpiresAt > now) throw new EmailAttachmentIngestionError('ATTACHMENT_BUSY', 'The Gmail attachment is already processing.', true); const value = emailAttachmentSchema.parse({ key: input.key, organizationKey: input.organizationKey, scopeKey: input.scopeKey, connectorKey: input.connectorKey, providerMessageId: input.providerMessageId, partPath: input.partPath, contentHash: input.contentHash, kind: input.targetType, filename: input.sourceFilename, mimeType: input.sourceMimeType, sizeBytes: input.sourceSize, status: 'processing', leaseToken, leaseExpiresAt, ...(existing?.storageKey ? { storageKey: existing.storageKey } : {}), createdAt: existing?.createdAt ?? now, updatedAt: now }); const cursor = await database.query('UPSERT { _key: @key } INSERT @value UPDATE (OLD.status == "processing" && OLD.leaseExpiresAt <= @now ? MERGE(@value, { createdAt: OLD.createdAt, storageKey: OLD.storageKey }) : {}) IN @@attachments OPTIONS { keepNull: false } RETURN NEW', { '@attachments': EMAIL_ATTACHMENTS_COLLECTION, key: input.key, value: toArangoDoc(value), now }); const claimed = parse(await cursor.next()); if (claimed.leaseToken !== leaseToken) throw new EmailAttachmentIngestionError('ATTACHMENT_BUSY', 'The Gmail attachment is already processing.', true); return { status: 'claimed', binding: view(claimed) }; },
    async persistStorage(bindingKey, leaseToken, storageKey, now) { const cursor = await database.query('FOR value IN @@attachments FILTER value._key == @key && value.status == "processing" && value.leaseToken == @token && value.leaseExpiresAt > @now UPDATE value WITH { storageKey: @storageKey, updatedAt: @now } IN @@attachments RETURN true', { '@attachments': EMAIL_ATTACHMENTS_COLLECTION, key: bindingKey, token: leaseToken, storageKey, now }); return await cursor.next() === true; },
    async renew(bindingKey, leaseToken, connectorLeaseToken, now, leaseExpiresAt) { const cursor = await database.query('LET value = DOCUMENT(@@attachments, @key) LET connector = value == null ? null : DOCUMENT(organizationConnectors, value.connectorKey) FILTER value != null && value.status == "processing" && value.leaseToken == @token && value.leaseExpiresAt > @now && connector != null && connector.syncLeaseToken == @connectorToken && connector.syncLeaseExpiresAt > @now UPDATE value WITH { leaseExpiresAt: @leaseExpiresAt, updatedAt: @now } IN @@attachments RETURN true', { '@attachments': EMAIL_ATTACHMENTS_COLLECTION, key: bindingKey, token: leaseToken, connectorToken: connectorLeaseToken, now, leaseExpiresAt }); return await cursor.next() === true; },
    async complete(bindingKey, leaseToken, targetType, targetKey, _collectionKey, _membershipKey, now) { if (bindingKey !== targetKey) return false; const cursor = await database.query('FOR value IN @@attachments FILTER value._key == @key && value.kind == @kind && value.status == "processing" && value.leaseToken == @token && value.leaseExpiresAt > @now && IS_STRING(value.storageKey) UPDATE value WITH { status: "completed", leaseToken: null, leaseExpiresAt: null, updatedAt: @now } IN @@attachments OPTIONS { keepNull: false } RETURN true', { '@attachments': EMAIL_ATTACHMENTS_COLLECTION, key: bindingKey, kind: targetType, token: leaseToken, now }); return await cursor.next() === true; },
    async compensateTarget(bindingKey, leaseToken, _targetType, targetKey, scopeKey) { if (bindingKey !== targetKey) return; await database.query('FOR value IN @@attachments FILTER value._key == @key && value.scopeKey == @scopeKey && value.status == "processing" && value.leaseToken == @token REMOVE value IN @@attachments', { '@attachments': EMAIL_ATTACHMENTS_COLLECTION, key: bindingKey, scopeKey, token: leaseToken }); },
    async release(bindingKey, leaseToken) { await database.query('FOR value IN @@attachments FILTER value._key == @key && value.status == "processing" && value.leaseToken == @token REMOVE value IN @@attachments', { '@attachments': EMAIL_ATTACHMENTS_COLLECTION, key: bindingKey, token: leaseToken }); },
  };
}

export interface EmailAttachmentIngestionDependencies {
  repository?: EmailAttachmentRepository;
  storage?: DocumentObjectStorage;
  parse?: typeof parseDocument;
  processImage?: typeof processImage;
  sanitizeImage?: typeof sanitizeGalleryImage;
  documentDependencies?: DocumentParseDependencies;
  imageDependencies?: ImageProcessingDependencies;
  exportDatabase?: Pick<typeof db, 'query'>;
  now?: () => Date;
  publishScopeEvent?: (scopeKey: string, event: 'content.changed' | 'image.changed') => Promise<unknown>;
  publishCollectionEvent?: (collectionKey: string, event: 'collection.content.changed' | 'collection.index.changed') => Promise<unknown>;
}

async function ensureExportContainers(database: Pick<typeof db, 'query'>, scopeKey: string, connectorKey: string, membershipKey: string, now: string) {
  const { rootKey, inboxKey, collectionKey } = emailExportContainerKeys(scopeKey, connectorKey);
  const embedding = zeroEmbedding();
  await database.query(`LET inboxName = FIRST(FOR inbox IN emailInboxes FILTER inbox.scopeKey == @scopeKey && inbox.connectorKey == @connectorKey LIMIT 1 RETURN inbox.name) FILTER inboxName != null UPSERT { _key: @rootKey } INSERT { _key: @rootKey, scopeKey: @scopeKey, name: "Signal", presentation: "communication", mutationPolicy: "user", embedding: @embedding, isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE { presentation: "communication" } IN folders UPSERT { _key: @inboxKey } INSERT { _key: @inboxKey, scopeKey: @scopeKey, parentFolderKey: @rootKey, name: inboxName, mutationPolicy: "user", embedding: @embedding, isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE { presentation: null } IN folders OPTIONS { keepNull: false } UPSERT { _key: @collectionKey } INSERT { _key: @collectionKey, scopeKey: @scopeKey, name: "Signal", presentation: "communication", mutationPolicy: "user", embedding: @embedding, isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE { presentation: "communication" } IN collections UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @membershipKey } INSERT { _key: @memberKey, scopeKey: @scopeKey, collectionKey: @collectionKey, memberKey: @membershipKey, role: "owner", createdAt: @now, updatedAt: @now } UPDATE {} IN collectionMembers`, { rootKey, inboxKey, collectionKey, memberKey: stableKey('email-gallery-export-member', scopeKey, membershipKey), membershipKey, scopeKey, connectorKey, embedding, now });
  return { inboxKey, collectionKey };
}

export function createEmailAttachmentIngestionService(dependencies: EmailAttachmentIngestionDependencies = {}) {
  const repository = dependencies.repository ?? createEmailAttachmentRepository();
  const storage = dependencies.storage ?? dependencies.documentDependencies?.storage ?? dependencies.imageDependencies?.storage ?? documentStorage;
  const exportDatabase = dependencies.exportDatabase ?? db;
  const now = dependencies.now ?? (() => new Date());
  const bestEffortExport = async (input: { scopeKey: string; connectorKey: string; membershipKey: string; billingUserKey?: string; bindingKey: string; part: GmailAttachmentPart; bytes: Uint8Array }) => {
    try {
      const containers = await ensureExportContainers(exportDatabase, input.scopeKey, input.connectorKey, input.membershipKey, now().toISOString());
      if (input.part.type === 'document') {
        const exportKey = stableKey('email-archive-export', input.bindingKey);
        const exportStorage = input.billingUserKey ? { ...storage, upload: (value: Parameters<DocumentObjectStorage['upload']>[0]) => storage.upload({ ...value, billingUserKey: input.billingUserKey }) } : storage;
        await (dependencies.parse ?? parseDocument)({ file: { filename: input.part.filename, mimeType: input.part.mimeType, sizeBytes: input.bytes.byteLength, bytes: input.bytes }, scopeKey: input.scopeKey, folderKey: containers.inboxKey, idempotencyKey: `export:${input.bindingKey}` }, { ...dependencies.documentDependencies, storage: exportStorage, insert: async (document: Document) => { const value = documentSchema.parse({ ...document, key: exportKey, mutationPolicy: 'user', managedPurpose: undefined, managedOwnerKey: undefined }); const cursor = await exportDatabase.query('UPSERT { _key: @key } INSERT @value UPDATE {} IN documents RETURN NEW', { key: exportKey, value: toArangoDoc(value) }); return documentSchema.parse(withArangoKey(await cursor.next())); } });
      } else {
        const sanitized = await (dependencies.sanitizeImage ?? sanitizeGalleryImage)(input.bytes);
        const exportKey = stableKey('email-gallery-export', input.bindingKey);
        await (dependencies.processImage ?? processImage)({ scopeKey: input.scopeKey, ownerKey: input.membershipKey, ...(input.billingUserKey ? { billingUserKey: input.billingUserKey } : {}), origin: 'uploaded', imageKey: exportKey, idempotencyKey: `export:${input.bindingKey}`, file: { filename: `${safeSegment(input.part.filename.replace(/\.[^.]+$/, ''))}.png`, mimeType: 'image/png', sizeBytes: sanitized.bytes.byteLength, bytes: sanitized.bytes }, mutationPolicy: 'user' }, { ...dependencies.imageDependencies, persistImage: async ({ image, caption }) => {
          const bindVars = { imageKey: exportKey, image: toArangoDoc(imageSchema.parse({ ...image, key: exportKey, mutationPolicy: 'user' })), scopeKey: input.scopeKey, collectionKey: containers.collectionKey, relationKey: stableKey('email-gallery-export-relation', input.bindingKey), membershipKey: input.membershipKey, now: now().toISOString() };
          const cursor = caption
            ? await exportDatabase.query('UPSERT { _key: @captionKey } INSERT @caption UPDATE {} IN imageCaptions LET stored = FIRST(UPSERT { _key: @imageKey } INSERT @image UPDATE {} IN images RETURN NEW) UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @imageKey } INSERT { _key: @relationKey, scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @imageKey, addedByKey: @membershipKey, createdAt: @now } UPDATE {} IN collectionImages RETURN stored', { ...bindVars, captionKey: caption.key, caption: toArangoDoc(caption) })
            : await exportDatabase.query('LET stored = FIRST(UPSERT { _key: @imageKey } INSERT @image UPDATE {} IN images RETURN NEW) UPSERT { scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @imageKey } INSERT { _key: @relationKey, scopeKey: @scopeKey, collectionKey: @collectionKey, imageKey: @imageKey, addedByKey: @membershipKey, createdAt: @now } UPDATE {} IN collectionImages RETURN stored', bindVars);
          return imageSchema.parse(withArangoKey(await cursor.next()));
        } });
      }
    } catch { /* Exports are independent convenience copies. */ }
  };
  const compensate = async (staged: StagedEmailAttachment[], scopeKey: string) => { const failures: unknown[] = []; for (const item of [...staged].reverse()) try { await repository.compensateTarget(item.bindingKey, item.leaseToken, item.targetType, item.targetKey, scopeKey, now().toISOString()); if (item.storageKey) await storage.delete(item.storageKey); await repository.release(item.bindingKey, item.leaseToken); } catch (caught) { failures.push(caught); } if (failures.length) throw new AggregateError(failures, 'One or more staged email attachments could not be compensated'); };
  const ingest = async (input: { organizationKey: string; scopeKey: string; membershipKey: string; billingUserKey?: string; connectorKey: string; providerMessageId: string; part: GmailAttachmentPart; bytes: Uint8Array; connectorLeaseToken?: string; heartbeat?: () => Promise<void>; deferCompletion?: boolean }): Promise<any> => {
    const contentHash = createHash('sha256').update(input.bytes).digest('hex'), bindingKey = stableKey('email-attachment-binding', input.scopeKey, input.connectorKey, input.providerMessageId, input.part.path), leaseToken = randomUUID(), timestamp = now().toISOString();
    const claim = await repository.claim({ key: bindingKey, organizationKey: input.organizationKey, scopeKey: input.scopeKey, connectorKey: input.connectorKey, providerMessageId: input.providerMessageId, partPath: input.part.path, contentHash, sourceMimeType: input.part.mimeType, sourceFilename: input.part.filename, sourceSize: input.part.size, targetType: input.part.type, targetKey: bindingKey }, input.membershipKey, leaseToken, timestamp, new Date(now().getTime() + PROCESSING_LEASE_MS).toISOString());
    if (claim.status === 'replay') {
      await bestEffortExport({ ...input, bindingKey });
      return input.deferCompletion ? { ref: { type: claim.binding.targetType, key: bindingKey } } : { type: claim.binding.targetType, key: bindingKey };
    }
    let storageKey = claim.binding.storageKey;
    try {
      if (!storageKey) storageKey = (await storage.upload({ key: `email/${input.scopeKey}/${input.connectorKey}/${bindingKey}/${contentHash}/${safeSegment(input.part.filename)}`, bytes: input.bytes, mimeType: input.part.mimeType, ...(input.billingUserKey ? { billingUserKey: input.billingUserKey } : {}) })).storageKey;
      if (!await repository.persistStorage(bindingKey, leaseToken, storageKey, now().toISOString())) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Attachment ingestion lost its lease before canonical persistence.', true);
      await input.heartbeat?.();
      if (input.connectorLeaseToken && !await repository.renew(bindingKey, leaseToken, input.connectorLeaseToken, now().toISOString(), new Date(now().getTime() + PROCESSING_LEASE_MS).toISOString())) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Attachment ingestion lost its connector lease fence.', true);
      await bestEffortExport({ ...input, bindingKey });
      const staged = { bindingKey, leaseToken, targetType: input.part.type, targetKey: bindingKey, membershipKey: input.membershipKey, storageKey };
      if (input.deferCompletion) return { ref: { type: input.part.type, key: bindingKey }, staged };
      if (!await repository.complete(bindingKey, leaseToken, input.part.type, bindingKey, undefined, input.membershipKey, now().toISOString())) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Attachment ingestion lost its lease before completion.', true);
      return { type: input.part.type, key: bindingKey };
    } catch (caught) { await repository.compensateTarget(bindingKey, leaseToken, input.part.type, bindingKey, input.scopeKey, now().toISOString()).catch(() => undefined); if (storageKey) await storage.delete(storageKey).catch(() => undefined); await repository.release(bindingKey, leaseToken).catch(() => undefined); throw caught; }
  };
  return {
    ingest,
    async ingestMessage(input: { organizationKey: string; scopeKey: string; membershipKey: string; billingUserKey?: string; connectorKey: string; gmail: GmailClient; message: GmailMessageResource }) { const refs: EmailAttachmentRef[] = [], parts = gmailAttachmentParts(input.message.payload); if (!parts.length) return refs; const membershipKey = await repository.activeMembership({ organizationKey: input.organizationKey, scopeKey: input.scopeKey, preferredMembershipKey: input.membershipKey }); for (const part of parts) { const key = stableKey('email-attachment-binding', input.scopeKey, input.connectorKey, input.message.id, part.path), completed = await repository.completed({ key, organizationKey: input.organizationKey, scopeKey: input.scopeKey, connectorKey: input.connectorKey, providerMessageId: input.message.id, partPath: part.path, sourceMimeType: part.mimeType, sourceFilename: part.filename, sourceSize: part.size, targetType: part.type }, membershipKey); if (completed) refs.push({ type: completed.targetType, key }); else try { refs.push(await ingest({ ...input, membershipKey, providerMessageId: input.message.id, part, bytes: await input.gmail.attachment(input.message.id, part) })); } catch (caught) { if (!(caught instanceof GmailPermanentAttachmentError)) throw caught; } } return refs; },
    async stageMessage(input: { organizationKey: string; scopeKey: string; membershipKey: string; billingUserKey?: string; connectorKey: string; connectorLeaseToken: string; heartbeat: () => Promise<void>; gmail: GmailClient; message: GmailMessageResource }): Promise<StagedEmailAttachments> { const discovery = discoverGmailAttachmentParts(input.message.payload), hasAttachments = messageBodies(input.message.payload).hasAttachments, result: StagedEmailAttachments = { refs: [], staged: [], availability: hasAttachments ? discovery.truncated ? 'truncated' : 'complete' : 'none', ...(discovery.unavailableCount ? { unavailableCount: discovery.unavailableCount } : {}) }; if (!discovery.parts.length) return result; const membershipKey = await repository.activeMembership({ organizationKey: input.organizationKey, scopeKey: input.scopeKey, preferredMembershipKey: input.membershipKey }); try { for (const part of discovery.parts) { const value = await ingest({ ...input, membershipKey, providerMessageId: input.message.id, part, bytes: await input.gmail.attachment(input.message.id, part), deferCompletion: true }); result.refs.push(value.ref); if (value.staged) result.staged.push(value.staged); } return result; } catch (caught) { await compensate(result.staged, input.scopeKey); throw caught; } },
    renew: async (staged: StagedEmailAttachment[], connectorLeaseToken: string) => { for (const item of staged) if (!await repository.renew(item.bindingKey, item.leaseToken, connectorLeaseToken, now().toISOString(), new Date(now().getTime() + PROCESSING_LEASE_MS).toISOString())) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Attachment processing lease was lost before mail persistence.', true); },
    compensate,
  };
}

export type EmailAttachmentIngestionService = ReturnType<typeof createEmailAttachmentIngestionService>;
