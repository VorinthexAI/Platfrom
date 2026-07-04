import { z, type ZodTypeAny } from 'zod';
import { get_model } from './get_model';

export const councilInputSchema = z.object({
  question: z.string(),
  findings: z.array(z.unknown()),
  schema: z.custom<ZodTypeAny>().optional(),
});

export async function council(input: z.infer<typeof councilInputSchema>) {
  const parsed = councilInputSchema.parse(input);
  await get_model({ category: 'reasoning', level: 'xhigh' });
  const output = { consensus: parsed.question, findings: parsed.findings };
  if (!parsed.schema) return output;
  const result = parsed.schema.safeParse(output);
  if (!result.success) throw new Error(`ACTION_COUNCIL schema validation failed: ${result.error.message}`);
  return result.data;
}

