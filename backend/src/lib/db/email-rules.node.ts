import { z } from 'zod';
import { currentEmbeddingSchema } from '@/lib/embeddings';
import { createNodeHelpers } from './base';

export const EMAIL_RULES_COLLECTION = 'emailRules';
const text = z.string().trim().min(1);
export const emailRuleSchema = z.object({
  key: z.string().cuid(), scopeKey: z.string().cuid(), name: text, description: text, condition: text, instruction: text,
  action: z.enum(['prioritize', 'filter', 'draft_reply', 'auto_reply']), config: z.record(z.string(), z.unknown()), isEnabled: z.boolean(),
  embedding: currentEmbeddingSchema, createdAt: z.string().datetime(), updatedAt: z.string().datetime(),
});
export type EmailRule = z.infer<typeof emailRuleSchema>;
export const emailRulesEmbeddingFields = ['name', 'description', 'condition', 'instruction'] as const;
const helpers = createNodeHelpers(EMAIL_RULES_COLLECTION, emailRuleSchema, emailRulesEmbeddingFields, { includeEmbeddingMetadata: false });
export const insertEmailRule = helpers.insert;
export const getEmailRuleById = helpers.getById;
export const updateEmailRule = helpers.updateById;
export const deleteEmailRule = helpers.deleteById;
export const upsertEmailRuleByKey = helpers.upsertByKey;
export const getAllEmailRulesChunked = helpers.getAllChunked;
export const listEmailRulesPage = helpers.listPage;
