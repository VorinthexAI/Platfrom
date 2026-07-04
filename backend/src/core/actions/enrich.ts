import { z } from 'zod';
import { get_model } from './get_model';

export const enrichInputSchema = z.object({
  input: z.string(),
  context: z.string().optional(),
});

export async function enrich(input: z.infer<typeof enrichInputSchema>) {
  const parsed = enrichInputSchema.parse(input);
  const model = await get_model({ category: 'reasoning', level: 'high' });
  return [
    '# Core question',
    parsed.input,
    '# Full context',
    parsed.context ?? '',
    '# Scope',
    'Use the provided context and preserve tenant boundaries.',
    '# Ambiguities',
    'None identified by the deterministic fallback.',
    '# Success criteria',
    `Prepared with ${model}.`,
  ].join('\n\n');
}

