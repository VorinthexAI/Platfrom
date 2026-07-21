import { z } from 'zod';

/** V1 guardrails carry only the effective persisted scope key. */
export const guardrailSchema = z.object({
  scopeId: z.string().cuid(),
}).strict();

export type Guardrail = z.infer<typeof guardrailSchema>;
