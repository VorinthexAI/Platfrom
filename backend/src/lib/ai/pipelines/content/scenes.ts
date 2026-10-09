import type { ExecuteActionOptions } from '@/lib/ai/router';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { avoidList, planItems, saveCards, sourceText, type ContentPipelineRunInput } from './shared';

export async function runScenesPipeline(context: ToolContext, input: ContentPipelineRunInput, runKey: string, options?: ExecuteActionOptions) {
  const source = await sourceText(context, input.sourceKey, input.sourceKey ? 'stories' : undefined);
  const avoid = await avoidList(context, 'scenes');
  const items = await planItems(context.teamKey, `Write distinct image instructions for a 9:16 faceless slideshow frame. No text in the image. No logos. Dark, premium, metallic, and specific enough that two instructions cannot produce the same picture. ${source ? `Illustrate this story:\n${source.text}` : `Brief: ${input.brief ?? 'A person almost remembering a photo they cannot find.'}`}\n${avoid}`, input.multiplier, options);
  return saveCards(context, 'scenes', runKey, items, source?.key);
}
