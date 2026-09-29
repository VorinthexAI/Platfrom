import { z } from 'zod';

export const SCOPES_COLLECTION = 'scopes';

export const scopeSlugSchema = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/);

export const scopeSchema = z.object({
  key: z.string().cuid(),
  userKey: z.string().cuid(),
  slug: scopeSlugSchema,
  name: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1),
  description: z.string().trim().min(1).nullable(),
  coverFileKey: z.string().cuid().nullable().optional(),
  position: z.number().int().positive(),
  embedding: z.array(z.number().finite()).default([]),
});

export type Scope = z.infer<typeof scopeSchema>;
export const scopesEmbedKeys = z.enum(['summary']);
