import { z } from 'zod';
import { nodeTypeSchema } from '@/lib/ai/agent-run-sources';

const metadataValueSchema = z.union([
  z.string().max(2_000),
  z.number().finite(),
  z.boolean(),
  z.null(),
  z.array(z.union([z.string().max(500), z.number().finite(), z.boolean(), z.null()])).max(100),
]);

export const knowledgeBlockSchema = z.object({
  nodeType: nodeTypeSchema,
  nodeKey: z.string().cuid(),
  title: z.string().trim().min(1).max(240),
  summary: z.string().trim().min(1).max(2_000),
  content: z.string().trim().max(20_000).nullable(),
  metadata: z.record(metadataValueSchema),
}).strict();
export type KnowledgeBlock = z.infer<typeof knowledgeBlockSchema>;

export const searchableNodeSchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().cuid(),
  scopeKey: z.string().cuid().nullable(),
  embedding: z.array(z.number().finite()).min(1),
  embeddingFields: z.array(z.string().trim().min(1).max(120)).min(1),
  fields: z.record(z.string()),
  updatedAt: z.string().datetime().nullable().default(null),
}).strict().superRefine((node, ctx) => {
  const declared = new Set(node.embeddingFields);
  for (const field of Object.keys(node.fields)) {
    if (!declared.has(field)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields', field], message: 'fields may contain only embeddingFields' });
  }
  for (const field of declared) {
    if (!(field in node.fields)) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['fields', field], message: 'every embeddingField must have a normalized value' });
  }
});
export type SearchableNode = z.infer<typeof searchableNodeSchema>;

export const knowledgePackSchema = z.object({
  query: z.string().trim().min(1),
  blocks: z.array(knowledgeBlockSchema),
  budget: z.object({
    limitTokens: z.number().int().positive(),
    estimatedTokens: z.number().int().nonnegative(),
    compressedBlocks: z.number().int().nonnegative(),
    droppedBlocks: z.number().int().nonnegative(),
  }).strict(),
}).strict();
export type KnowledgePack = z.infer<typeof knowledgePackSchema>;

/** Removes storage internals and non-scalar metadata before an LLM can see it. */
export function normalizeKnowledgeBlock(input: KnowledgeBlock): KnowledgeBlock {
  const parsed = knowledgeBlockSchema.parse(input);
  const metadata = Object.fromEntries(Object.entries(parsed.metadata).filter(([key]) => !key.startsWith('_') && key !== 'embedding' && key !== 'embeddingFields'));
  return knowledgeBlockSchema.parse({ ...parsed, metadata });
}
