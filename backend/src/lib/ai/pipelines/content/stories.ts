import type { ExecuteActionOptions } from '@/lib/ai/router';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { avoidList, planItems, saveCards, sourceText, type ContentPipelineRunInput } from './shared';

export async function runStoriesPipeline(context: ToolContext, input: ContentPipelineRunInput, runKey: string, options?: ExecuteActionOptions) {
  const source = await sourceText(context, input.sourceKey, input.sourceKey ? 'hooks' : undefined);
  const avoid = await avoidList(context, 'stories');
  const items = await planItems(context.teamKey, `Write distinct story middles. Each item is seven to nine short lines separated by newline characters. The first lines stay in the feeling. Later lines show the relief without naming Storage as a feature. Do not include a download call to action. ${source ? `Continue this hook: ${source.text}` : `Brief: ${input.brief ?? 'Someone almost remembers a photo and cannot find it.'}`}\n${avoid}`, input.multiplier, options);
  return saveCards(context, 'stories', runKey, items, source?.key);
}
