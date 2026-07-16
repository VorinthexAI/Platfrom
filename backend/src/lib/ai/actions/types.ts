import { z } from 'zod';
import { DOT_NOTATION_PATTERN } from '@/lib/ai/shared/ids';

/**
 * Every action the execution layer knows about, in `<domain>.<action>` dot
 * notation. Actions describe WHAT must be done — they are provider- and
 * model-independent. This constant is the single source of truth: the
 * `ActionId` type, the zod enum, and the registry integrity checks all
 * derive from it.
 */
export const ACTION_SLUGS = [
  'core.ask',
  'core.reason',

  'agent.create',

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

export type ActionId = (typeof ACTION_SLUGS)[number];

export const actionIdSchema = z.enum(ACTION_SLUGS);

export function isValidActionIdFormat(id: string): boolean {
  return DOT_NOTATION_PATTERN.test(id);
}
