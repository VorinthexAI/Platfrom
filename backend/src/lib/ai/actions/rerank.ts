import { z } from 'zod';
import type { ActionDefinition } from './types';

export const rerankInputSchema = z.object({
  query: z.string().trim().min(1).max(500),
  documents: z.array(z.string().trim().min(1).max(2_000)).min(2).max(50),
}).strict();

export const rerankOutputSchema = z.object({
  results: z.array(z.object({ index: z.number().int().nonnegative(), relevanceScore: z.number().finite() }).strict()).min(1).max(50),
}).strict();

export type RerankInput = z.infer<typeof rerankInputSchema>;
export type RerankOutput = z.infer<typeof rerankOutputSchema>;

export const rerankAction: ActionDefinition = {
  id: 'rerank', modelPolicy: 'required',
  models: [{ slot: 'primary', provider: 'openrouter', model: 'voyageai.rerank-3-lite', priority: 100 }],
};
