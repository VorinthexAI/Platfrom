import { z } from 'zod';
import type { ExecuteActionOptions } from '@/lib/ai/router';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { contextUserKey } from '@/lib/ai/tools/tool-context';
import { newId } from '@/lib/ids';
import { getInventoryNode, projectInventoryNode, updateInventoryNode } from '@/lib/db/inventory-nodes.node';
import { runHooksPipeline } from './hooks';
import { runImagesPipeline } from './images';
import { runScenesPipeline } from './scenes';
import { contentPipelineRunInputSchema, type ContentPipelineEvent, type ContentPipelineRunInput } from './shared';
import { runStoriesPipeline } from './stories';
import { runThemesPipeline } from './themes';

const runners = {
  themes: runThemesPipeline,
  hooks: runHooksPipeline,
  stories: runStoriesPipeline,
  scenes: runScenesPipeline,
  images: runImagesPipeline,
} as const;

export async function runContentPipeline(context: ToolContext, raw: unknown, onEvent: (event: ContentPipelineEvent) => Promise<void>, options?: ExecuteActionOptions) {
  const input: ContentPipelineRunInput = contentPipelineRunInputSchema.parse(raw);
  const runKey = newId();
  await onEvent({ type: 'start', runKey, kind: input.kind, multiplier: input.multiplier });
  const nodes = await runners[input.kind](context, input, runKey, options);
  const projected = nodes.map(projectInventoryNode);
  for (const node of projected) await onEvent({ type: 'card', node });
  await onEvent({ type: 'done', runKey, nodes: projected });
  return { runKey, nodes: projected };
}

export const contentPipelineReviewInputSchema = z.object({
  nodeKey: z.string().cuid(),
  decision: z.enum(['kept', 'dropped']),
}).strict();

export async function reviewContentCard(context: ToolContext, raw: unknown) {
  const input = contentPipelineReviewInputSchema.parse(raw);
  const node = await getInventoryNode(input.nodeKey);
  const userKey = contextUserKey(context);
  if (!node || node.scopeKey !== context.runtimeScopeKey || node.userKey !== userKey) throw new Error('The inventory card is not available in this scope.');
  if (node.decision) throw new Error('This card already has one review.');
  const decidedAt = new Date().toISOString();
  const updated = await updateInventoryNode(node.key, { decision: input.decision, decidedAt, updatedAt: decidedAt });
  return projectInventoryNode(updated);
}

export { contentPipelineRunInputSchema, type ContentPipelineEvent };
