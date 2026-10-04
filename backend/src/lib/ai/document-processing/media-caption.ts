import { executeAction } from '@/lib/ai/router';
import { mediaDescriptionInputSchema, mediaDescriptionOutputSchema, type MediaDescriptionOutput } from '@/lib/ai/actions/text';
import { observeToolExecution } from '@/lib/ai/events/runtime';
import { toolEventService } from '@/lib/ai/events/service';
import { storeFileMediaIndex, updateFile, type FileRecord } from '@/lib/db/files.node';
import { embedText } from '@/lib/embeddings';
import { signedMediaDownloadUrl } from '@/lib/media-delivery';
import type { ToolContext } from '@/lib/ai/tools/tool-context';

export function isCaptionableMedia(extension: FileRecord['extension']) {
  return extension === 'jpg' || extension === 'jpeg' || extension === 'png' || extension === 'webp' || extension === 'gif' || extension === 'mp3' || extension === 'mp4' || extension === 'mov';
}

export function mediaCaptionSource(file: Pick<FileRecord, 'extension' | 'storageKey' | 'mimeType'>) {
  return {
    kind: file.extension === 'mp3' ? 'audio' as const : file.extension === 'mp4' || file.extension === 'mov' ? 'video' as const : 'image' as const,
    // OpenRouter advertises video/mov; the stored S3 object retains video/quicktime.
    mimeType: file.extension === 'mov' ? 'video/mov' as const : file.mimeType,
    storageKey: file.storageKey,
  };
}

function mediaEmbeddingText(file: FileRecord, caption: string) {
  const filename = file.name.toLowerCase().endsWith(`.${file.extension}`) ? file.name : `${file.name}.${file.extension}`;
  return `${filename}: ${caption}`;
}

export async function captionUploadedMedia(file: FileRecord, context: ToolContext) {
  return observeToolExecution('file.upload.caption', context, async () => {
    const source = mediaCaptionSource(file);
    const url = await signedMediaDownloadUrl(source.storageKey, 5 * 60);
    const input = mediaDescriptionInputSchema.parse({ operation: 'describe-media', media: { kind: source.kind, mimeType: source.mimeType, url } });
    const response = await executeAction<typeof input, MediaDescriptionOutput>(
      { mode: 'auto', teamKey: context.teamKey, actionSlug: 'text' },
      input,
      { providers: ['text.primary'], timeoutMs: 4 * 60_000, retry: { attempts: 2 } },
    );
    const { caption } = mediaDescriptionOutputSchema.parse(response.output);
    const embedding = await embedText({ text: mediaEmbeddingText(file, caption) });
    return storeFileMediaIndex(file.key, { caption, embedding });
  }, { recorder: toolEventService.record, idempotencyKey: `file-caption:${file.key}`, input: { fileKey: file.key } });
}

export async function processStoredMedia(file: FileRecord, context: ToolContext, options: { spokenText?: string } = {}) {
  try {
    if (options.spokenText !== undefined) {
      if (file.extension !== 'mp3') throw new Error('Source speech text belongs only to generated audio.');
      const embedding = await embedText({ text: mediaEmbeddingText(file, options.spokenText) });
      await storeFileMediaIndex(file.key, { caption: options.spokenText, embedding });
    } else {
      await captionUploadedMedia(file, context);
    }
  } catch (error) {
    console.error('file media processing failed', { fileKey: file.key, extension: file.extension, error });
    await updateFile(file.key, { processing: 'failed' }).catch(() => undefined);
  }
}
