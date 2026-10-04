import { HeadObjectCommand, PutObjectCommand, type S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { z } from 'zod';
import sharp from 'sharp';
import { newId } from '@/lib/ids';
import { redisConnection } from '@/lib/redis';
import { createPublicS3Client, s3, S3_BUCKET } from '@/lib/s3';
import { fileExtensionSchema, fileStorageKey, fileThumbnailStorageKey, insertFile, type FileExtension } from '@/lib/db/files.node';
import { ingestExtractedText, markFileFailed, markFileReady } from '@/lib/ai/tools/content-runtime';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';
import { ContentError } from '@/lib/ai/tools/content-errors';
import { getFolderInScope } from '@/lib/db/folders.node';
import { isCaptionableMedia, processStoredMedia } from './media-caption';
import { documentStorage } from './storage';

const key = z.string().cuid();
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'docx', 'pdf']);
const thumbnail = z.object({ mimeType: z.enum(['image/jpeg', 'image/png']), sizeBytes: z.number().int().positive().max(2 * 1024 * 1024) }).strict();
const file = z.object({ filename: z.string().trim().min(1).max(255), mimeType: z.string().trim().min(1).max(255), sizeBytes: z.number().int().positive(), extension: fileExtensionSchema, thumbnail: thumbnail.optional() }).strict()
  .refine((value) => value.extension !== 'mov' || value.mimeType === 'video/quicktime', 'MOV files require the QuickTime video MIME type.')
  .refine((value) => value.extension !== 'mov' || value.thumbnail?.mimeType === 'image/png', 'MOV files require a PNG preview image.')
  .refine((value) => !value.thumbnail || (isCaptionableMedia(value.extension) && value.extension !== 'mp3'), 'Only image and video files may have thumbnails.');
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

export async function reserveDocumentUpload(raw: unknown, context: ToolContext) {
  const input = documentUploadReserveSchema.parse(raw);
  const userKey = contextUserKey(context);
  if (input.scopeKey !== context.runtimeScopeKey) throw new ContentError('CONTENT_FORBIDDEN', 'Upload scope is not authorized.', 'file.upload', { action: 'authorization' });
  if (input.folderKey) {
    const folder = await getFolderInScope(input.scopeKey, input.folderKey, userKey);
    if (!folder) throw new ContentError('CONTENT_NOT_FOUND', 'Folder was not found.', 'file.upload');
  }
  const files = input.files.map((item) => ({ ...item, key: newId() }));
  const uploadKey = newId();
  const now = new Date();
  const record = { ...input, uploadKey, userKey, files, status: 'reserved', expiresAt: new Date(now.getTime() + 15 * 60_000).toISOString() };
  if (await redisConnection.set(recordKey(uploadKey), JSON.stringify(record), 'EX', RESERVATION_TTL, 'NX') !== 'OK') throw new DocumentUploadError(409, 'DOCUMENT_UPLOAD_CHANGED', 'Upload reservation collision.');
  const urls = await Promise.all(files.map((item) => signUrl(publicS3, new PutObjectCommand({ Bucket: S3_BUCKET, Key: fileStorageKey(userKey, item.key, item.extension), ContentType: item.mimeType }), { expiresIn: URL_TTL })));
  const thumbnailUrls = await Promise.all(files.map((item) => item.thumbnail ? signUrl(publicS3, new PutObjectCommand({ Bucket: S3_BUCKET, Key: fileThumbnailStorageKey(userKey, item.key, item.thumbnail.mimeType), ContentType: item.thumbnail.mimeType }), { expiresIn: URL_TTL }) : undefined));
  return { uploadKey, files: files.map((item, index) => ({ fileKey: item.key, url: urls[index]!, headers: { 'Content-Type': item.mimeType }, ...(thumbnailUrls[index] && item.thumbnail ? { thumbnail: { url: thumbnailUrls[index], headers: { 'Content-Type': item.thumbnail.mimeType } } } : {}) })) };
}

export async function completeDocumentUpload(raw: unknown, context: ToolContext) {
  const input = documentUploadCompleteSchema.parse(raw);
  const userKey = contextUserKey(context);
  const saved = await redisConnection.get(recordKey(input.uploadKey));
  if (!saved) throw new DocumentUploadError(404, 'DOCUMENT_UPLOAD_NOT_FOUND', 'Upload reservation was not found.');
  const record = JSON.parse(saved) as { userKey: string; scopeKey: string; folderKey?: string; files: Array<{ key: string; filename: string; mimeType: string; sizeBytes: number; extension: FileExtension; thumbnail?: z.infer<typeof thumbnail> }>; status: string };
  if (record.userKey !== userKey || record.scopeKey !== input.scopeKey || record.scopeKey !== context.runtimeScopeKey) throw new DocumentUploadError(404, 'DOCUMENT_UPLOAD_NOT_FOUND', 'Upload reservation was not found.');
  if (record.status === 'completed') return { files: [] };
  const now = new Date().toISOString();
  const created = [];
  for (const item of record.files) {
    const storageKey = fileStorageKey(userKey, item.key, item.extension);
    const head = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: storageKey })).catch(() => null);
    if (!head || head.ContentLength !== item.sizeBytes) throw new DocumentUploadError(409, 'DOCUMENT_UPLOAD_MISMATCH', 'Uploaded object is missing or unreadable.');
    const thumbnailStorageKey = item.thumbnail ? fileThumbnailStorageKey(userKey, item.key, item.thumbnail.mimeType) : undefined;
    if (item.thumbnail && thumbnailStorageKey) {
      const thumb = await s3.send(new HeadObjectCommand({ Bucket: S3_BUCKET, Key: thumbnailStorageKey })).catch(() => null);
      if (!thumb || thumb.ContentLength !== item.thumbnail.sizeBytes || thumb.ContentType?.toLowerCase() !== item.thumbnail.mimeType) throw new DocumentUploadError(409, 'DOCUMENT_UPLOAD_MISMATCH', 'Thumbnail is missing or unreadable.');
      const thumbnailBytes = (await documentStorage.download(thumbnailStorageKey)).bytes;
      const metadata = await sharp(thumbnailBytes).metadata().catch(() => null);
      if (!metadata || metadata.format !== (item.thumbnail.mimeType === 'image/png' ? 'png' : 'jpeg') || metadata.width !== 512 || !metadata.height || metadata.height > 8192) throw new DocumentUploadError(409, 'DOCUMENT_UPLOAD_MISMATCH', 'Thumbnail dimensions or format are invalid.');
    }
    const file = await insertFile({
      key: item.key, userKey, scopeKey: record.scopeKey, folderKey: record.folderKey, name: item.filename.replace(/\.[^.]+$/, ''),
      extension: item.extension, mimeType: item.mimeType, sizeBytes: item.sizeBytes, storageKey, ...(thumbnailStorageKey ? { thumbnailStorageKey } : {}), processing: 'pending', isFavorite: false, createdAt: now, updatedAt: now,
    });
    created.push(file);
    const extracted = input.extractedText?.[item.key];
    void (async () => {
      try {
        if (isCaptionableMedia(item.extension)) await processStoredMedia(file, context);
        else if (extracted && TEXT_EXTENSIONS.has(item.extension)) await ingestExtractedText(item.key, extracted);
        else await markFileReady(item.key);
      } catch (error) {
        console.error('file upload processing failed', { fileKey: item.key, extension: item.extension, error });
        await markFileFailed(item.key).catch(() => undefined);
      }
    })();
  }
  await redisConnection.set(recordKey(input.uploadKey), JSON.stringify({ ...record, status: 'completed' }), 'EX', RESERVATION_TTL);
  return { files: created.map((file) => ({ key: file.key, name: file.name, extension: file.extension, processing: file.processing, hasThumbnail: Boolean(file.thumbnailStorageKey) })) };
}
