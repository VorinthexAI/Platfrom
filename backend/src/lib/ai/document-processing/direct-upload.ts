import { HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import { newId } from '@/lib/ids';
import { redisConnection } from '@/lib/redis';
import { createPublicS3Client, s3, S3_BUCKET } from '@/lib/s3';
import { fileExtensionSchema, fileStorageKey, insertFile, type FileExtension } from '@/lib/db/files.node';
import { ingestExtractedText, markFileFailed, markFileReady } from '@/lib/ai/tools/content-runtime';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';
import { ContentError } from '@/lib/ai/tools/content-errors';
import { getFolderInScope } from '@/lib/db/folders.node';

const key = z.string().cuid();
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'docx', 'pdf']);
const file = z.object({ filename: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(1).max(255), sizeBytes: z.number().int().positive(), extension: fileExtensionSchema }).strict();
export const documentUploadReserveSchema = z.object({ scopeKey: key, folderKey: key.optional(), idempotencyKey: z.string().trim().min(1).max(200), files: z.array(file).min(1).max(20) }).strict();
export const documentUploadCompleteSchema = z.object({ scopeKey: key, uploadKey: key, idempotencyKey: z.string().trim().min(1).max(200), extractedText: z.record(z.string(), z.string()).optional() }).strict();

export class DocumentUploadError extends Error {
  constructor(readonly status: 400 | 404 | 409, readonly code: string, message: string) { super(message); }
}

const URL_TTL = 10 * 60;
const RESERVATION_TTL = 24 * 60 * 60;
const publicS3 = createPublicS3Client();
const signUrl = getSignedUrl as unknown as (client: S3Client, command: PutObjectCommand, options: { expiresIn: number }) => Promise<string>;

function recordKey(uploadKey: string) { return `file-upload:${uploadKey}`; }

function extensionOf(filename: string, mimeType: string): FileExtension {
  const fromName = filename.split('.').at(-1)?.toLowerCase();
  return fileExtensionSchema.parse(fromName);
}

export async function reserveDocumentUpload(raw: unknown, context: ToolContext) {
  const input = documentUploadReserveSchema.parse(raw);
  const userKey = contextUserKey(context);
  if (input.scopeKey !== context.runtimeScopeKey) throw new ContentError('CONTENT_FORBIDDEN', 'Upload scope is not authorized.', 'file.upload', { action: 'authorization' });
  if (input.folderKey) {
    const folder = await getFolderInScope(input.scopeKey, input.folderKey, userKey);
    if (!folder) throw new ContentError('CONTENT_NOT_FOUND', 'Folder was not found.', 'file.upload');
  }
  const files = input.files.map((item) => ({ ...item, extension: item.extension ?? extensionOf(item.filename, item.mimeType), key: newId() }));
  const uploadKey = newId();
  const now = new Date();
  const record = { ...input, uploadKey, userKey, files, status: 'reserved', expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString() };
  if (await redisConnection.set(recordKey(uploadKey), JSON.stringify(record), 'EX', RESERVATION_TTL, 'NX') !== 'OK') throw new DocumentUploadError(409, 'DOCUMENT_UPLOAD_CHANGED', 'Upload reservation collision.');
  const urls = await Promise.all(files.map((item) => signUrl(publicS3, new PutObjectCommand({ Bucket: S3_BUCKET, Key: fileStorageKey(userKey, item.key, item.extension), ContentType: item.mimeType }), { expiresIn: URL_TTL })));
  return { uploadKey, files: files.map((item, index) => ({ fileKey: item.key, url: urls[index]!, headers: { 'Content-Type': item.mimeType } })) };
}

export async function completeDocumentUpload(raw: unknown, context: ToolContext) {
  const input = documentUploadCompleteSchema.parse(raw);
  const userKey = contextUserKey(context);
  const saved = await redisConnection.get(recordKey(input.uploadKey));
  if (!saved) throw new DocumentUploadError(404, 'DOCUMENT_UPLOAD_NOT_FOUND', 'Upload reservation was not found.');
  const record = JSON.parse(saved) as { userKey: string; scopeKey: string; folderKey?: string; files: Array<{ key: string; filename: string; mimeType: string; sizeBytes: number; extension: FileExtension }>; status: string };
  if (record.userKey !== userKey || record.scopeKey !== input.scopeKey || record.scopeKey !== context.runtimeScopeKey) throw new DocumentUploadError(404, 'DOCUMENT_UPLOAD_NOT_FOUND', 'Upload reservation was not found.');
  if (record.status === 'completed') return { files: [] };
  const now = new Date().toISOString();
  const created = [];
  for (const item of record.files) {
    const storageKey = fileStorageKey(userKey, item.key, item.extension);
    const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: storageKey })).catch(() => null);
    if (!head || head.ContentLength !== item.sizeBytes) throw new DocumentUploadError(409, 'DOCUMENT_UPLOAD_MISMATCH', 'Uploaded object is missing or unreadable.');
    const file = await insertFile({
      key: item.key, userKey, scopeKey: record.scopeKey, folderKey: record.folderKey, name: item.filename.replace(/\.[^.]+$/, ''),
      extension: item.extension, mimeType: item.mimeType, sizeBytes: item.sizeBytes, storageKey, processing: 'pending', isFavorite: false, createdAt: now, updatedAt: now,
    });
    created.push(file);
    const extracted = input.extractedText?.[item.key];
    void (async () => {
      try {
        if (extracted && TEXT_EXTENSIONS.has(item.extension)) await ingestExtractedText(item.key, extracted);
        else await markFileReady(item.key);
      } catch {
        await markFileFailed(item.key).catch(() => undefined);
      }
    })();
  }
  await redisConnection.set(recordKey(input.uploadKey), JSON.stringify({ ...record, status: 'completed' }), 'EX', RESERVATION_TTL);
  return { files: created.map((file) => ({ key: file.key, name: file.name, extension: file.extension, processing: file.processing })) };
}
