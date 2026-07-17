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

/**
 * Immutable authorization snapshot captured when the run was admitted, so
 * audits stay historically accurate even after roles, grants, or thresholds
 * change. Identifiers and role tokens only — never secrets.
 */
export const agentRunAuthorizationSchema = z.object({
  actorType: z.enum(['user', 'system']),
  initiatingUserKey: z.string().cuid().nullable(),
  initiatingUserOrganizationKey: z.string().cuid().nullable(),
  organizationKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  scopeAgentKey: z.string().cuid().nullable(),
  effectiveRole: z.enum(['owner', 'admin', 'moderator', 'viewer']).nullable(),
  accessSources: z.array(z.enum(['inherited', 'explicit', 'system'])),
  delegatedViaAgentKey: z.string().cuid().nullable().default(null),
  authorizationCheckedAt: z.string().datetime(),
}).strict();

export type AgentRunAuthorization = z.infer<typeof agentRunAuthorizationSchema>;

export const agentRunObjectSchema = z.object({
  key: z.string().cuid(),
  organizationKey: z.string().cuid(),
  scopeKey: z.string().cuid(),
  agentKey: z.string().cuid(),
  principalType: z.enum(['member', 'system']).default('system'),
  userOrganizationKey: z.string().cuid().nullable().default(null),
  authorization: agentRunAuthorizationSchema.nullable().default(null),
  status: z.enum(AGENT_RUN_STATUSES),
  reason: maxTenWordsSchema,
  score: z.number().min(0).max(1),
  startedAt: z.string().datetime(),
  endedAt: z.string().datetime(),
  elapsedMs: z.number().int().nonnegative(),
  createdAt: z.string().datetime(),
}).strict();

export const agentRunSchema = agentRunObjectSchema.superRefine((run, ctx) => {
  if (run.principalType === 'member' && run.userOrganizationKey === null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['userOrganizationKey'], message: 'Member runs require userOrganizationKey' });
  }
  if (run.principalType === 'system' && run.userOrganizationKey !== null) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['userOrganizationKey'], message: 'System runs cannot reference userOrganizationKey' });
  }
});

export type AgentOutputMetadata = z.infer<typeof agentOutputMetadataSchema>;
export type AgentRun = z.infer<typeof agentRunSchema>;
export type AgentRunStatus = AgentRun['status'];
