import { z } from 'zod';
import { DOT_NOTATION_PATTERN } from '@/lib/ai/shared/ids';

/**
 * Stable, provider- and domain-neutral runtime primitives. Workflows,
 * authorization and domain capabilities are enforced at direct action boundaries.
 */
export const ACTION_SLUGS = [
  'ask', 'chat', 'orchestrator-chat', 'reason', 'deep-reason', 'embed', 'speak', 'transcribe', 'web-search',
  'traverse', 'read', 'insert', 'upsert', 'update', 'delete',
  'generate-image', 'edit-image',
  'generate-video', 'edit-video', 'extend-video', 'analyze-video',
  'generate-speech', 'analyze-audio', 'generate-music',
] as const;

export type ActionId = (typeof ACTION_SLUGS)[number] | (string & {});

// Runtime validation remains the closed primitive set. The widened annotation
// keeps historical fixtures readable while persisted writes still parse here.
export const actionIdSchema = z.enum(ACTION_SLUGS) as z.ZodType<ActionId> & { options: typeof ACTION_SLUGS };

export function isValidActionIdFormat(id: string): boolean {
  return /^[a-z]+(?:-[a-z]+)*$/.test(id) && !DOT_NOTATION_PATTERN.test(id);
}
