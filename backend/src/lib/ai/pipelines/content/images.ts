import { executeAction, type ExecuteActionOptions } from '@/lib/ai/router';
import { documentStorage } from '@/lib/ai/document-processing/storage';
import { imageOutputSchema, type ImageOutput } from '@/lib/ai/providers/types';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';
import { planItems, saveCards, sourceText, type ContentPipelineRunInput } from './shared';

export async function runImagesPipeline(context: ToolContext, input: ContentPipelineRunInput, runKey: string, options?: ExecuteActionOptions) {
  const source = await sourceText(context, input.sourceKey, input.sourceKey ? 'scenes' : undefined);
  const prompts = source && input.multiplier === 1
    ? [source.text]
    : await planItems(context.teamKey, `Write distinct 9:16 image prompts. No text in the image. Vary the subject, distance, and light so they cannot look like the same render. ${source ? `Vary this kept scene without copying it: ${source.text}` : `Brief: ${input.brief ?? 'A dark chrome still of someone almost remembering a lost photo.'}`}`, input.multiplier, options);
  const userKey = contextUserKey(context);
  const storageKeys: string[] = [];
  for (const [index, prompt] of prompts.entries()) {
    const response = await executeAction<unknown, ImageOutput>({ mode: 'auto', teamKey: context.teamKey, actionSlug: 'image' }, {
      operation: 'generate', prompt, count: 1, aspectRatio: '9:16', quality: 'low',
    }, { ...options, providers: ['image.secondary'], timeoutMs: 120_000 });
    const image = imageOutputSchema.parse(response.output).images[0]!;
    const storageKey = `inventory/${userKey}/${runKey}-${index}.${image.mimeType === 'image/jpeg' ? 'jpg' : image.mimeType === 'image/webp' ? 'webp' : 'png'}`;
    await documentStorage.upload({ key: storageKey, bytes: Buffer.from(image.base64, 'base64'), mimeType: image.mimeType, billingUserKey: userKey });
    storageKeys.push(storageKey);
  }
  return saveCards(context, 'images', runKey, prompts, source?.key, storageKeys);
}


