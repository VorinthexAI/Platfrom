import { z } from 'zod';
import { searchOutputs } from '@/lib/db/outputs.node';

export const searchOutputInputSchema = z.object({
  type: z.string().optional(),
  limit: z.number().int().positive().max(100).default(20),
});

export async function search_output(input: z.infer<typeof searchOutputInputSchema>) {
  const parsed = searchOutputInputSchema.parse(input);
  return searchOutputs({
    type: parsed.type,
    limit: parsed.limit,
  });
}
