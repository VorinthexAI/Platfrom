import { z } from 'zod';
import type { ActionDefinition } from './types';

export const decisionInputSchema = z.object({
  state: z.string().trim().min(1).max(32_000),
  questions: z.record(z.string().regex(/^[a-z][a-z0-9-]*$/), z.object({
    type: z.literal('choice'),
    instructions: z.string().trim().min(1),
    criteria: z.record(z.string().min(1), z.string().trim().min(1)),
  }).strict()),
}).strict();

export const decisionOutputSchema = z.object({
  answers: z.record(z.string(), z.object({ type: z.literal('choice'), choice: z.string(), probabilities: z.record(z.string(), z.number()).optional() }).passthrough()),
}).passthrough();

export const decideAction: ActionDefinition = {
  id: 'decide', modelPolicy: 'required',
  models: [{ slot: 'primary', provider: 'openrouter', model: 'typesafe.jev-1.13', priority: 100 }],
};
