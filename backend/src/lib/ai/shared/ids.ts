import { z } from 'zod';

/** Persisted organization references use the public Arango key contract.
 * The canonical root organization predates CUIDs, so references must accept
 * both its legacy key and CUID keys created for newer organizations. */
export const organizationKeySchema = z.string().trim().min(1);

/** Lowercase dot notation with two or more semantic segments. */
export const DOT_NOTATION_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;

export function isDotNotationId(value: string): boolean {
  return DOT_NOTATION_PATTERN.test(value);
}
