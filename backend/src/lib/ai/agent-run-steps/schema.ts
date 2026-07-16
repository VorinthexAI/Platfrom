import { z } from 'zod';

export const AGENT_RUN_STEPS_COLLECTION = 'agentRunSteps';
export const AGENT_RUN_STEP_STATUSES = ['completed', 'failed', 'skipped'] as const;

export const agentRunStepSchema = z.object({
  key: z.string().cuid(),
  agentRunKey: z.string().cuid(),
  stepSlug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Step slug must use lowercase kebab-case'),
  status: z.enum(AGENT_RUN_STEP_STATUSES),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  elapsedMs: z.number().int().nonnegative(),
}).strict();

export type AgentRunStep = z.infer<typeof agentRunStepSchema>;
export type AgentRunStepStatus = AgentRunStep['status'];
