import { z } from 'zod';
import type { ActionId } from '@/lib/ai/actions/types';
import { providerIdSchema, type ProviderExecuteResponse } from '@/lib/ai/providers/types';
import { tokenUsageSchema } from '@/lib/ai/shared/usage';
import { AiError } from '@/lib/ai/shared/result';
import type { AgentRunOutputMetadata } from '@/lib/ai/agent-runs/schema';

export class ResponseValidationError extends AiError {
  constructor(detail: string) {
    super('response_validation_failed', `Provider response failed validation: ${detail}`);
  }
}

/** The normalized envelope every provider response must satisfy before a run is recorded. */
export const providerResponseEnvelopeSchema = z.object({
  output: z.unknown(),
  usage: tokenUsageSchema,
  providerId: providerIdSchema,
  modelId: z.string().min(1),
  externalModelId: z.string().min(1),
  rawResponse: z.unknown().optional(),
});

/**
 * Validation stage of the pipeline: the response envelope (normalized
 * usage, known provider, model ids) is checked BEFORE the run ledger is
 * written or the output returned to the agent.
 */
export function validateProviderResponse<TOutput>(response: ProviderExecuteResponse<TOutput>): ProviderExecuteResponse<TOutput> {
  const parsed = providerResponseEnvelopeSchema.safeParse(response);
  if (!parsed.success) {
    throw new ResponseValidationError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }
  return response;
}

/**
 * Derives the output METADATA recorded in agentRuns — shape facts only
 * (kind, stop reason, item count), never the generated content itself.
 */
export function buildOutputMetadata(actionId: ActionId, output: unknown): AgentRunOutputMetadata {
  let stopReason: string | null = null;
  let itemCount: number | null = null;
  if (typeof output === 'object' && output !== null) {
    const record = output as Record<string, unknown>;
    if (typeof record.stopReason === 'string') stopReason = record.stopReason;
    if (Array.isArray(record.images)) itemCount = record.images.length;
    if (Array.isArray(record.toolCalls) && record.toolCalls.length > 0) itemCount = record.toolCalls.length;
  }
  return { type: actionId, stopReason, itemCount };
}
