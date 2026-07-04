import { z, type ZodTypeAny } from 'zod';
import { get_model } from './get_model';

export const researchInputSchema = z.object({
  question: z.string(),
  context: z.string().optional(),
  schema: z.custom<ZodTypeAny>().optional(),
});

export async function research(input: z.infer<typeof researchInputSchema>) {
  const parsed = researchInputSchema.parse(input);
  await get_model({ category: 'reasoning', level: 'high' });
  const output = {
    brief: parsed.question,
    context: parsed.context ?? null,
    findings: [],
    consensus: 'No live research provider was invoked in this environment.',
  };
  if (!parsed.schema) return output;
  const result = parsed.schema.safeParse(output);
  if (!result.success) throw new Error(`ACTION_RESEARCH schema validation failed: ${result.error.message}`);
  return result.data;
}

