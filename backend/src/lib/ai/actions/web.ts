import { z } from 'zod';
import type { ActionDefinition } from './types';

const httpsUrlSchema = z.string().url().max(8_000).refine((value) => new URL(value).protocol === 'https:', 'Web search URLs must use HTTPS');
export const webInputSchema = z.object({
  mode: z.enum(['default', 'deep']).optional().default('default'),
  prompt: z.string().trim().min(1).max(32_000),
  responseFormat: z.object({ name: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/), schema: z.record(z.unknown()) }).strict().optional(),
}).strict();
export type WebInput = z.input<typeof webInputSchema>;
export type ParsedWebInput = z.output<typeof webInputSchema>;
export const webOutputSchema = z.object({
  text: z.string().trim().min(1).max(50_000),
  citations: z.array(z.object({ title: z.string().trim().min(1).max(500), url: httpsUrlSchema }).strict()).max(100),
  sources: z.array(httpsUrlSchema).max(100),
}).strict();
export type WebOutput = z.infer<typeof webOutputSchema>;
export const webAction: ActionDefinition = { id: 'web', modelPolicy: 'required', models: [{ slot: 'primary', provider: 'openrouter', model: 'google.gemini-3.1-flash-lite-preview', priority: 100 }] };
