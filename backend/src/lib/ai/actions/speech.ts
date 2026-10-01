import { z } from 'zod';
import type { ActionDefinition } from './types';

export const speechInputSchema = z.object({
  text: z.string().trim().min(1).max(15_000),
  voice: z.enum(['eve', 'ara', 'rex', 'sal', 'leo']),
  format: z.literal('mp3'),
}).strict();
export const speechOutputSchema = z.object({ base64: z.string().min(1), mimeType: z.literal('audio/mpeg'), durationSeconds: z.number().int().positive().optional() }).strict();
export type SpeechInput = z.input<typeof speechInputSchema>;
export type SpeechOutput = z.output<typeof speechOutputSchema>;
export const speechAction: ActionDefinition = { id: 'speech', modelPolicy: 'required', models: [{ slot: 'primary', provider: 'openrouter', model: 'xai.grok-voice-tts-1.0', priority: 100 }] };
