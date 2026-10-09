import { z } from 'zod';
import { streamAsk, type ExecuteActionOptions } from '@/lib/ai/router';
import { newId } from '@/lib/ids';
import { contextUserKey, type ToolContext } from '@/lib/ai/tools/tool-context';
import { getInventoryNode, insertInventoryNode, listRecentInventoryTexts, nearestInventoryNodes, projectInventoryNode, type InventoryLayer, type InventoryNode } from '@/lib/db/inventory-nodes.node';
import { insertInventoryEdge } from '@/lib/db/inventory-edges.node';

export const contentPipelineKindSchema = z.enum(['themes', 'hooks', 'stories', 'scenes', 'images']);
export const contentPipelineRunInputSchema = z.object({
  kind: contentPipelineKindSchema,
  multiplier: z.number().int().min(1).max(3).default(1),
  brief: z.string().trim().min(1).max(4_000).optional(),
  sourceKey: z.string().cuid().optional(),
}).strict();
export type ContentPipelineRunInput = z.infer<typeof contentPipelineRunInputSchema>;
export type ContentPipelineEvent =
  | { type: 'start'; runKey: string; kind: InventoryLayer; multiplier: number }
  | { type: 'card'; node: ReturnType<typeof projectInventoryNode> }
  | { type: 'done'; runKey: string; nodes: Array<ReturnType<typeof projectInventoryNode>> };

const itemSchema = z.object({ items: z.array(z.string().trim().min(1).max(4_000)).min(1).max(3) }).strict();

export async function planItems(teamKey: string, instruction: string, multiplier: number, options?: ExecuteActionOptions) {
  let text = '';
  for await (const chunk of streamAsk(teamKey, {
    systemPrompt: 'Return strict JSON only, with no markdown, in the form {"items":["..."]}. The items array must contain exactly the requested count. Each item must be distinct.',
    messages: [{ role: 'user', content: [{ type: 'text', text: `${instruction}\n\nCount: ${multiplier}.` }] }],
    options: { temperature: 0.9, maxTokens: 4_000 },
  }, { ...options, providers: ['plan.primary'], capabilities: undefined })) {
    if (chunk.type === 'text-delta') text += chunk.text;
  }
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('The pipeline did not return items.');
  const items = itemSchema.parse(JSON.parse(text.slice(start, end + 1))).items;
  if (items.length < multiplier) throw new Error('The pipeline returned fewer items than requested.');
  return items.slice(0, multiplier);
}

export async function avoidList(context: ToolContext, kind: InventoryLayer) {
  const recent = await listRecentInventoryTexts(context.runtimeScopeKey, contextUserKey(context), kind);
  return recent.length ? `Do not repeat or closely paraphrase any of these:\n${recent.map((item) => `- ${item}`).join('\n')}` : 'No recent items exist yet.';
}

export async function sourceText(context: ToolContext, sourceKey: string | undefined, expected?: InventoryLayer) {
  if (!sourceKey) return undefined;
  const node = await getInventoryNode(sourceKey);
  const userKey = contextUserKey(context);
  if (!node || node.scopeKey !== context.runtimeScopeKey || node.userKey !== userKey) throw new Error('The source card is not available in this scope.');
  if (expected && node.kind !== expected) throw new Error(`The source card must be a ${expected} card.`);
  return node;
}

export async function saveCards(context: ToolContext, kind: InventoryLayer, runKey: string, texts: string[], sourceKey?: string, storageKeys: Array<string | undefined> = []) {
  const userKey = contextUserKey(context);
  const at = new Date().toISOString();
  const saved: InventoryNode[] = [];
  for (const [index, text] of texts.entries()) {
    const node = await insertInventoryNode({
      key: newId(),
      scopeKey: context.runtimeScopeKey,
      userKey,
      kind,
      runKey,
      index,
      text,
      ...(storageKeys[index] ? { storageKey: storageKeys[index] } : {}),
      createdAt: at,
      updatedAt: at,
    });
    if (sourceKey) {
      await insertInventoryEdge({ key: newId(), scopeKey: context.runtimeScopeKey, userKey, kind: kind === 'images' ? 'produced' : 'satisfies', fromKey: node.key, toKey: sourceKey, createdAt: at });
    }
    const neighbors = await nearestInventoryNodes(context.runtimeScopeKey, userKey, kind, node.key, node.embedding);
    for (const neighbor of neighbors) {
      await insertInventoryEdge({ key: newId(), scopeKey: context.runtimeScopeKey, userKey, kind: 'near', fromKey: node.key, toKey: neighbor.key, createdAt: at });
    }
    saved.push(node);
  }
  return saved;
}


