import { z } from 'zod';
import type { ActionDefinition } from './types';

const signedMediaUrlSchema = z.string().url().refine((url) => new URL(url).protocol === 'https:' || new URL(url).protocol === 'http:', 'Media URL must use HTTP or HTTPS');
export const mediaDescriptionInputSchema = z.object({
  operation: z.literal('describe-media'),
  media: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('image'), url: signedMediaUrlSchema, mimeType: z.enum(['image/jpeg', 'image/png', 'image/webp', 'image/gif']) }).strict(),
    z.object({ kind: z.literal('video'), url: signedMediaUrlSchema, mimeType: z.enum(['video/mp4', 'video/mov']) }).strict(),
    z.object({ kind: z.literal('audio'), url: signedMediaUrlSchema, mimeType: z.literal('audio/mpeg') }).strict(),
  ]),
}).strict();
export type MediaDescriptionInput = z.infer<typeof mediaDescriptionInputSchema>;
export const mediaDescriptionOutputSchema = z.object({ caption: z.string().trim().min(1).max(20_000) }).strict();
export type MediaDescriptionOutput = z.infer<typeof mediaDescriptionOutputSchema>;

export const textAction: ActionDefinition = {
  id: 'text',
  modelPolicy: 'required',
  models: [
    { slot: 'primary', provider: 'openrouter', model: 'google.gemini-3.1-flash-lite', priority: 100 },
    { slot: 'secondary', provider: 'openrouter', model: 'openai.gpt-6-luna', priority: 90 },
  ],
};
