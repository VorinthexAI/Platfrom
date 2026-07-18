import { z } from 'zod';

/** Persisted organization references use the public CUID key contract. */
export const organizationKeySchema = z.string().cuid();

/** Lowercase dot notation with two or more semantic segments. */
export const DOT_NOTATION_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;

export function isDotNotationId(value: string): boolean {
  return DOT_NOTATION_PATTERN.test(value);
}
