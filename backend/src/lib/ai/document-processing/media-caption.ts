import { executeAction } from '@/lib/ai/router';
import { mediaDescriptionInputSchema, mediaDescriptionOutputSchema, type MediaDescriptionOutput } from '@/lib/ai/actions/text';
import { observeToolExecution } from '@/lib/ai/events/runtime';
import { toolEventService } from '@/lib/ai/events/service';
import { storeFileMediaIndex, updateFile, type FileRecord } from '@/lib/db/files.node';
import { embedText } from '@/lib/embeddings';
import { signedMediaDownloadUrl } from '@/lib/media-delivery';
import type { ToolContext } from '@/lib/ai/tools/tool-context';

export function isCaptionableMedia(extension: FileRecord['extension']) {
  return extension === 'jpg' || extension === 'jpeg' || extension === 'png' || extension === 'webp' || extension === 'gif' || extension === 'mp3' || extension === 'mp4';
}

export async function captionUploadedMedia(file: FileRecord, context: ToolContext) {
  return observeToolExecution('file.upload.caption', context, async () => {
    const kind = file.extension === 'mp3' ? 'audio' : file.extension === 'mp4' ? 'video' : 'image';
    const url = await signedMediaDownloadUrl(file.storageKey, 5 * 60);
    const input = mediaDescriptionInputSchema.parse({ operation: 'describe-media', media: { kind, mimeType: file.mimeType, url } });
    const response = await executeAction<typeof input, MediaDescriptionOutput>(
      { mode: 'auto', teamKey: context.teamKey, actionSlug: 'text' },
      input,
      { providers: ['text.primary'], timeoutMs: 4 * 60_000, retry: { attempts: 2 } },
    );
    const { caption } = mediaDescriptionOutputSchema.parse(response.output);
    const embedding = await embedText({ text: caption });
    return storeFileMediaIndex(file.key, { caption, embedding });
  }, { recorder: toolEventService.record, idempotencyKey: `file-caption:${file.key}`, input: { fileKey: file.key } });
}

export async function processStoredMedia(file: FileRecord, context: ToolContext, options: { spokenText?: string } = {}) {
  try {
    if (options.spokenText !== undefined) {
      if (file.extension !== 'mp3') throw new Error('Source speech text belongs only to generated audio.');
      const embedding = await embedText({ text: options.spokenText });
      await storeFileMediaIndex(file.key, { caption: options.spokenText, embedding });
    } else {
      await captionUploadedMedia(file, context);
    }
  } catch (error) {
    console.error('file media processing failed', { fileKey: file.key, extension: file.extension, error });
    await updateFile(file.key, { processing: 'failed' }).catch(() => undefined);
  }
}
