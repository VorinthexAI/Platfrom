import { z } from 'zod';
import { agentOutputMetadataSchema, type AgentOutputMetadata } from '@/lib/ai/agent-runs';
import { providerIdSchema, type ProviderExecuteResponse } from '@/lib/ai/providers/types';
import { AiError } from '@/lib/ai/shared/result';
import { tokenUsageSchema } from '@/lib/ai/shared/usage';

export class InvalidRunRequestError extends AiError { constructor(detail: string) { super('invalid_run_request', `Invalid agent run request: ${detail}`); } }
export class ResponseValidationError extends AiError { constructor(detail: string) { super('response_validation_failed', `Provider response failed validation: ${detail}`); } }
export const providerResponseEnvelopeSchema = z.object({ output: z.unknown(), usage: tokenUsageSchema, providerId: providerIdSchema, modelId: z.string().min(1), externalModelId: z.string().min(1), rawResponse: z.unknown().optional() }).strict();
const agentOutputEnvelopeSchema = z.object({ metadata: agentOutputMetadataSchema }).passthrough();
export function validateProviderResponse<TOutput>(response: ProviderExecuteResponse<TOutput>) { const parsed = providerResponseEnvelopeSchema.safeParse(response); if (!parsed.success) throw new ResponseValidationError(parsed.error.message); return response; }
export function validateAgentOutput(output: unknown): AgentOutputMetadata { const parsed = agentOutputEnvelopeSchema.safeParse(output); if (!parsed.success) throw new ResponseValidationError(`output.metadata: ${parsed.error.message}`); return parsed.data.metadata; }
