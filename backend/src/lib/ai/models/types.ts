import { z } from 'zod';

export const MODEL_SLUGS = [
  'openai.gpt-5.6-sol',
  'openai.gpt-5.6-terra',
  'openai.gpt-5.6-luna',
  'amazon.nova-premier',
  'amazon.nova-pro',
  'amazon.nova-lite',
  'openai.gpt-realtime-2',
  'openai.gpt-4o-mini-transcribe',
  'amazon.polly-generative',
  'qwen.qwen3-embedding-8b',
  'aws.transcribe-standard',
] as const;
export const modelSlugSchema = z.string().trim().min(1).max(200).regex(/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/, 'Model slug must use lowercase dot or hyphen notation');
export type ModelSlug = z.infer<typeof modelSlugSchema>;
/** Backward-compatible aliases for provider request typing; route relations remain in ArangoDB. */
export const modelIdSchema = modelSlugSchema;
export type ModelId = ModelSlug;
