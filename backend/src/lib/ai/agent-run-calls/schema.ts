import { z } from 'zod';

export const AGENT_RUN_CALLS_COLLECTION = 'agentRunCalls';
const tokenCountSchema = z.number().int().nonnegative();

export const agentRunCallSchema = z.object({
  key: z.string().cuid(),
  agentRunKey: z.string().cuid(),
  agentRunStepKey: z.string().cuid().nullable(),
  skillKey: z.string().cuid(),
  actionKey: z.string().cuid(),
  modelKey: z.string().cuid(),
  providerKey: z.string().cuid(),
  inputTokens: tokenCountSchema,
  outputTokens: tokenCountSchema,
  totalTokens: tokenCountSchema,
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  elapsedMs: z.number().int().nonnegative(),
}).strict().superRefine((call, ctx) => {
  if (call.totalTokens !== call.inputTokens + call.outputTokens) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['totalTokens'], message: 'totalTokens must equal inputTokens plus outputTokens' });
  }
});

export type AgentRunCall = z.infer<typeof agentRunCallSchema>;
