import { DeleteObjectCommand, PutObjectCommand } from '@aws-sdk/client-s3';
import { s3, S3_BUCKET } from '@/lib/s3';

export interface DocumentStorage {
  upload(input: { key: string; bytes: Uint8Array; mimeType: string }): Promise<{ storageKey: string; bucket?: string; etag?: string }>;
  delete(storageKey: string): Promise<void>;
}

export const documentStorage: DocumentStorage = {
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
};
