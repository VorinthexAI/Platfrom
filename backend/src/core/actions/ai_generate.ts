import { z, type ZodTypeAny } from 'zod';
import { get_model } from './get_model';

export const aiGenerateInputSchema = z.object({
  prompt: z.string(),
  schema: z.custom<ZodTypeAny>().optional(),
  data: z.unknown().optional(),
});

export async function ai_generate(input: z.infer<typeof aiGenerateInputSchema>) {
  const parsed = aiGenerateInputSchema.parse(input);
  await get_model({ category: 'reasoning', level: 'medium' });
  const output = parsed.data ?? { text: parsed.prompt };
  if (!parsed.schema) return output;
  const result = parsed.schema.safeParse(output);
  if (!result.success) {
    throw new Error(`ACTION_AI_GENERATE schema validation failed: ${result.error.message}`);
  }
  return result.data;
}

