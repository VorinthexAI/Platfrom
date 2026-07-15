import { z } from 'zod';
import { providerIdSchema, type ProviderExecuteResponse } from '@/lib/ai/providers/types';
import { AiError } from '@/lib/ai/shared/result';
import { tokenUsageSchema } from '@/lib/ai/shared/usage';

export class ResponseValidationError extends AiError {
  constructor(detail: string) {
    super('response_validation_failed', `Provider response failed validation: ${detail}`);
  }
}

export const providerResponseEnvelopeSchema = z.object({
  output: z.unknown(),
  usage: tokenUsageSchema,
  providerId: providerIdSchema,
  modelId: z.string().min(1),
  externalModelId: z.string().min(1),
  rawResponse: z.unknown().optional(),
});

export function validateProviderResponse<TOutput>(response: ProviderExecuteResponse<TOutput>): ProviderExecuteResponse<TOutput> {
  const parsed = providerResponseEnvelopeSchema.safeParse(response);
  if (!parsed.success) {
    throw new ResponseValidationError(parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '));
  }
  return response;
}
