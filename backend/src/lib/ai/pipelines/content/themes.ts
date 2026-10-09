import type { ExecuteActionOptions } from '@/lib/ai/router';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { avoidList, planItems, saveCards, type ContentPipelineRunInput } from './shared';

export async function runThemesPipeline(context: ToolContext, input: ContentPipelineRunInput, runKey: string, options?: ExecuteActionOptions) {
  const avoid = await avoidList(context, 'themes');
  const items = await planItems(context.teamKey, `Write distinct content requirements. Each item is one sentence naming the feeling, the rule, and the ending. Do not name product features. Brief: ${input.brief ?? 'A personal AI that helps someone find work they already kept.'}\n${avoid}`, input.multiplier, options);
  return saveCards(context, 'themes', runKey, items);
}
