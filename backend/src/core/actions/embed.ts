import { z } from 'zod';
import { get_model } from './get_model';

export const embedInputSchema = z.object({ text: z.string() });

export async function embed(input: z.infer<typeof embedInputSchema>) {
  await get_model({ category: 'embedding' });
  const parsed = embedInputSchema.parse(input);
  const seed = [...parsed.text].reduce((sum, char) => sum + char.charCodeAt(0), 0);
  return Array.from({ length: 1536 }, (_, index) => ((seed + index) % 997) / 997);
}

