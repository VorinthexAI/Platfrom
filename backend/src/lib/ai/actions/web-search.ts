import { z } from 'zod';
import type { ActionDefinition } from './types';

const httpsUrlSchema = z.string().url().max(8_000).refine((value) => new URL(value).protocol === 'https:', 'Web search URLs must use HTTPS');

export const webSearchInputSchema = z.object({
  mode: z.enum(['default', 'deep']).optional().default('default'),
  prompt: z.string().trim().min(1).max(32_000),
  responseFormat: z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), schema: z.record(z.unknown()) }).strict().optional(),
}).strict();
export type WebSearchInput = z.input<typeof webSearchInputSchema>;
export type ParsedWebSearchInput = z.output<typeof webSearchInputSchema>;

export const webSearchOutputSchema = z.object({
  text: z.string().trim().min(1).max(50_000),
  citations: z.array(z.object({ title: z.string().trim().min(1).max(500), url: httpsUrlSchema }).strict()).max(100),
  sources: z.array(httpsUrlSchema).max(100),
}).strict();
export type WebSearchOutput = z.infer<typeof webSearchOutputSchema>;

export const webSearchAction: ActionDefinition = { id: 'web-search', modelPolicy: 'required', models: [
  { provider: 'openrouter', model: 'google.gemini-2.5-flash-lite', priority: 100 },
  { provider: 'openai', model: 'openai.gpt-5.6-luna', priority: 90 },
] };
