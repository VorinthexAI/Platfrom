import { z } from 'zod';

export const AGENT_RUNS_COLLECTION = 'agentRuns';
export const AGENT_RUN_STATUSES = ['accepted', 'rejected', 'completed', 'failed', 'cancelled', 'timeout'] as const;

export const maxTenWordsSchema = z.string().trim().min(1).refine(
  (value) => value.split(/\s+/).length <= 10,
  'Reason must contain at most ten words',
);

export const agentOutputMetadataSchema = z.object({
  status: z.enum(['accepted', 'rejected']),
  reason: maxTenWordsSchema,
  score: z.number().min(0).max(1),
}).strict();

export const agentRunSchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  agentKey: z.string().cuid(),
  status: z.enum(AGENT_RUN_STATUSES),
  reason: maxTenWordsSchema,
  score: z.number().min(0).max(1),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  elapsedMs: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
}).strict();

export type AgentOutputMetadata = z.infer<typeof agentOutputMetadataSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type AgentRunStatus = AgentRun['status'];
