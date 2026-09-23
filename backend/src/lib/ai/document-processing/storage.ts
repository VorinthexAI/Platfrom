import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand } from '@aws-sdk/client-s3';
import { currentBillingUserKey } from '@/lib/ai/events/runtime';
import { markStoredObjectDeleted, recordStoredObject } from '@/lib/automations/storage-charger-repository';
import { s3, S3_BUCKET } from '@/lib/s3';
import { invalidateMediaDownload } from '@/lib/media-delivery';

export interface DocumentStorage {
  upload(input: { key: string; bytes: Uint8Array; mimeType: string; billingUserKey?: string }): Promise<{ storageKey: string; bucket?: string; etag?: string }>;
  delete(storageKey: string): Promise<void>;
}

export interface DocumentObjectStorage extends DocumentStorage {
  exists?(storageKey: string): Promise<boolean>;
  download(storageKey: string): Promise<{ bytes: Uint8Array; mimeType?: string; sizeBytes?: number; etag?: string }>;
  copy(input: { sourceKey: string; destinationKey: string; mimeType?: string; billingUserKey?: string }): Promise<{ storageKey: string; sizeBytes?: number; bucket?: string; etag?: string }>;
}

export const documentStorage: DocumentObjectStorage = {
  async exists(storageKey) {
    // Explicit listing distinguishes a missing preview from AccessDenied. A
    // missing GET/HEAD otherwise returns 403 when ListBucket is not permitted.
    const result = await s3.send(new ListObjectsV2Command({ Bucket: S3_BUCKET, Prefix: storageKey, MaxKeys: 1 }));
    return result.Contents?.some(({ Key }) => Key === storageKey) ?? false;
  },
  async upload(input) {
    const billingUserKey = input.billingUserKey ?? currentBillingUserKey();
    const result = await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: input.key,
      Body: input.bytes,
      ContentType: input.mimeType,
      ContentLength: input.bytes.byteLength,
    }));
    if (billingUserKey) {
      try { await recordStoredObject({ storageKey: input.key, userKey: billingUserKey, sizeBytes: input.bytes.byteLength }); }
      catch (error) { await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: input.key })).catch(() => undefined); throw error; }
    }
    return { storageKey: input.key, bucket: S3_BUCKET, etag: result.ETag };
  },
  async delete(storageKey) {
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: storageKey }));
    await invalidateMediaDownload(storageKey);
    await markStoredObjectDeleted(storageKey);
  },
  async download(storageKey) {
    const result = await s3.send(new GetObjectCommand({ Bucket: S3_BUCKET, Key: storageKey }));
    if (!result.Body) throw new Error(`Storage object ${storageKey} returned no body.`);
    return {
      bytes: await result.Body.transformToByteArray(),
      ...(result.ContentType ? { mimeType: result.ContentType } : {}),
      ...(result.ContentLength !== undefined ? { sizeBytes: result.ContentLength } : {}),
      ...(result.ETag ? { etag: result.ETag } : {}),
    };
  },
  async copy(input) {
    const billingUserKey = input.billingUserKey ?? currentBillingUserKey();
    const copySource = `${S3_BUCKET}/${input.sourceKey.split('/').map(encodeURIComponent).join('/')}`;
    const result = await s3.send(new CopyObjectCommand({
      Bucket: S3_BUCKET,
      Key: input.destinationKey,
      CopySource: copySource,
      ...(input.mimeType ? { ContentType: input.mimeType, MetadataDirective: 'REPLACE' } : {}),
    }));
    const stored = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: input.destinationKey }));
    if (stored.ContentLength === undefined) throw new Error(`Copied storage object ${input.destinationKey} returned no size.`);
    if (billingUserKey) {
      try { await recordStoredObject({ storageKey: input.destinationKey, userKey: billingUserKey, sizeBytes: stored.ContentLength }); }
      catch (error) { await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: input.destinationKey })).catch(() => undefined); throw error; }
    }
    return { storageKey: input.destinationKey, sizeBytes: stored.ContentLength, bucket: S3_BUCKET, etag: result.CopyObjectResult?.ETag };
  },
};
