import sharp from 'sharp';
import { newId } from '@/lib/ids';
import { fileStorageKey, fileThumbnailStorageKey, insertFile, type FileExtension } from '@/lib/db/files.node';
import { ingestExtractedText, markFileFailed, markFileReady } from '@/lib/ai/tools/content-runtime';
import { contextUserKey, type ToolContext } from '@/lib/ai/tools/tool-context';
import { documentStorage } from './storage';
import { isCaptionableMedia, processStoredMedia } from './media-caption';

const TEXT_EXTENSIONS = new Set<FileExtension>(['txt', 'md', 'html', 'docx', 'pdf']);

export async function storeProcessedUpload(context: ToolContext, input: { folderKey: string; name: string; bytes: Uint8Array; extension: FileExtension; mimeType: string; extractedText?: string }) {
  const userKey = contextUserKey(context);
  const key = newId();
  const storageKey = fileStorageKey(userKey, key, input.extension);
  const thumbnailStorageKey = input.extension === 'png' || input.extension === 'jpeg' || input.extension === 'jpg' || input.extension === 'webp' ? fileThumbnailStorageKey(userKey, key) : undefined;
  const now = new Date().toISOString();
  await documentStorage.upload({ key: storageKey, bytes: input.bytes, mimeType: input.mimeType, billingUserKey: userKey });
  if (thumbnailStorageKey) {
    const thumbnail = await sharp(input.bytes).resize({ width: 512 }).jpeg({ quality: 82 }).toBuffer();
    await documentStorage.upload({ key: thumbnailStorageKey, bytes: thumbnail, mimeType: 'image/jpeg', billingUserKey: userKey });
  }
  try {
    const file = await insertFile({
      key, userKey, scopeKey: context.runtimeScopeKey, folderKey: input.folderKey, name: input.name.slice(0, 100),
      extension: input.extension, mimeType: input.mimeType, sizeBytes: input.bytes.byteLength, storageKey,
      ...(thumbnailStorageKey ? { thumbnailStorageKey } : {}), processing: 'pending', isFavorite: false, isHidden: false, createdAt: now, updatedAt: now,
    });
    void (async () => {
      try {
        if (isCaptionableMedia(input.extension)) await processStoredMedia(file, context);
        else if (input.extractedText && TEXT_EXTENSIONS.has(input.extension)) await ingestExtractedText(file.key, input.extractedText);
        else await markFileReady(file.key);
      } catch (error) {
        console.error('stored upload processing failed', { fileKey: file.key, extension: input.extension, error });
        await markFileFailed(file.key).catch(() => undefined);
      }
    })();
    return file;
  } catch (error) {
    await Promise.all([storageKey, thumbnailStorageKey].filter((value): value is string => Boolean(value)).map((value) => documentStorage.delete(value).catch(() => undefined)));
    throw error;
  }
}
