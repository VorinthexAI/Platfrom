import { z, type ZodTypeAny } from 'zod';
import { get_model } from './get_model';

export const aiSearchInputSchema = z.object({
  query: z.string(),
  schema: z.custom<ZodTypeAny>().optional(),
});

export async function ai_search(input: z.infer<typeof aiSearchInputSchema>) {
  const parsed = aiSearchInputSchema.parse(input);
  await get_model({ category: 'fast', level: 'high' });
  const output = { query: parsed.query, findings: [] as string[] };
  if (!parsed.schema) return output;
  const result = parsed.schema.safeParse(output);
  if (!result.success) {
    throw new Error(`ACTION_AI_SEARCH schema validation failed: ${result.error.message}`);
  }
  return result.data;
}

