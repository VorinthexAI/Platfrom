import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { currentBillingUserKey } from '@/lib/ai/events/runtime';
import { assertStorageGrowthAllowed, markStoredObjectDeleted, recordStoredObject } from '@/lib/automations/storage-charger-repository';
import { s3, S3_BUCKET } from '@/lib/s3';

export interface DocumentStorage {
  upload(input: { key: string; bytes: Uint8Array; mimeType: string; billingUserKey?: string }): Promise<{ storageKey: string; bucket?: string; etag?: string }>;
  delete(storageKey: string): Promise<void>;
}

export interface DocumentObjectStorage extends DocumentStorage {
  download(storageKey: string): Promise<{ bytes: Uint8Array; mimeType?: string; sizeBytes?: number; etag?: string }>;
  copy(input: { sourceKey: string; destinationKey: string; mimeType?: string; billingUserKey?: string }): Promise<{ storageKey: string; bucket?: string; etag?: string }>;
}

export const documentStorage: DocumentObjectStorage = {
  async upload(input) {
    const billingUserKey = input.billingUserKey ?? currentBillingUserKey();
    if (billingUserKey) await assertStorageGrowthAllowed(billingUserKey);
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
    if (billingUserKey) await assertStorageGrowthAllowed(billingUserKey);
    const copySource = `${S3_BUCKET}/${input.sourceKey.split('/').map(encodeURIComponent).join('/')}`;
    const result = await s3.send(new CopyObjectCommand({
      Bucket: S3_BUCKET,
      Key: input.destinationKey,
      CopySource: copySource,
      ...(input.mimeType ? { ContentType: input.mimeType, MetadataDirective: 'REPLACE' } : {}),
    }));
    if (billingUserKey) {
      const stored = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: input.destinationKey }));
      if (stored.ContentLength === undefined) throw new Error(`Copied storage object ${input.destinationKey} returned no size.`);
      try { await recordStoredObject({ storageKey: input.destinationKey, userKey: billingUserKey, sizeBytes: stored.ContentLength }); }
      catch (error) { await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: input.destinationKey })).catch(() => undefined); throw error; }
    }
    return { storageKey: input.destinationKey, bucket: S3_BUCKET, etag: result.CopyObjectResult?.ETag };
  },
};
