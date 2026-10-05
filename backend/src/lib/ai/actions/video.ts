import { z } from 'zod';
import type { ActionDefinition } from './types';

export const videoInputSchema = z.object({
  prompt: z.string().trim().min(1).max(4_000),
  durationSeconds: z.number().int().min(5).max(15),
  aspectRatio: z.enum(['16:9', '9:16', '1:1', '4:3', '3:4', '3:2', '2:3']),
  startFrame: z.string().regex(/^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+={0,2}$/).max(28 * 1024 * 1024).optional(),
  jobKey: z.string().regex(/^[a-f0-9]{64}$/).optional(),
}).strict();
export const videoOutputSchema = z.object({ bytes: z.instanceof(Uint8Array).refine((bytes) => bytes.length > 0), mimeType: z.literal('video/mp4'), durationSeconds: z.number().int().min(5).max(15) }).strict();
export type VideoInput = z.infer<typeof videoInputSchema>;
export type VideoOutput = z.infer<typeof videoOutputSchema>;
export const videoAction: ActionDefinition = { id: 'video', modelPolicy: 'required', models: [{ slot: 'primary', provider: 'openrouter', model: 'xai.grok-imagine-video-1.5', priority: 100 }] };
