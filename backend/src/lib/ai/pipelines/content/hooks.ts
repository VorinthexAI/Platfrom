import type { ExecuteActionOptions } from '@/lib/ai/router';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { avoidList, planItems, saveCards, sourceText, type ContentPipelineRunInput } from './shared';

export async function runHooksPipeline(context: ToolContext, input: ContentPipelineRunInput, runKey: string, options?: ExecuteActionOptions) {
  const source = await sourceText(context, input.sourceKey, input.sourceKey ? 'themes' : undefined);
  const avoid = await avoidList(context, 'hooks');
  const items = await planItems(context.teamKey, `Write distinct opening hooks. One sentence each. The hook carries the feeling. Do not explain the product. ${source ? `Satisfy this theme: ${source.text}` : `Brief: ${input.brief ?? 'The feeling of almost remembering something you cannot find.'}`}\n${avoid}`, input.multiplier, options);
  return saveCards(context, 'hooks', runKey, items, source?.key);
}
