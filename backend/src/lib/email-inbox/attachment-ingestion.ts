import { createHash, randomUUID } from 'node:crypto';
import { db, withDatabaseTransaction } from '@/lib/db/client';
import { toArangoDoc, withArangoKey } from '@/lib/db/base';
import { DocumentInputError, documentKeyForRequest, parseDocument, type DocumentParseDependencies } from '@/lib/ai/document-processing';
import { insertPreparedDocument, documentSchema, type Document } from '@/lib/db/documents.node';
import { processImage, type ImageProcessingDependencies } from '@/lib/ai/image-processing';
import { GalleryImageInputError, sanitizeGalleryImage } from '@/lib/gallery/image-location';
import { insertPreparedImageWithCaption } from '@/lib/db/images.node';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { discoverGmailAttachmentParts, GmailPermanentAttachmentError, gmailAttachmentParts, messageBodies, type GmailAttachmentPart, type GmailClient, type GmailMessageResource } from './gmail';
import { EMAIL_ATTACHMENT_BINDINGS_COLLECTION, emailAttachmentBindingSchema, type EmailAttachmentBinding } from './attachment-binding-schema';
import type { EmailAttachmentRef } from './archive-payloads';
import { ensureMailFolders } from './folders';

const PROCESSING_LEASE_MS = 30 * 60_000;
const PROCESSING_HEARTBEAT_MS = 5 * 60_000;
const zeroEmbedding = () => Array(EMBEDDING_DIMENSIONS).fill(0);
const stableKey = (kind: string, ...values: string[]) => `c${createHash('sha256').update([kind, ...values].join('\0')).digest('hex').slice(0, 24)}`;
export const emailMediaCollectionKey = (scopeKey: string) => stableKey('email-media-collection', scopeKey);

export class EmailAttachmentIngestionError extends Error {
  constructor(readonly code: 'ATTACHMENT_CONFLICT' | 'ATTACHMENT_BUSY' | 'ATTACHMENT_ACCESS_REVOKED' | 'ATTACHMENT_PERSIST_FAILED', message: string, readonly retryable: boolean) { super(message); }
}

interface AttachmentClaim {
  status: 'claimed'; binding: EmailAttachmentBinding;
}
interface AttachmentReplay {
  status: 'replay'; binding: EmailAttachmentBinding;
}

export interface EmailAttachmentRepository {
  activeMembership(input: { organizationKey: string; scopeKey: string; preferredMembershipKey: string }): Promise<string>;
  completed(input: { key: string; organizationKey: string; scopeKey: string; connectorKey: string; providerMessageId: string; partPath: string; targetType: 'document' | 'image'; sourceMimeType: string; sourceFilename: string; sourceSize: number }, membershipKey: string): Promise<EmailAttachmentBinding | null>;
  claim(input: Omit<EmailAttachmentBinding, 'status' | 'leaseToken' | 'leaseExpiresAt' | 'createdAt' | 'updatedAt'>, membershipKey: string, leaseToken: string, now: string, leaseExpiresAt: string): Promise<AttachmentClaim | AttachmentReplay>;
  renew?(bindingKey: string, leaseToken: string, connectorLeaseToken: string, now: string, leaseExpiresAt: string): Promise<boolean>;
  ensureDocumentFolder(scopeKey: string, now: string): Promise<string>;
  ensureImageCollection(scopeKey: string, now: string): Promise<string>;
  documentTarget(input: { bindingKey: string; leaseToken: string; targetKey: string; scopeKey: string; folderKey: string; membershipKey: string; now: string }): Promise<Document | null>;
  recoverDocumentTarget(input: { bindingKey: string; leaseToken: string; targetKey: string; scopeKey: string; folderKey: string; membershipKey: string; now: string }): Promise<Document | null>;
  complete(bindingKey: string, leaseToken: string, targetType: 'document' | 'image', targetKey: string, collectionKey: string | undefined, membershipKey: string, now: string): Promise<boolean>;
  compensateTarget(bindingKey: string, leaseToken: string, targetType: 'document' | 'image', targetKey: string, scopeKey: string, now: string): Promise<void>;
  release(bindingKey: string, leaseToken: string): Promise<void>;
}

export interface StagedEmailAttachment {
  bindingKey: string;
  leaseToken: string;
  targetType: 'document' | 'image';
  targetKey: string;
  collectionKey?: string;
  membershipKey: string;
}

export interface StagedEmailAttachments {
  refs: EmailAttachmentRef[];
  staged: StagedEmailAttachment[];
  availability?: 'none' | 'complete' | 'truncated' | 'failed';
  unavailableCount?: number;
}

export function createEmailAttachmentRepository(database = db): EmailAttachmentRepository {
  return {
    async activeMembership(input) {
      const cursor = await database.query('LET scope = DOCUMENT(scopes, @scopeKey) FILTER scope != null && scope.organizationKey == @organizationKey FOR member IN userOrganizations FILTER member.organizationId == @organizationKey && member.status == "active" LET scopeMember = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == @scopeKey && item.userOrganizationKey == member._key && item.status == "active" LIMIT 1 RETURN item) FILTER member.orgRole IN ["owner", "admin"] || scopeMember != null SORT member._key == @preferredMembershipKey DESC, member.orgRole IN ["owner", "admin"] DESC, member._key ASC LIMIT 1 RETURN member._key', input);
      const membershipKey = await cursor.next() as string | undefined;
      if (!membershipKey) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'No active connector scope membership is available for attachment ingestion.', false);
      return membershipKey;
    },
    async completed(input, membershipKey) {
      const cursor = await database.query(`LET member = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET scopeMember = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == @scopeKey && item.userOrganizationKey == @membershipKey && item.status == "active" LIMIT 1 RETURN item) FILTER member != null && member.status == "active" && member.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey FILTER member.orgRole IN ["owner", "admin"] || scopeMember != null LET binding = DOCUMENT(@@bindings, @key) FILTER binding == null || binding.status == "completed" RETURN binding`, { '@bindings': EMAIL_ATTACHMENT_BINDINGS_COLLECTION, membershipKey, scopeKey: input.scopeKey, organizationKey: input.organizationKey, key: input.key });
      const raw = await cursor.next() as Record<string, unknown> | null | undefined;
      if (raw === undefined) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Active connector scope membership is required for attachment ingestion.', false);
      if (!raw) return null;
      const binding = emailAttachmentBindingSchema.parse(withArangoKey(raw));
      if (binding.connectorKey !== input.connectorKey || binding.providerMessageId !== input.providerMessageId || binding.partPath !== input.partPath || binding.targetType !== input.targetType || binding.sourceMimeType !== input.sourceMimeType || binding.sourceFilename !== input.sourceFilename || binding.sourceSize !== input.sourceSize) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'The Gmail attachment source identity resolved to different metadata.', false);
      return binding;
    },
    async claim(input, membershipKey, leaseToken, now, leaseExpiresAt) {
      const existingCursor = await database.query(`LET member = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET scopeMember = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == @scopeKey && item.userOrganizationKey == @membershipKey && item.status == "active" LIMIT 1 RETURN item) FILTER member != null && member.status == "active" && member.organizationId == @organizationKey && scope != null && scope.organizationKey == @organizationKey FILTER member.orgRole IN ["owner", "admin"] || scopeMember != null LET existing = DOCUMENT(@@bindings, @key) RETURN existing`, { '@bindings': EMAIL_ATTACHMENT_BINDINGS_COLLECTION, membershipKey, scopeKey: input.scopeKey, organizationKey: input.organizationKey, key: input.key });
      const existingRaw = await existingCursor.next() as Record<string, unknown> | null | undefined;
      if (existingRaw === undefined) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Active connector scope membership is required for attachment ingestion.', false);
      if (existingRaw) {
        const existing = emailAttachmentBindingSchema.parse(withArangoKey(existingRaw));
        if (existing.connectorKey !== input.connectorKey || existing.providerMessageId !== input.providerMessageId || existing.partPath !== input.partPath || existing.targetType !== input.targetType || existing.contentHash !== input.contentHash || existing.sourceMimeType !== input.sourceMimeType || existing.sourceFilename !== input.sourceFilename || existing.sourceSize !== input.sourceSize) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'The Gmail attachment source identity resolved to different bytes or metadata.', false);
        if (existing.status === 'completed') return { status: 'replay', binding: existing };
        if (existing.leaseExpiresAt && existing.leaseExpiresAt > now) throw new EmailAttachmentIngestionError('ATTACHMENT_BUSY', 'The Gmail attachment is already processing.', true);
      }
      const value = emailAttachmentBindingSchema.parse({ ...input, status: 'processing', leaseToken, leaseExpiresAt, createdAt: existingRaw && typeof existingRaw.createdAt === 'string' ? existingRaw.createdAt : now, updatedAt: now });
      let result: { binding: Record<string, unknown>; claimed: boolean };
      try {
        const cursor = await database.query('UPSERT { _key: @key } INSERT @binding UPDATE (OLD.status == "processing" && OLD.leaseExpiresAt <= @now ? MERGE(@binding, { createdAt: OLD.createdAt }) : {}) IN @@bindings RETURN { binding: NEW, claimed: NEW.status == "processing" && NEW.leaseToken == @leaseToken }', { '@bindings': EMAIL_ATTACHMENT_BINDINGS_COLLECTION, key: value.key, binding: toArangoDoc(value), leaseToken, now });
        result = await cursor.next() as { binding: Record<string, unknown>; claimed: boolean };
      } catch (error) {
        const writeConflict = error && typeof error === 'object' && (('errorNum' in error && error.errorNum === 1200) || ('code' in error && error.code === 409));
        if (!writeConflict) throw error;
        const cursor = await database.query('RETURN DOCUMENT(@@bindings, @key)', { '@bindings': EMAIL_ATTACHMENT_BINDINGS_COLLECTION, key: value.key });
        const winnerRaw = await cursor.next() as Record<string, unknown> | null;
        if (!winnerRaw) throw error;
        result = { binding: winnerRaw, claimed: false };
      }
      const binding = emailAttachmentBindingSchema.parse(withArangoKey(result.binding));
      if (!result.claimed) {
        if (binding.connectorKey !== input.connectorKey || binding.providerMessageId !== input.providerMessageId || binding.partPath !== input.partPath || binding.targetType !== input.targetType || binding.contentHash !== input.contentHash || binding.sourceMimeType !== input.sourceMimeType || binding.sourceFilename !== input.sourceFilename || binding.sourceSize !== input.sourceSize) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'The Gmail attachment source identity resolved to different bytes or metadata.', false);
        if (binding.status === 'completed') return { status: 'replay', binding };
        throw new EmailAttachmentIngestionError('ATTACHMENT_BUSY', 'The Gmail attachment is already processing.', true);
      }
      return { status: 'claimed', binding };
    },
    async renew(bindingKey, leaseToken, connectorLeaseToken, now, leaseExpiresAt) {
      const cursor = await database.query(`LET binding = DOCUMENT(@@bindings, @bindingKey) LET connector = binding == null ? null : DOCUMENT(organizationConnectors, binding.connectorKey) FILTER binding != null && binding.status == "processing" && binding.leaseToken == @leaseToken && binding.leaseExpiresAt > @now FILTER connector != null && connector.status != "revoked" && connector.syncEnabled != false && connector.syncLeaseToken == @connectorLeaseToken && connector.syncLeaseExpiresAt > @now UPDATE binding WITH { leaseExpiresAt: @leaseExpiresAt, updatedAt: @now } IN @@bindings RETURN true`, { '@bindings': EMAIL_ATTACHMENT_BINDINGS_COLLECTION, bindingKey, leaseToken, connectorLeaseToken, now, leaseExpiresAt });
      return await cursor.next() === true;
    },
    async ensureDocumentFolder(scopeKey, now) {
      const rootKey = (await ensureMailFolders(database, scopeKey, now)).root;
      const key = stableKey('mail-attachment-folder', scopeKey);
      const cursor = await database.query(`LET root = DOCUMENT(folders, @rootKey) FILTER root != null && root.scopeKey == @scopeKey && root.purpose == "communication-mail-root" LET folder = FIRST(UPSERT { _key: @key } INSERT { _key: @key, scopeKey: @scopeKey, parentFolderKey: @rootKey, name: "Attachments", description: "Attachments synchronized from email", managedPurpose: "mail-attachment", managedOwnerKey: @rootKey, mutationPolicy: "system-container", embedding: @embedding, isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE {} IN folders RETURN NEW) FILTER folder.scopeKey == @scopeKey && folder.parentFolderKey == @rootKey && folder.managedPurpose == "mail-attachment" && folder.managedOwnerKey == @rootKey && folder.mutationPolicy == "system-container" RETURN folder._key`, { rootKey, key, scopeKey, now, embedding: zeroEmbedding() });
      const result = await cursor.next() as string | undefined;
      if (!result) throw new EmailAttachmentIngestionError('ATTACHMENT_PERSIST_FAILED', 'The managed email attachment folder could not be created.', true);
      return result;
    },
    async ensureImageCollection(scopeKey, now) {
      const key = emailMediaCollectionKey(scopeKey);
      const cursor = await database.query('LET collection = FIRST(UPSERT { _key: @key } INSERT { _key: @key, scopeKey: @scopeKey, name: "Signal", description: "Images synchronized from email", purpose: "email-media", mutationPolicy: "system-only", embedding: @embedding, isFavorite: false, createdAt: @now, updatedAt: @now } UPDATE {} IN collections RETURN NEW) FILTER collection.scopeKey == @scopeKey && collection.purpose == "email-media" && collection.mutationPolicy == "system-only" RETURN collection._key', { key, scopeKey, now, embedding: zeroEmbedding() });
      const result = await cursor.next() as string | undefined;
      if (!result) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'The deterministic email media collection belongs to another managed source.', false);
      return result;
    },
    async documentTarget(input) {
      const cursor = await database.query(`LET binding = DOCUMENT(@@bindings, @bindingKey) LET owned = binding != null && binding.status == "processing" && binding.leaseToken == @leaseToken && binding.leaseExpiresAt > @now LET member = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET scopeMember = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == @scopeKey && item.userOrganizationKey == @membershipKey && item.status == "active" LIMIT 1 RETURN item) LET authorized = owned && member != null && member.status == "active" && scope != null && member.organizationId == binding.organizationKey && scope.organizationKey == binding.organizationKey && (member.orgRole IN ["owner", "admin"] || scopeMember != null) LET target = DOCUMENT(documents, @targetKey) LET safe = target == null || (target.scopeKey == @scopeKey && target.folderKey == @folderKey && target.managedPurpose == "mail-attachment" && target.managedOwnerKey == @bindingKey) RETURN { owned, authorized, target, safe }`, { '@bindings': EMAIL_ATTACHMENT_BINDINGS_COLLECTION, ...input });
      const result = await cursor.next() as { owned: boolean; authorized: boolean; target: Record<string, unknown> | null; safe: boolean };
      if (!result.owned || !result.authorized) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Attachment ingestion lost its membership or lease fence before target lookup.', true);
      if (!result.safe) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'The deterministic attachment target belongs to another managed source.', false);
      return result.target ? documentSchema.parse(withArangoKey(result.target)) : null;
    },
    async recoverDocumentTarget(input) {
      const cursor = await database.query(`LET binding = DOCUMENT(@@bindings, @bindingKey) LET owned = binding != null && binding.status == "processing" && binding.leaseToken == @leaseToken && binding.leaseExpiresAt > @now LET member = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, @scopeKey) LET scopeMember = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == @scopeKey && item.userOrganizationKey == @membershipKey && item.status == "active" LIMIT 1 RETURN item) LET authorized = member != null && member.status == "active" && scope != null && member.organizationId == binding.organizationKey && scope.organizationKey == binding.organizationKey && (member.orgRole IN ["owner", "admin"] || scopeMember != null) LET target = DOCUMENT(documents, @targetKey) LET safe = target != null && target.scopeKey == @scopeKey && target.folderKey == @folderKey && target.managedPurpose == "mail-attachment" && target.managedOwnerKey == @bindingKey RETURN { owned, authorized, targetFound: target != null, safe, target }`, { '@bindings': EMAIL_ATTACHMENT_BINDINGS_COLLECTION, ...input });
      const result = await cursor.next() as { owned: boolean; authorized: boolean; targetFound: boolean; safe: boolean; target: Record<string, unknown> | null };
      if (!result.owned || !result.authorized) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Attachment ingestion lost its membership or lease fence before recovery.', true);
      if (result.targetFound && !result.safe) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'The deterministic attachment target belongs to another managed source.', false);
      return result.safe && result.target ? documentSchema.parse(withArangoKey(result.target)) : null;
    },
    async complete(bindingKey, leaseToken, targetType, targetKey, collectionKey, membershipKey, now) {
      const cursor = await database.query(`LET binding = DOCUMENT(@@bindings, @bindingKey) FILTER binding != null && binding.status == "processing" && binding.leaseToken == @leaseToken && binding.leaseExpiresAt > @now FILTER binding.targetType == @targetType && binding.targetKey == @targetKey LET member = DOCUMENT(userOrganizations, @membershipKey) LET scope = DOCUMENT(scopes, binding.scopeKey) LET scopeMember = FIRST(FOR item IN scopeMembers FILTER item.scopeKey == binding.scopeKey && item.userOrganizationKey == @membershipKey && item.status == "active" LIMIT 1 RETURN item) FILTER member != null && member.status == "active" && scope != null && member.organizationId == binding.organizationKey && scope.organizationKey == binding.organizationKey FILTER member.orgRole IN ["owner", "admin"] || scopeMember != null LET target = @targetType == "document" ? DOCUMENT(documents, @targetKey) : DOCUMENT(images, @targetKey) LET collection = @targetType == "image" ? DOCUMENT(collections, @collectionKey) : null FILTER target != null && target.scopeKey == binding.scopeKey && ((@targetType == "document" && @collectionKey == null && target.managedPurpose == "mail-attachment" && target.managedOwnerKey == @bindingKey) || (@targetType == "image" && @targetKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "email-attachment-target", @bindingKey)), 24)) && target.mutationPolicy == "system-only" && target.createdByKey == @membershipKey && collection != null && collection.scopeKey == binding.scopeKey && collection.purpose == "email-media" && collection.mutationPolicy == "system-only")) LET relation = @targetType == "image" ? FIRST(UPSERT { scopeKey: binding.scopeKey, collectionKey: @collectionKey, imageKey: @targetKey } INSERT { _key: @relationKey, scopeKey: binding.scopeKey, collectionKey: @collectionKey, imageKey: @targetKey, addedByKey: @membershipKey, createdAt: @now } UPDATE {} IN collectionImages RETURN NEW) : null UPDATE binding WITH { status: "completed", leaseToken: null, leaseExpiresAt: null, updatedAt: @now } IN @@bindings OPTIONS { keepNull: false } RETURN true`, { '@bindings': EMAIL_ATTACHMENT_BINDINGS_COLLECTION, bindingKey, leaseToken, targetType, targetKey, collectionKey: collectionKey ?? null, relationKey: stableKey('email-media-relation', bindingKey), membershipKey, now });
      return await cursor.next() === true;
    },
    async compensateTarget(bindingKey, leaseToken, targetType, targetKey, scopeKey, now) {
      if (targetType === 'document') {
        await database.query(`LET binding = DOCUMENT(@@bindings, @bindingKey) LET scope = DOCUMENT(scopes, @scopeKey) FILTER (binding != null && binding.status == "processing" && binding.leaseToken == @leaseToken) || (binding == null && scope == null) LET target = DOCUMENT(documents, @targetKey) FILTER target != null && target.scopeKey == @scopeKey && target.managedPurpose == "mail-attachment" && target.managedOwnerKey == @bindingKey LET summaryKeys = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey == @targetKey RETURN summary._key) LET storageKeys = UNIQUE(FLATTEN(UNION(IS_STRING(target.storageKey) ? [target.storageKey] : [], IS_ARRAY(target.sourceStorageKeys) ? target.sourceStorageKeys : [], IS_ARRAY(target.speechStorageKeys) ? target.speechStorageKeys : [], (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey == @targetKey && IS_STRING(version.storageKey) RETURN version.storageKey), (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey == @targetKey && IS_STRING(audio.storageKey) RETURN audio.storageKey), (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && (audio.documentKey == @targetKey || audio.summaryKey IN summaryKeys) && IS_STRING(audio.storageKey) RETURN audio.storageKey)), 2)) LET jobs = (FOR storageKey IN storageKeys UPSERT { storageKey } INSERT { storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs RETURN 1) LET removedSummaryAudio = (FOR audio IN documentSummaryAudio FILTER audio.scopeKey == @scopeKey && (audio.documentKey == @targetKey || audio.summaryKey IN summaryKeys) REMOVE audio IN documentSummaryAudio RETURN 1) LET removedSummaries = (FOR summary IN documentSummaries FILTER summary.scopeKey == @scopeKey && summary.documentKey == @targetKey REMOVE summary IN documentSummaries RETURN 1) LET removedVersions = (FOR version IN documentVersions FILTER version.scopeKey == @scopeKey && version.documentKey == @targetKey REMOVE version IN documentVersions RETURN 1) LET removedAudioVersions = (FOR audio IN documentAudioVersions FILTER audio.scopeKey == @scopeKey && audio.documentKey == @targetKey REMOVE audio IN documentAudioVersions RETURN 1) REMOVE target IN documents`, { '@bindings': EMAIL_ATTACHMENT_BINDINGS_COLLECTION, bindingKey, leaseToken, targetKey, scopeKey, now });
        await database.query('FOR job IN storageDeletionJobs FILTER job.status != "deleting" LET storageKey = job.storageKey LET retained = LENGTH(FOR document IN documents FILTER document.storageKey == storageKey || (IS_ARRAY(document.sourceStorageKeys) && storageKey IN document.sourceStorageKeys) || (IS_ARRAY(document.speechStorageKeys) && storageKey IN document.speechStorageKeys) LIMIT 1 RETURN 1) + LENGTH(FOR image IN images FILTER image.storageKey == storageKey LIMIT 1 RETURN 1) + LENGTH(FOR version IN documentVersions FILTER version.storageKey == storageKey LIMIT 1 RETURN 1) + LENGTH(FOR audio IN documentAudioVersions FILTER audio.storageKey == storageKey LIMIT 1 RETURN 1) + LENGTH(FOR audio IN documentSummaryAudio FILTER audio.storageKey == storageKey LIMIT 1 RETURN 1) FILTER retained > 0 REMOVE job IN storageDeletionJobs', {});
        return;
      }
      if (targetType === 'image') {
        const compensate = async (executor: Pick<typeof db, 'query'>) => {
        const fence = 'LET binding = DOCUMENT(@@bindings, @bindingKey) LET scope = DOCUMENT(scopes, @scopeKey) FILTER (binding != null && binding.status == "processing" && binding.leaseToken == @leaseToken) || (binding == null && scope == null) FILTER @targetKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "email-attachment-target", @bindingKey)), 24))';
        const bindVars = { '@bindings': EMAIL_ATTACHMENT_BINDINGS_COLLECTION, bindingKey, leaseToken, targetKey, scopeKey };
        const targetCursor = await executor.query(`${fence} LET target = DOCUMENT(images, @targetKey) FILTER target != null && target.scopeKey == @scopeKey && target.mutationPolicy == "system-only" RETURN { storageKey: target.storageKey, captionKey: target.imageCaptionKey }`, bindVars);
        const target = await targetCursor.next() as { storageKey?: string; captionKey?: string } | undefined;
        if (!target) return;
        await executor.query(`${fence} LET target = DOCUMENT(images, @targetKey) FILTER target != null && target.scopeKey == @scopeKey && target.mutationPolicy == "system-only" LET cleanupRelations = (FOR relation IN collectionImages FILTER relation.imageKey == @targetKey REMOVE relation IN collectionImages RETURN 1) LET cleanupIdentities = (FOR relation IN imageIdentities FILTER relation.imageKey == @targetKey REMOVE relation IN imageIdentities RETURN 1) LET cleanupMemories = (FOR memory IN imageCollectionMemories FILTER memory.scopeKey == @scopeKey && memory.imageKey == @targetKey REMOVE memory IN imageCollectionMemories RETURN 1) LET cleanupHighlights = (FOR highlight IN imageCollecitionHightlights FILTER highlight.scopeKey == @scopeKey && @targetKey IN highlight.imageKeys UPDATE highlight WITH { imageKeys: REMOVE_VALUE(highlight.imageKeys, @targetKey), updatedAt: @now } IN imageCollecitionHightlights RETURN 1) LET cleanupPlaces = (FOR relation IN placeImages FILTER relation.scopeKey == @scopeKey && relation.imageKey == @targetKey REMOVE relation IN placeImages RETURN 1) LET cleanupCollections = (FOR collection IN collections FILTER collection.scopeKey == @scopeKey && collection.coverImageKey == @targetKey UPDATE collection WITH { coverImageKey: null, updatedAt: @now } IN collections OPTIONS { keepNull: false } RETURN 1) LET cleanupFolders = (FOR folder IN folders FILTER folder.scopeKey == @scopeKey && folder.coverImageKey == @targetKey UPDATE folder WITH { coverImageKey: null, updatedAt: @now } IN folders OPTIONS { keepNull: false } RETURN 1) LET cleanupTrips = (FOR trip IN trips FILTER trip.scopeKey == @scopeKey && trip.coverImageKey == @targetKey UPDATE trip WITH { coverImageKey: null, updatedAt: @now } IN trips OPTIONS { keepNull: false } RETURN 1) LET cleanupInboxes = (FOR inbox IN inboxes FILTER inbox.scopeKey == @scopeKey && inbox.coverImageKey == @targetKey UPDATE inbox WITH { coverImageKey: null, updatedAt: @now } IN inboxes OPTIONS { keepNull: false } RETURN 1) LET cleanupTags = (FOR assignment IN tagAssignments FILTER assignment.scopeKey == @scopeKey && assignment.sourceType == "image" && assignment.sourceKey == @targetKey REMOVE assignment IN tagAssignments RETURN 1) LET cleanupShares = (FOR share IN shares FILTER share.scopeKey == @scopeKey && share.sourceType == "image" && share.sourceKey == @targetKey REMOVE share IN shares RETURN 1) LET cleanupHiddens = (FOR hidden IN userHiddens FILTER hidden.source == "image" && hidden.sourceKey == @targetKey REMOVE hidden IN userHiddens RETURN 1) RETURN true`, { ...bindVars, now });
        await executor.query(`${fence} FOR document IN documents FILTER document.scopeKey == @scopeKey LET payload = document.mutationPolicy == "system-only" ? JSON_PARSE(document.content) : null LET hasRefs = payload != null && payload.kind IN ["mail-reply-draft", "mail-new-draft"] && IS_ARRAY(payload.data.attachments) && LENGTH(FOR ref IN payload.data.attachments FILTER ref.key == @targetKey RETURN 1) > 0 LET hasCover = document.coverImageKey == @targetKey FILTER hasRefs || hasCover LET data = hasRefs ? MERGE(payload.data, { attachments: (FOR ref IN payload.data.attachments FILTER ref.key != @targetKey RETURN ref) }) : null LET patch = MERGE(hasRefs ? { content: JSON_STRINGIFY(MERGE(payload, { data })) } : {}, hasCover ? { coverImageKey: null } : {}, { updatedAt: @now }) UPDATE document WITH patch IN documents OPTIONS { keepNull: false }`, { ...bindVars, now });
        if (target.storageKey) await executor.query(`${fence} UPSERT { storageKey: @storageKey } INSERT { storageKey: @storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs`, { ...bindVars, storageKey: target.storageKey, now });
        await executor.query(`${fence} LET target = DOCUMENT(images, @targetKey) FILTER target != null && target.scopeKey == @scopeKey && target.mutationPolicy == "system-only" REMOVE target IN images`, bindVars);
        if (target.captionKey) await executor.query(`${fence} FOR caption IN imageCaptions FILTER caption._key == @captionKey FILTER LENGTH(FOR retained IN images FILTER retained.imageCaptionKey == @captionKey LIMIT 1 RETURN 1) == 0 REMOVE caption IN imageCaptions`, { ...bindVars, captionKey: target.captionKey });
        await executor.query('FOR binding IN @@bindings FILTER binding._key == @bindingKey && binding.status == "processing" && binding.leaseToken == @leaseToken REMOVE binding IN @@bindings', bindVars);
        };
        if (typeof (database as Partial<typeof db>).beginTransaction === 'function') await withDatabaseTransaction(database as typeof db, { read: [], write: ['emailAttachmentBindings', 'images', 'imageCaptions', 'collectionImages', 'imageIdentities', 'imageCollectionMemories', 'imageCollecitionHightlights', 'placeImages', 'collections', 'folders', 'trips', 'inboxes', 'documents', 'tagAssignments', 'shares', 'userHiddens', 'storageDeletionJobs'] }, compensate);
        else await compensate(database);
        return;
      }
      await database.query(`LET binding = DOCUMENT(@@bindings, @bindingKey) FILTER binding != null && binding.status == "processing" && binding.leaseToken == @leaseToken LET target = @targetType == "document" ? DOCUMENT(documents, @targetKey) : DOCUMENT(images, @targetKey) FILTER target != null && target.scopeKey == @scopeKey && ((@targetType == "document" && target.managedPurpose == "mail-attachment" && target.managedOwnerKey == @bindingKey) || (@targetType == "image" && @targetKey == CONCAT("c", LEFT(SHA256(CONCAT_SEPARATOR("\\u0000", "email-attachment-target", @bindingKey)), 24)) && target.mutationPolicy == "system-only")) LET storageKey = target.storageKey LET captionKey = @targetType == "image" ? target.imageCaptionKey : null LET cleanupRelations = (FOR relation IN collectionImages FILTER @targetType == "image" && relation.imageKey == @targetKey REMOVE relation IN collectionImages RETURN 1) LET cleanupIdentities = (FOR relation IN imageIdentities FILTER @targetType == "image" && relation.imageKey == @targetKey REMOVE relation IN imageIdentities RETURN 1) LET cleanupMemories = (FOR memory IN imageCollectionMemories FILTER @targetType == "image" && memory.scopeKey == @scopeKey && memory.imageKey == @targetKey REMOVE memory IN imageCollectionMemories RETURN 1) LET cleanupHighlights = (FOR highlight IN imageCollecitionHightlights FILTER @targetType == "image" && highlight.scopeKey == @scopeKey && @targetKey IN highlight.imageKeys UPDATE highlight WITH { imageKeys: REMOVE_VALUE(highlight.imageKeys, @targetKey), updatedAt: @now } IN imageCollecitionHightlights RETURN 1) LET cleanupPlaces = (FOR relation IN placeImages FILTER @targetType == "image" && relation.scopeKey == @scopeKey && relation.imageKey == @targetKey REMOVE relation IN placeImages RETURN 1) LET cleanupCollections = (FOR collection IN collections FILTER @targetType == "image" && collection.scopeKey == @scopeKey && collection.coverImageKey == @targetKey UPDATE collection WITH { coverImageKey: null, updatedAt: @now } IN collections OPTIONS { keepNull: false } RETURN 1) LET cleanupTrips = (FOR trip IN trips FILTER @targetType == "image" && trip.scopeKey == @scopeKey && trip.coverImageKey == @targetKey UPDATE trip WITH { coverImageKey: null, updatedAt: @now } IN trips OPTIONS { keepNull: false } RETURN 1) LET cleanupInboxes = (FOR inbox IN inboxes FILTER @targetType == "image" && inbox.scopeKey == @scopeKey && inbox.coverImageKey == @targetKey UPDATE inbox WITH { coverImageKey: null, updatedAt: @now } IN inboxes OPTIONS { keepNull: false } RETURN 1) LET cleanupCovers = (FOR document IN documents FILTER @targetType == "image" && document.scopeKey == @scopeKey && document.coverImageKey == @targetKey UPDATE document WITH { coverImageKey: null, updatedAt: @now } IN documents OPTIONS { keepNull: false } RETURN 1) LET cleanupTags = (FOR assignment IN tagAssignments FILTER @targetType == "image" && assignment.scopeKey == @scopeKey && assignment.sourceType == "image" && assignment.sourceKey == @targetKey REMOVE assignment IN tagAssignments RETURN 1) LET cleanupShares = (FOR share IN shares FILTER @targetType == "image" && share.scopeKey == @scopeKey && share.sourceType == "image" && share.sourceKey == @targetKey REMOVE share IN shares RETURN 1) LET cleanupHiddens = (FOR hidden IN userHiddens FILTER @targetType == "image" && hidden.source == "image" && hidden.sourceKey == @targetKey REMOVE hidden IN userHiddens RETURN 1) LET cleanupDocument = (FOR document IN documents FILTER @targetType == "document" && document._key == @targetKey REMOVE document IN documents RETURN 1) LET cleanupImage = (FOR image IN images FILTER @targetType == "image" && image._key == @targetKey REMOVE image IN images RETURN 1) LET cleanupCaption = (FOR caption IN imageCaptions FILTER caption._key == captionKey && LENGTH(FOR retained IN images FILTER retained.imageCaptionKey == caption._key LIMIT 1 RETURN 1) == 0 REMOVE caption IN imageCaptions RETURN 1) LET cleanupStorage = IS_STRING(storageKey) ? FIRST(UPSERT { storageKey } INSERT { storageKey, createdAt: @now } UPDATE {} IN storageDeletionJobs RETURN 1) : null RETURN true`, { '@bindings': EMAIL_ATTACHMENT_BINDINGS_COLLECTION, bindingKey, leaseToken, targetType, targetKey, scopeKey, now });
    },
    async release(bindingKey, leaseToken) { await database.query('FOR binding IN @@bindings FILTER binding._key == @bindingKey && binding.status == "processing" && binding.leaseToken == @leaseToken REMOVE binding IN @@bindings', { '@bindings': EMAIL_ATTACHMENT_BINDINGS_COLLECTION, bindingKey, leaseToken }); },
  };
}

export interface EmailAttachmentIngestionDependencies {
  repository?: EmailAttachmentRepository;
  parse?: typeof parseDocument;
  processImage?: typeof processImage;
  sanitizeImage?: typeof sanitizeGalleryImage;
  documentDependencies?: DocumentParseDependencies;
  imageDependencies?: ImageProcessingDependencies;
  now?: () => Date;
  publishScopeEvent?: (scopeKey: string, event: 'content.changed' | 'image.changed') => Promise<unknown>;
  publishCollectionEvent?: (collectionKey: string, event: 'collection.content.changed' | 'collection.index.changed') => Promise<unknown>;
}

function canonicalImageName(filename: string) { return `${filename.replace(/\.[^.]+$/, '').slice(0, 250) || 'attachment'}.jpg`; }

export function createEmailAttachmentIngestionService(dependencies: EmailAttachmentIngestionDependencies = {}) {
  const repository = dependencies.repository ?? createEmailAttachmentRepository();
  const parse = dependencies.parse ?? parseDocument;
  const process = dependencies.processImage ?? processImage;
  const sanitize = dependencies.sanitizeImage ?? sanitizeGalleryImage;
  const now = dependencies.now ?? (() => new Date());
  const publishScope = dependencies.publishScopeEvent ?? (async (scopeKey, event) => (await import('@/api/events')).publishScopeEvent(scopeKey, event));
  const publishCollection = dependencies.publishCollectionEvent ?? (async (collectionKey, event) => (await import('@/api/events')).publishCollectionEvent(collectionKey, event));
  const compensate = async (staged: StagedEmailAttachment[], scopeKey: string) => {
    const results = await Promise.allSettled([...staged].reverse().map(async (item) => {
      await repository.compensateTarget(item.bindingKey, item.leaseToken, item.targetType, item.targetKey, scopeKey, now().toISOString());
      await repository.release(item.bindingKey, item.leaseToken);
    }));
    const failures = results.flatMap((result) => result.status === 'rejected' ? [result.reason] : []);
    if (failures.length) throw new AggregateError(failures, 'One or more staged email attachments could not be compensated');
  };
  return {
    async ingest(input: { organizationKey: string; scopeKey: string; membershipKey: string; connectorKey: string; providerMessageId: string; part: GmailAttachmentPart; bytes: Uint8Array; connectorLeaseToken?: string; heartbeat?: () => Promise<void>; deferCompletion?: boolean }): Promise<any> {
      const contentHash = createHash('sha256').update(input.bytes).digest('hex');
      const bindingKey = stableKey('email-attachment-binding', input.scopeKey, input.connectorKey, input.providerMessageId, input.part.path);
      const documentFolderKey = stableKey('mail-attachment-folder', input.scopeKey);
      const targetKey = input.part.type === 'document' ? documentKeyForRequest(input.scopeKey, documentFolderKey, bindingKey) : stableKey('email-attachment-target', bindingKey);
      const leaseToken = randomUUID();
      const timestamp = now().toISOString();
      const claim = await repository.claim({ key: bindingKey, organizationKey: input.organizationKey, scopeKey: input.scopeKey, connectorKey: input.connectorKey, providerMessageId: input.providerMessageId, partPath: input.part.path, contentHash, sourceMimeType: input.part.mimeType, sourceFilename: input.part.filename, sourceSize: input.part.size, targetType: input.part.type, targetKey }, input.membershipKey, leaseToken, timestamp, new Date(now().getTime() + PROCESSING_LEASE_MS).toISOString());
      if (claim.status === 'replay') return input.deferCompletion ? { ref: { type: claim.binding.targetType, key: claim.binding.targetKey } } : { type: claim.binding.targetType, key: claim.binding.targetKey };
      if (input.connectorLeaseToken && (!repository.renew || !await repository.renew(bindingKey, leaseToken, input.connectorLeaseToken, now().toISOString(), new Date(now().getTime() + PROCESSING_LEASE_MS).toISOString()))) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Attachment ingestion lost its connector lease fence before processing.', true);
      let heartbeatFailure: unknown;
      const heartbeat = async () => {
        await input.heartbeat?.();
        if (input.connectorLeaseToken && (!repository.renew || !await repository.renew(bindingKey, leaseToken, input.connectorLeaseToken, now().toISOString(), new Date(now().getTime() + PROCESSING_LEASE_MS).toISOString()))) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Attachment ingestion lost its processing lease.', true);
      };
      const timer = input.connectorLeaseToken ? setInterval(() => { void heartbeat().catch((error) => { heartbeatFailure ??= error; }); }, PROCESSING_HEARTBEAT_MS) : undefined;
      let targetPersisted = false;
      try {
        let collectionKey: string | undefined;
        if (input.part.type === 'document') {
          const folderKey = await repository.ensureDocumentFolder(input.scopeKey, timestamp);
          if (folderKey !== documentFolderKey) throw new EmailAttachmentIngestionError('ATTACHMENT_CONFLICT', 'The managed attachment folder identity changed.', false);
          const recovered = await repository.recoverDocumentTarget({ bindingKey, leaseToken, targetKey, scopeKey: input.scopeKey, folderKey, membershipKey: input.membershipKey, now: now().toISOString() });
          if (recovered) {
            targetPersisted = true;
            if (heartbeatFailure) throw heartbeatFailure;
            if (input.deferCompletion) return { ref: { type: 'document', key: recovered.key }, staged: { bindingKey, leaseToken, targetType: 'document', targetKey, membershipKey: input.membershipKey } };
            if (!await repository.complete(bindingKey, leaseToken, 'document', targetKey, undefined, input.membershipKey, now().toISOString())) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Attachment ingestion lost its membership or lease fence before persistence.', true);
            await publishScope(input.scopeKey, 'content.changed').catch(() => undefined);
            return { type: 'document', key: recovered.key };
          }
          try {
            await parse({ file: { filename: input.part.filename, mimeType: input.part.mimeType, sizeBytes: input.bytes.byteLength, bytes: input.bytes }, scopeKey: input.scopeKey, folderKey, idempotencyKey: bindingKey }, { ...dependencies.documentDependencies, getDocument: async (key) => key === targetKey ? repository.documentTarget({ bindingKey, leaseToken, targetKey, scopeKey: input.scopeKey, folderKey, membershipKey: input.membershipKey, now: now().toISOString() }) : dependencies.documentDependencies?.getDocument?.(key) ?? null, insert: async (raw: Document) => (dependencies.documentDependencies?.insert ?? insertPreparedDocument)(documentSchema.parse({ ...raw, key: targetKey, mutationPolicy: 'user', managedPurpose: 'mail-attachment', managedOwnerKey: bindingKey })) });
          } catch (error) {
            if (error instanceof DocumentInputError) throw new GmailPermanentAttachmentError('ATTACHMENT_MALFORMED_PAYLOAD', 'Gmail document attachment contains permanently invalid input', { cause: error });
            throw error;
          }
          targetPersisted = true;
        } else {
          collectionKey = await repository.ensureImageCollection(input.scopeKey, timestamp);
          let sanitized: Awaited<ReturnType<typeof sanitizeGalleryImage>>;
          try { sanitized = await sanitize(input.bytes); }
          catch (error) {
            if (error instanceof GalleryImageInputError) throw new GmailPermanentAttachmentError('ATTACHMENT_MALFORMED_PAYLOAD', 'Gmail image attachment failed canonical validation', { cause: error });
            throw error;
          }
          await process({ scopeKey: input.scopeKey, ownerKey: input.membershipKey, imageKey: targetKey, idempotencyKey: bindingKey, file: { filename: canonicalImageName(input.part.filename), mimeType: 'image/jpeg', sizeBytes: sanitized.bytes.byteLength, bytes: sanitized.bytes }, mutationPolicy: 'system-only' }, { ...dependencies.imageDependencies, persistImage: dependencies.imageDependencies?.persistImage ?? insertPreparedImageWithCaption });
          targetPersisted = true;
        }
        await heartbeat();
        if (heartbeatFailure) throw heartbeatFailure;
        if (input.deferCompletion) return { ref: { type: input.part.type, key: targetKey }, staged: { bindingKey, leaseToken, targetType: input.part.type, targetKey, ...(collectionKey ? { collectionKey } : {}), membershipKey: input.membershipKey } };
        if (!await repository.complete(bindingKey, leaseToken, input.part.type, targetKey, collectionKey, input.membershipKey, now().toISOString())) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Attachment ingestion lost its membership or lease fence before persistence.', true);
        if (input.part.type === 'document') await publishScope(input.scopeKey, 'content.changed').catch(() => undefined);
        else await Promise.all([publishScope(input.scopeKey, 'image.changed'), publishCollection(collectionKey!, 'collection.content.changed'), publishCollection(collectionKey!, 'collection.index.changed')].map((event) => event.catch(() => undefined)));
        return { type: input.part.type, key: targetKey };
      } catch (error) {
        if (targetPersisted) await repository.compensateTarget(bindingKey, leaseToken, input.part.type, targetKey, input.scopeKey, now().toISOString());
        await repository.release(bindingKey, leaseToken);
        throw error;
      } finally {
        if (timer) clearInterval(timer);
      }
    },
    async ingestMessage(input: { organizationKey: string; scopeKey: string; membershipKey: string; connectorKey: string; gmail: GmailClient; message: GmailMessageResource }) {
      const parts = gmailAttachmentParts(input.message.payload);
      const refs: EmailAttachmentRef[] = [];
      if (!parts.length) return refs;
      const membershipKey = await repository.activeMembership({ organizationKey: input.organizationKey, scopeKey: input.scopeKey, preferredMembershipKey: input.membershipKey });
      for (const part of parts) {
        const key = stableKey('email-attachment-binding', input.scopeKey, input.connectorKey, input.message.id, part.path);
        const completed = await repository.completed({ key, organizationKey: input.organizationKey, scopeKey: input.scopeKey, connectorKey: input.connectorKey, providerMessageId: input.message.id, partPath: part.path, targetType: part.type, sourceMimeType: part.mimeType, sourceFilename: part.filename, sourceSize: part.size }, membershipKey);
        if (completed) {
          refs.push({ type: completed.targetType, key: completed.targetKey });
          continue;
        }
        try { refs.push(await this.ingest({ ...input, membershipKey, providerMessageId: input.message.id, part, bytes: await input.gmail.attachment(input.message.id, part) }) as EmailAttachmentRef); }
        catch (error) { if (!(error instanceof GmailPermanentAttachmentError)) throw error; }
      }
      return refs;
    },
    async stageMessage(input: { organizationKey: string; scopeKey: string; membershipKey: string; connectorKey: string; connectorLeaseToken: string; heartbeat: () => Promise<void>; gmail: GmailClient; message: GmailMessageResource }): Promise<StagedEmailAttachments> {
      const discovery = discoverGmailAttachmentParts(input.message.payload);
      const parts = discovery.parts;
      const hasAttachments = messageBodies(input.message.payload).hasAttachments;
      const result: StagedEmailAttachments = { refs: [], staged: [], availability: hasAttachments ? (discovery.truncated ? 'truncated' : 'complete') : 'none', ...(discovery.unavailableCount ? { unavailableCount: discovery.unavailableCount } : {}) };
      if (!parts.length) return result;
      const membershipKey = await repository.activeMembership({ organizationKey: input.organizationKey, scopeKey: input.scopeKey, preferredMembershipKey: input.membershipKey });
      let permanentFailures = 0;
      let stagedHeartbeatInFlight = false;
      let stagedHeartbeatFailure: unknown;
      const stagedHeartbeat = setInterval(() => {
        if (stagedHeartbeatInFlight || !result.staged.length) return;
        stagedHeartbeatInFlight = true;
        Promise.all([input.heartbeat(), this.renew(result.staged, input.connectorLeaseToken)])
          .catch((error) => { stagedHeartbeatFailure ??= error; })
          .finally(() => { stagedHeartbeatInFlight = false; });
      }, PROCESSING_HEARTBEAT_MS);
      try {
        for (const part of parts) {
          if (stagedHeartbeatFailure) throw stagedHeartbeatFailure;
          const key = stableKey('email-attachment-binding', input.scopeKey, input.connectorKey, input.message.id, part.path);
          const completed = await repository.completed({ key, organizationKey: input.organizationKey, scopeKey: input.scopeKey, connectorKey: input.connectorKey, providerMessageId: input.message.id, partPath: part.path, targetType: part.type, sourceMimeType: part.mimeType, sourceFilename: part.filename, sourceSize: part.size }, membershipKey);
          if (completed) { result.refs.push({ type: completed.targetType, key: completed.targetKey }); continue; }
          try {
            const staged = await this.ingest({ ...input, membershipKey, providerMessageId: input.message.id, part, bytes: await input.gmail.attachment(input.message.id, part), deferCompletion: true }) as { ref: EmailAttachmentRef; staged?: StagedEmailAttachment };
            result.refs.push(staged.ref);
            if (staged.staged) result.staged.push(staged.staged);
          } catch (error) {
            if (!(error instanceof GmailPermanentAttachmentError)) throw error;
            permanentFailures += 1;
          }
        }
        if (stagedHeartbeatFailure) throw stagedHeartbeatFailure;
        await Promise.all([input.heartbeat(), this.renew(result.staged, input.connectorLeaseToken)]);
        if (permanentFailures) {
          result.availability = 'failed';
          result.unavailableCount = Math.min(10_000, (result.unavailableCount ?? 0) + permanentFailures);
        }
        return result;
      } catch (error) {
        await compensate(result.staged, input.scopeKey);
        throw error;
      } finally {
        clearInterval(stagedHeartbeat);
      }
    },
    renew: async (staged: StagedEmailAttachment[], connectorLeaseToken: string) => {
      for (const item of staged) if (!repository.renew || !await repository.renew(item.bindingKey, item.leaseToken, connectorLeaseToken, now().toISOString(), new Date(now().getTime() + PROCESSING_LEASE_MS).toISOString())) throw new EmailAttachmentIngestionError('ATTACHMENT_ACCESS_REVOKED', 'Attachment processing lease was lost before mail persistence.', true);
    },
    compensate,
  };
}

export type EmailAttachmentIngestionService = ReturnType<typeof createEmailAttachmentIngestionService>;
