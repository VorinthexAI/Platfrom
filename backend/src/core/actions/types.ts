import { z } from 'zod';

export type ActionResult<T> = Promise<T>;

export const actionStepSchema = z.object({
  action_slug: z.string(),
  order: z.number().int().positive(),
});

export type ActionStep = z.infer<typeof actionStepSchema>;

