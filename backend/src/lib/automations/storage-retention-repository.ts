import { z } from 'zod';
import { db, withTransaction } from '@/lib/db/client';
import { withArangoKey } from '@/lib/db/base';
import { STORAGE_OBJECTS_COLLECTION, STORAGE_RETENTION_STATES_COLLECTION } from './storage-charger-repository';

export const storageRetentionStateSchema = z.object({
  key: z.string().min(1),
  userKey: z.string().min(1).max(160),
  paymentPastDueAt: z.string().datetime(),
  wipeDueAt: z.string().datetime(),
  minimumBalanceMicroSparks: z.number().int().positive().safe(),
  fundedAt: z.string().datetime().optional(),
  wipeBatch: z.number().int().nonnegative().optional(),
  wipeStartedAt: z.string().datetime().optional(),
  wipedAt: z.string().datetime().optional(),
}).strict();
export type StorageRetentionState = z.infer<typeof storageRetentionStateSchema>;

export const STORAGE_WIPE_BATCH_SIZE = 1000;
export const STORAGE_RETENTION_SCAN_BATCH_SIZE = 100;
const wipeInputSchema = z.object({ userKey: z.string().min(1).max(160), expectedWipeDueAt: z.string().datetime(), batch: z.number().int().nonnegative(), now: z.string().datetime() }).strict();
export type StorageWipeResult = { status: 'stale' } | { status: 'continued'; nextBatch: number; processed: number } | { status: 'wiped'; processed: number };
type Cursor = { all(): Promise<unknown[]>; next(): Promise<unknown> };
export interface StorageRetentionDatabase { query(query: string, bindVars?: Record<string, unknown>): Promise<Cursor> }
type TransactionRunner = <T>(operation: (transaction: StorageRetentionDatabase) => Promise<T>) => Promise<T>;

export const STORAGE_WIPE_COLLECTIONS = [
  'users', STORAGE_RETENTION_STATES_COLLECTION, STORAGE_OBJECTS_COLLECTION, 'storageDeletionJobs',
   'books', 'bookChapters', 'emailAttachments', 'emailAttachmentBindings', 'emailMessages', 'emailDrafts', 'placeHeroMedia', 'documents',
  'documentVersions', 'documentAudioVersions', 'documentSummaryAudio', 'images', 'imageCaptions',
  'collectionImages', 'placeImages', 'imageIdentities', 'visualIdentities', 'imageCollecitionHightlights',
   'imageCollectionMemories', 'collections', 'folders', 'trips', 'galleryUploads', 'tagAssignments', 'shares',
   'userHiddens', 'conversationMessages',
] as const;

export interface StorageRetentionRepository {
  listUnfunded(input?: { afterKey?: string; limit?: number }): Promise<Array<StorageRetentionState & { balanceMicroSparks: number }>>;
  markFunded(userKey: string, fundedAt: string): Promise<boolean>;
  wipe(input: { userKey: string; expectedWipeDueAt: string; batch: number; now: string }): Promise<StorageWipeResult>;
}

export function createStorageRetentionRepository(
  database: StorageRetentionDatabase = db as unknown as StorageRetentionDatabase,
  transact: TransactionRunner = (operation) => withTransaction({ write: [...STORAGE_WIPE_COLLECTIONS] }, (transaction) => operation(transaction as unknown as StorageRetentionDatabase)),
): StorageRetentionRepository {
  return {
    async listUnfunded(input = {}) {
      const limit = Math.min(Math.max(input.limit ?? STORAGE_RETENTION_SCAN_BATCH_SIZE, 1), STORAGE_RETENTION_SCAN_BATCH_SIZE);
      const cursor = await database.query('FOR state IN @@retention FILTER state.fundedAt == null && state._key > @afterKey SORT state._key ASC LIMIT @limit LET user = DOCUMENT(users, state.userKey) LET balanceMicroSparks = user != null && IS_NUMBER(user.microSparkBalance) ? user.microSparkBalance : 0 RETURN { state, balanceMicroSparks }', { '@retention': STORAGE_RETENTION_STATES_COLLECTION, afterKey: input.afterKey ?? '', limit });
      return (await cursor.all()).map((raw) => {
        const value = raw as { state: Record<string, unknown>; balanceMicroSparks: unknown };
        const balanceMicroSparks = z.number().int().nonnegative().safe().parse(value.balanceMicroSparks);
        return { ...storageRetentionStateSchema.parse(withArangoKey(value.state)), balanceMicroSparks };
      });
    },

    async markFunded(userKey, fundedAt) {
      const valid = z.object({ userKey: storageRetentionStateSchema.shape.userKey, fundedAt: z.string().datetime() }).strict().parse({ userKey, fundedAt });
      const cursor = await database.query('FOR state IN @@retention FILTER state.userKey == @userKey && state.fundedAt == null && state.wipeStartedAt == null LET user = DOCUMENT(users, state.userKey) FILTER user != null && IS_NUMBER(user.microSparkBalance) && user.microSparkBalance >= state.minimumBalanceMicroSparks UPDATE state WITH { fundedAt: @fundedAt } IN @@retention RETURN true', { '@retention': STORAGE_RETENTION_STATES_COLLECTION, ...valid });
      return await cursor.next() === true;
    },

    async wipe(rawInput) {
      const input = wipeInputSchema.parse(rawInput);
      return transact(async (transaction) => {
        const eligible = await transaction.query('LET state = FIRST(FOR value IN @@retention FILTER value.userKey == @userKey LIMIT 1 RETURN value) LET user = DOCUMENT(users, @userKey) LET currentBatch = state != null && IS_NUMBER(state.wipeBatch) ? state.wipeBatch : 0 FILTER state != null && state.wipeDueAt == @expectedWipeDueAt && currentBatch == @batch && state.fundedAt == null && state.wipedAt == null && state.wipeDueAt <= @now && ((@batch == 0 && state.wipeStartedAt == null && (user == null || !IS_NUMBER(user.microSparkBalance) || user.microSparkBalance < state.minimumBalanceMicroSparks)) || (@batch > 0 && state.wipeStartedAt != null)) RETURN true', { '@retention': STORAGE_RETENTION_STATES_COLLECTION, ...input });
        if (await eligible.next() !== true) return { status: 'stale' };

        const rows = await transaction.query('FOR object IN @@objects FILTER object.userKey == @userKey && object.deletedAt == null COLLECT storageKey = object.storageKey SORT storageKey ASC LIMIT @batchSize RETURN storageKey', { '@objects': STORAGE_OBJECTS_COLLECTION, userKey: input.userKey, batchSize: STORAGE_WIPE_BATCH_SIZE });
        const storageKeys = z.array(z.string().min(1)).parse(await rows.all());
        const bind = { storageKeys, now: input.now };

        await transaction.query('FOR user IN users FILTER user.profileStorageKey IN @storageKeys UPDATE user WITH { profileStorageKey: null, updatedAt: @now } IN users OPTIONS { keepNull: false }', bind);
        await transaction.query('FOR book IN books FILTER book.coverStorageKey IN @storageKeys UPDATE book WITH { coverStorageKey: null, updatedAt: @now } IN books OPTIONS { keepNull: false }', bind);
        await transaction.query('FOR chapter IN bookChapters FILTER chapter.audioStorageKey IN @storageKeys UPDATE chapter WITH { audioStorageKey: null, updatedAt: @now } IN bookChapters OPTIONS { keepNull: false }', bind);
        const attachmentRows = await transaction.query('FOR attachment IN emailAttachments FILTER attachment.storageKey IN @storageKeys RETURN attachment._key', bind);
        const attachmentKeys = z.array(z.string()).parse(await attachmentRows.all());
        await transaction.query('FOR binding IN emailAttachmentBindings FILTER binding._key IN @attachmentKeys || binding.targetKey IN @attachmentKeys REMOVE binding IN emailAttachmentBindings', { attachmentKeys });
        await transaction.query('FOR message IN emailMessages FILTER IS_ARRAY(message.attachments) LET retained = (FOR attachment IN message.attachments FILTER attachment.key NOT IN @attachmentKeys RETURN attachment) FILTER LENGTH(retained) != LENGTH(message.attachments) UPDATE message WITH { attachments: retained, updatedAt: @now } IN emailMessages', { attachmentKeys, now: input.now });
        await transaction.query('FOR draft IN emailDrafts FILTER IS_ARRAY(draft.attachments) LET retained = (FOR attachment IN draft.attachments FILTER attachment.key NOT IN @attachmentKeys RETURN attachment) FILTER LENGTH(retained) != LENGTH(draft.attachments) UPDATE draft WITH { attachments: retained, updatedAt: @now } IN emailDrafts', { attachmentKeys, now: input.now });
        await transaction.query('FOR attachment IN emailAttachments FILTER attachment._key IN @attachmentKeys REMOVE attachment IN emailAttachments', { attachmentKeys });
        await transaction.query('FOR media IN placeHeroMedia FILTER media.storageKey IN @storageKeys REMOVE media IN placeHeroMedia', bind);
        await transaction.query('FOR document IN documents LET nextSources = IS_ARRAY(document.sourceStorageKeys) ? REMOVE_VALUES(document.sourceStorageKeys, @storageKeys) : document.sourceStorageKeys LET nextSpeech = IS_ARRAY(document.speechStorageKeys) ? REMOVE_VALUES(document.speechStorageKeys, @storageKeys) : document.speechStorageKeys FILTER document.storageKey IN @storageKeys || nextSources != document.sourceStorageKeys || nextSpeech != document.speechStorageKeys UPDATE document WITH MERGE(document.storageKey IN @storageKeys ? { storageKey: null, sizeBytes: null, mimeType: null } : {}, { sourceStorageKeys: nextSources, speechStorageKeys: nextSpeech, updatedAt: @now }) IN documents OPTIONS { keepNull: false }', bind);
        await transaction.query('FOR version IN documentVersions FILTER version.storageKey IN @storageKeys REMOVE version IN documentVersions', bind);
        await transaction.query('FOR audio IN documentAudioVersions FILTER audio.storageKey IN @storageKeys REMOVE audio IN documentAudioVersions', bind);
        await transaction.query('FOR audio IN documentSummaryAudio FILTER audio.storageKey IN @storageKeys REMOVE audio IN documentSummaryAudio', bind);

        const imageRows = await transaction.query('FOR image IN images FILTER image.storageKey IN @storageKeys RETURN { key: image._key, captionKey: image.imageCaptionKey }', bind);
        const imageValues = z.array(z.object({ key: z.string(), captionKey: z.string().nullable().optional() })).parse(await imageRows.all());
        const imageKeys = imageValues.map(({ key }) => key);
        const captionKeys = imageValues.flatMap(({ captionKey }) => captionKey ? [captionKey] : []);
        const imageBind = { imageKeys, now: input.now };
        await transaction.query('FOR relation IN collectionImages FILTER relation.imageKey IN @imageKeys REMOVE relation IN collectionImages', imageBind);
        await transaction.query('FOR relation IN placeImages FILTER relation.imageKey IN @imageKeys REMOVE relation IN placeImages', imageBind);
        await transaction.query('FOR item IN imageCollecitionHightlights LET retained = REMOVE_VALUES(item.imageKeys, @imageKeys) FILTER retained != item.imageKeys UPDATE item WITH { imageKeys: retained, updatedAt: @now } IN imageCollecitionHightlights', imageBind);
        const memoryRows = await transaction.query('FOR item IN imageCollectionMemories FILTER item.imageKey IN @imageKeys RETURN item._key', imageBind);
        const memoryKeys = z.array(z.string()).parse(await memoryRows.all());
        await transaction.query('FOR item IN imageCollectionMemories FILTER item._key IN @memoryKeys REMOVE item IN imageCollectionMemories', { memoryKeys });
        await transaction.query('FOR assignment IN tagAssignments FILTER (assignment.sourceType == "image" && assignment.sourceKey IN @imageKeys) || (assignment.sourceType == "image-memory" && assignment.sourceKey IN @memoryKeys) REMOVE assignment IN tagAssignments', { imageKeys, memoryKeys });
        await transaction.query('FOR share IN shares FILTER share.sourceType == "image" && share.sourceKey IN @imageKeys REMOVE share IN shares', { imageKeys });
        await transaction.query('FOR hidden IN userHiddens FILTER hidden.source == "image" && hidden.sourceKey IN @imageKeys REMOVE hidden IN userHiddens', { imageKeys });
        await transaction.query('FOR message IN conversationMessages FILTER message.imageKey IN @imageKeys REMOVE message IN conversationMessages', { imageKeys });
        await transaction.query('FOR relation IN imageIdentities FILTER relation.imageKey IN @imageKeys REMOVE relation IN imageIdentities', imageBind);
        const removedIdentities = await transaction.query('FOR identity IN visualIdentities FILTER identity.referenceImageKey IN @imageKeys LET replacement = FIRST(FOR relation IN imageIdentities FILTER relation.identityKey == identity._key && relation.imageKey NOT IN @imageKeys LET image = DOCUMENT(images, relation.imageKey) FILTER image != null SORT relation.isReference DESC, relation.confidence DESC, relation.createdAt ASC RETURN relation.imageKey) FILTER replacement == null REMOVE identity IN visualIdentities RETURN OLD._key', imageBind);
        await transaction.query('FOR relation IN imageIdentities FILTER relation.identityKey IN @identityKeys REMOVE relation IN imageIdentities', { identityKeys: await removedIdentities.all() });
        await transaction.query('FOR identity IN visualIdentities FILTER identity.referenceImageKey IN @imageKeys LET replacement = FIRST(FOR relation IN imageIdentities FILTER relation.identityKey == identity._key && relation.imageKey NOT IN @imageKeys LET image = DOCUMENT(images, relation.imageKey) FILTER image != null SORT relation.confidence DESC, relation.createdAt ASC RETURN relation.imageKey) FILTER replacement != null UPDATE identity WITH { referenceImageKey: replacement, updatedAt: @now } IN visualIdentities', imageBind);
        await transaction.query('FOR collection IN collections FILTER collection.coverImageKey IN @imageKeys UPDATE collection WITH { coverImageKey: null, updatedAt: @now } IN collections OPTIONS { keepNull: false }', imageBind);
        await transaction.query('FOR folder IN folders FILTER folder.coverImageKey IN @imageKeys UPDATE folder WITH { coverImageKey: null, updatedAt: @now } IN folders OPTIONS { keepNull: false }', imageBind);
        await transaction.query('FOR document IN documents FILTER document.coverImageKey IN @imageKeys UPDATE document WITH { coverImageKey: null, updatedAt: @now } IN documents OPTIONS { keepNull: false }', imageBind);
        await transaction.query('FOR trip IN trips FILTER trip.coverImageKey IN @imageKeys UPDATE trip WITH { coverImageKey: null, updatedAt: @now } IN trips OPTIONS { keepNull: false }', imageBind);
        await transaction.query('FOR image IN images FILTER image._key IN @imageKeys REMOVE image IN images', imageBind);
        await transaction.query('FOR caption IN imageCaptions FILTER caption._key IN @captionKeys && LENGTH(FOR image IN images FILTER image.imageCaptionKey == caption._key LIMIT 1 RETURN 1) == 0 REMOVE caption IN imageCaptions', { captionKeys });
        await transaction.query('FOR upload IN galleryUploads FILTER upload.storageKey IN @storageKeys REMOVE upload IN galleryUploads', bind);

        await transaction.query('FOR storageKey IN UNIQUE(@storageKeys) UPSERT { storageKey } INSERT { storageKey, createdAt: @now, status: "pending" } UPDATE { status: "pending", claimToken: null, claimedAt: null, reservationExpiresAt: null } IN storageDeletionJobs OPTIONS { keepNull: false }', bind);
        await transaction.query('FOR object IN @@objects FILTER object.userKey == @userKey && object.storageKey IN @storageKeys && object.deletedAt == null UPDATE object WITH { deletedAt: @now } IN @@objects', { '@objects': STORAGE_OBJECTS_COLLECTION, userKey: input.userKey, ...bind });
        const remaining = await transaction.query('FOR object IN @@objects FILTER object.userKey == @userKey && object.deletedAt == null LIMIT 1 RETURN true', { '@objects': STORAGE_OBJECTS_COLLECTION, userKey: input.userKey });
        const hasMore = await remaining.next() === true;
        const nextBatch = input.batch + 1;
        const update = hasMore
          ? 'FOR state IN @@retention LET currentBatch = IS_NUMBER(state.wipeBatch) ? state.wipeBatch : 0 FILTER state.userKey == @userKey && state.wipeDueAt == @expectedWipeDueAt && currentBatch == @batch && state.fundedAt == null && state.wipedAt == null UPDATE state WITH { wipeStartedAt: state.wipeStartedAt == null ? @now : state.wipeStartedAt, wipeBatch: @nextBatch } IN @@retention RETURN true'
          : 'FOR state IN @@retention LET currentBatch = IS_NUMBER(state.wipeBatch) ? state.wipeBatch : 0 FILTER state.userKey == @userKey && state.wipeDueAt == @expectedWipeDueAt && currentBatch == @batch && state.fundedAt == null && state.wipedAt == null UPDATE state WITH { wipeStartedAt: state.wipeStartedAt == null ? @now : state.wipeStartedAt, wipedAt: @now } IN @@retention RETURN true';
        const fenced = await transaction.query(update, { '@retention': STORAGE_RETENTION_STATES_COLLECTION, ...input, nextBatch });
        if (await fenced.next() !== true) throw new Error('Storage retention state changed during wipe.');
        return hasMore ? { status: 'continued', nextBatch, processed: storageKeys.length } : { status: 'wiped', processed: storageKeys.length };
      });
    },
  };
}

export const getDefaultStorageRetentionRepository = () => createStorageRetentionRepository();
