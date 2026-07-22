import { CopyObjectCommand, DeleteObjectCommand, GetObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { s3, S3_BUCKET } from '@/lib/s3';

export interface DocumentStorage {
  upload(input: { key: string; bytes: Uint8Array; mimeType: string }): Promise<{ storageKey: string; bucket?: string; etag?: string }>;
  delete(storageKey: string): Promise<void>;
}

export interface DocumentObjectStorage extends DocumentStorage {
  download(storageKey: string): Promise<{ bytes: Uint8Array; mimeType?: string; sizeBytes?: number; etag?: string }>;
  copy(input: { sourceKey: string; destinationKey: string; mimeType?: string }): Promise<{ storageKey: string; bucket?: string; etag?: string }>;
}

export const documentStorage: DocumentObjectStorage = {
  async upload(input) {
    const result = await s3.send(new PutObjectCommand({
      Bucket: S3_BUCKET,
      Key: input.key,
      Body: input.bytes,
      ContentType: input.mimeType,
      ContentLength: input.bytes.byteLength,
    }));
    return { storageKey: input.key, bucket: S3_BUCKET, etag: result.ETag };
  },
  async delete(storageKey) {
    await s3.send(new DeleteObjectCommand({ Bucket: S3_BUCKET, Key: storageKey }));
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
    const copySource = `${S3_BUCKET}/${input.sourceKey.split('/').map(encodeURIComponent).join('/')}`;
    const result = await s3.send(new CopyObjectCommand({
      Bucket: S3_BUCKET,
      Key: input.destinationKey,
      CopySource: copySource,
      ...(input.mimeType ? { ContentType: input.mimeType, MetadataDirective: 'REPLACE' } : {}),
    }));
    return { storageKey: input.destinationKey, bucket: S3_BUCKET, etag: result.CopyObjectResult?.ETag };
  },
};
