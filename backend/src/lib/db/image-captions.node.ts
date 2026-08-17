import { z } from 'zod';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';
import { perceptualHashDistance, perceptualHashSchema, perceptualHashSegments, PERCEPTUAL_HASH_DUPLICATE_DISTANCE } from '@/lib/perceptual-hash';
import { currentEmbeddingSchema } from '@/lib/embeddings';

export const IMAGE_CAPTIONS_COLLECTION = 'imageCaptions';
export const PERCEPTUAL_HASH_ALGORITHM = 'phash-64-dct-v1' as const;

export const imageCaptionRecordSchema = z.object({
  key: z.string().cuid(),
  scopeKey: z.string().cuid(),
  sourceImageKey: z.string().cuid(),
  caption: z.string().trim().min(1),
  score: z.number().int().min(1).max(100).default(1),
  scoreVersion: z.number().int().min(0).max(1).default(0),
  embedding: currentEmbeddingSchema,
  perceptualHash: z.string().regex(/^[a-f0-9]{16}$/).nullable(),
  hashAlgorithm: z.literal(PERCEPTUAL_HASH_ALGORITHM).nullable(),
  hashSegment0: z.string().regex(/^[a-f0-9]{4}$/).nullable(),
  hashSegment1: z.string().regex(/^[a-f0-9]{4}$/).nullable(),
  hashSegment2: z.string().regex(/^[a-f0-9]{4}$/).nullable(),
  hashSegment3: z.string().regex(/^[a-f0-9]{4}$/).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type ImageCaptionRecord = z.infer<typeof imageCaptionRecordSchema>;

const helpers = createNodeHelpers(IMAGE_CAPTIONS_COLLECTION, imageCaptionRecordSchema, [], { requireEmbedding: false });
export const insertImageCaptionRecord = helpers.insert;
export const getImageCaptionRecordById = helpers.getById;
export const updateImageCaptionRecord = helpers.updateById;
export const upsertImageCaptionRecordByKey = helpers.upsertByKey;
export const getAllImageCaptionRecordsChunked = helpers.getAllChunked;

interface ImageCaptionDatabase {
  query(query: string, bindVars?: Record<string, unknown>): Promise<{ all(): Promise<unknown[]> }>;
}

export async function findReusableImageCaption(
  scopeKey: string,
  perceptualHash: string,
  actorKey: string,
  database: ImageCaptionDatabase = db,
): Promise<ImageCaptionRecord | null> {
  const hash = perceptualHashSchema.parse(perceptualHash);
  const segments = perceptualHashSegments(hash);
  const cursor = await database.query(`
    LET actorMembership = DOCUMENT(userOrganizations, @actorKey)
    LET actorScope = DOCUMENT(scopes, @scopeKey)
    LET active = actorMembership != null
      && actorScope != null
      && actorScope.deletedAt == null
      && actorMembership.status == "active"
      && actorMembership.organizationId == actorScope.organizationKey
    LET elevated = active && actorMembership.orgRole IN ["owner", "admin"]
    LET scoped = active && LENGTH(
      FOR scopeMember IN scopeMembers
        FILTER scopeMember.scopeKey == @scopeKey
        FILTER scopeMember.userOrganizationKey == @actorKey
        FILTER scopeMember.status == "active"
        LIMIT 1
        RETURN 1
    ) > 0
    FOR caption IN imageCaptions
      FILTER caption.scopeKey == @scopeKey
      FILTER caption.hashAlgorithm == @hashAlgorithm
      FILTER caption.perceptualHash != null
      FILTER caption.hashSegment0 == @segment0
        || caption.hashSegment1 == @segment1
        || caption.hashSegment2 == @segment2
        || caption.hashSegment3 == @segment3
      LET accessibleImage = FIRST(
        FOR image IN images
          FILTER image.imageCaptionKey == caption._key
          FILTER image.scopeKey == @scopeKey && image.deletedAt == null
          LET collectionAccess = active && LENGTH(
            FOR relation IN collectionImages
              FILTER relation.scopeKey == @scopeKey
              FILTER relation.imageKey == image._key
              LET collection = DOCUMENT(collections, relation.collectionKey)
              FILTER collection != null && collection.scopeKey == @scopeKey && collection.deletedAt == null
              FOR member IN collectionMembers
                FILTER member.scopeKey == @scopeKey
                FILTER member.collectionKey == relation.collectionKey
                FILTER member.memberKey == @actorKey
                LIMIT 1
                RETURN 1
          ) > 0
          FILTER elevated || scoped || collectionAccess
          LIMIT 1
          RETURN image._key
      )
      FILTER accessibleImage != null
      RETURN caption
  `, {
    scopeKey,
    actorKey,
    hashAlgorithm: PERCEPTUAL_HASH_ALGORITHM,
    segment0: segments[0],
    segment1: segments[1],
    segment2: segments[2],
    segment3: segments[3],
  });
  const matches = (await cursor.all())
    .map((value) => imageCaptionRecordSchema.parse(withArangoKey(value as Record<string, unknown>)))
    .filter((caption) => caption.perceptualHash !== null)
    .map((caption) => ({ caption, distance: perceptualHashDistance(hash, caption.perceptualHash!) }))
    .filter(({ distance }) => distance <= PERCEPTUAL_HASH_DUPLICATE_DISTANCE)
    .sort((left, right) => left.distance - right.distance || left.caption.createdAt.localeCompare(right.caption.createdAt) || left.caption.key.localeCompare(right.caption.key));
  return matches[0]?.caption ?? null;
}
