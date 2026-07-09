import { z } from 'zod';

export const embedInputSchema = z.object({ text: z.string() });

/**
 * Deterministic placeholder embedding: a stable 1536-dim vector derived
 * from the text, so semantic-search plumbing works end to end until a
 * real embedding provider is wired in.
 */
export async function embed(input: z.infer<typeof embedInputSchema>) {
  const parsed = embedInputSchema.parse(input);
  const seed = [...parsed.text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Array.from({ length: 1536 }, (_, index) => ((seed + index) % 997) / 997);
}
