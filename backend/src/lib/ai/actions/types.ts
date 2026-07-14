import { z } from 'zod';
import { DOT_NOTATION_PATTERN } from '@/lib/ai/shared/ids';

/**
 * Every action the execution layer knows about, in `<domain>.<action>` dot
 * notation. Actions describe WHAT must be done — they are provider- and
 * model-independent. This constant is the single source of truth: the
 * `ActionId` type, the zod enum, and the registry integrity checks all
 * derive from it.
 */
export const ACTION_IDS = [
  'core.ask',
  'core.reason',

  'web.search',
  'web.deep-research',

  'image.generate',
  'image.edit',
  'image.create-slideshow',

  'video.generate',
  'video.edit',
  'video.extend',
  'video.analyze',
  'video.create-variation',

  'audio.transcribe',
  'audio.generate-speech',
  'audio.analyze',
  'audio.generate-music',
] as const;

export type ActionId = (typeof ACTION_IDS)[number];

export const actionIdSchema = z.enum(ACTION_IDS);

export interface ActionDefinition {
  id: ActionId;
  name: string;
  description: string;
  /**
   * Whether a failed provider call may be retried on another route after an
   * AMBIGUOUS failure (one where the provider might already have produced a
   * billable output). Generation actions (image/video/music/speech) are
   * false so a fallback can never create duplicate billable artifacts;
   * text-in/text-out actions are true. Failures that provably happen before
   * execution (auth, rate limit, provider down) may fall back regardless.
   */
  safeToRetry: boolean;
}

export const actionDefinitionSchema = z
  .object({
    id: actionIdSchema,
    name: z.string().min(1),
    description: z.string().min(1),
    safeToRetry: z.boolean(),
  })
  .strict();

export function isValidActionIdFormat(id: string): boolean {
  return DOT_NOTATION_PATTERN.test(id);
}
