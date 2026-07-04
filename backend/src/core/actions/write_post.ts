import { z } from 'zod';
import { normalizePostDraft } from './content-posts';

export const writePostInputSchema = z.unknown();

export async function write_post(input: z.infer<typeof writePostInputSchema>) {
  return normalizePostDraft(input);
}
