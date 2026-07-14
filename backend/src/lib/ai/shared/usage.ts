import { z } from 'zod';

/** Normalized token usage every provider adapter must return — callers never parse provider-specific usage fields. */
export const tokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});

export type TokenUsage = z.infer<typeof tokenUsageSchema>;

export const ZERO_TOKEN_USAGE: TokenUsage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

/**
 * Builds a normalized usage object from whatever a provider reported.
 * Missing counts become 0; a missing total is derived from input + output.
 */
export function tokenUsage(inputTokens?: number | null, outputTokens?: number | null, totalTokens?: number | null): TokenUsage {
  const input = typeof inputTokens === 'number' && Number.isFinite(inputTokens) ? Math.max(0, Math.round(inputTokens)) : 0;
  const output = typeof outputTokens === 'number' && Number.isFinite(outputTokens) ? Math.max(0, Math.round(outputTokens)) : 0;
  const total = typeof totalTokens === 'number' && Number.isFinite(totalTokens) ? Math.max(0, Math.round(totalTokens)) : input + output;
  return { inputTokens: input, outputTokens: output, totalTokens: total };
}
