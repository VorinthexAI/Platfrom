import { z } from 'zod';

/**
 * Organization ids are CUID2s for every organization created through the
 * current backend, but legacy keys copied across from the platform era are
 * not guaranteed to match the CUID2 alphabet — so the runtime contract is
 * only "non-empty string", never `.cuid()`/`.cuid2()` (which would reject
 * live documents).
 */
export const organizationIdSchema = z.string().min(1);

/**
 * `<domain>.<action>` dot notation shared by action ids and internal model
 * ids: lowercase kebab-case segments joined by a single dot.
 */
export const DOT_NOTATION_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

export function isDotNotationId(value: string): boolean {
  return DOT_NOTATION_PATTERN.test(value);
}
