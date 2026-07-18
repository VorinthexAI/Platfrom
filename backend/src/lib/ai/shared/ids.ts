import { z } from 'zod';

/** Public Arango keys may predate the current CUID generator. */
export const persistedKeySchema = z.string().trim().min(1);

/** The canonical root organization uses one of those preserved legacy keys. */
export const organizationKeySchema = persistedKeySchema;

/** Lowercase dot notation with two or more semantic segments. */
export const DOT_NOTATION_PATTERN = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\.[a-z][a-z0-9]*(?:-[a-z0-9]+)*)+$/;

export function isDotNotationId(value: string): boolean {
  return DOT_NOTATION_PATTERN.test(value);
}
