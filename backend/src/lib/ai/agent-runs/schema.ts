import { z } from 'zod';
import { actionIdSchema } from '@/lib/ai/actions/types';
import { providerIdSchema } from '@/lib/ai/providers/types';
import { organizationIdSchema } from '@/lib/ai/shared/ids';
import { tokenUsageSchema } from '@/lib/ai/shared/usage';
import { routingStrategySchema } from '@/lib/ai/router/types';

/** Execution ledger for the agent framework. Collection name fixed by spec. */
export const AGENT_RUNS_COLLECTION = 'agent_runs';

export const AGENT_RUN_STATUSES = ['running', 'succeeded', 'failed'] as const;

export type AgentRunStatus = (typeof AGENT_RUN_STATUSES)[number];

/** One recorded pipeline step: what happened, when, and how long it took. */
export const agentRunStepSchema = z.object({
  index: z.number().int().nonnegative(),
  type: z.enum(['route-selected', 'provider-executed', 'provider-failed']),
  at: z.string().min(1),
  durationMs: z.number().int().nonnegative().optional(),
  modelId: z.string().min(1).optional(),
  providerId: providerIdSchema.optional(),
  externalModelId: z.string().min(1).optional(),
  score: z.number().optional(),
  errorCode: z.string().min(1).optional(),
});

export type AgentRunStep = z.infer<typeof agentRunStepSchema>;

/** Output METADATA only — the run ledger never stores generated content or raw payloads. */
export const agentRunOutputMetadataSchema = z.object({
  type: actionIdSchema,
  stopReason: z.string().nullable().default(null),
  itemCount: z.number().int().nonnegative().nullable().default(null),
});

export type AgentRunOutputMetadata = z.infer<typeof agentRunOutputMetadataSchema>;

/**
 * One agent tool execution: metadata, normalized token usage, timing,
 * steps, and output metadata. Model/provider/permission DATA is never
 * duplicated here — only ids that point back into the registries and the
 * organization allow-list. Parses in zod strip mode (DB document); the
 * public primary-key field is `key`, never `_key`.
 */
export const agentRunSchema = z.object({
  key: z.string().min(1),
  organizationId: organizationIdSchema,
  agentId: z.string().min(1),
  toolId: z.string().min(1),
  actionId: actionIdSchema,

  status: z.enum(AGENT_RUN_STATUSES),

  /** Ids only — the route that actually executed (post-fallback). */
  modelId: z.string().min(1).nullable().default(null),
  providerId: providerIdSchema.nullable().default(null),
  externalModelId: z.string().min(1).nullable().default(null),
  strategy: routingStrategySchema.nullable().default(null),

  usage: tokenUsageSchema.default({ inputTokens: 0, outputTokens: 0, totalTokens: 0 }),
  steps: z.array(agentRunStepSchema).default([]),
  output: agentRunOutputMetadataSchema.nullable().default(null),
  error: z
    .object({ code: z.string().min(1), message: z.string().min(1) })
    .nullable()
    .default(null),

  startedAt: z.string().min(1),
  finishedAt: z.string().min(1).nullable().default(null),
  durationMs: z.number().int().nonnegative().nullable().default(null),

  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
});

export type AgentRun = z.infer<typeof agentRunSchema>;
