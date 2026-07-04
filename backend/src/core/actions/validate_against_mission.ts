import { z } from 'zod';
import { get_model } from './get_model';

export const validateAgainstMissionInputSchema = z.object({
  content: z.string(),
  mission_summary: z.string(),
});

export async function validate_against_mission(input: z.infer<typeof validateAgainstMissionInputSchema>) {
  const parsed = validateAgainstMissionInputSchema.parse(input);
  await get_model({ category: 'reasoning', level: 'high' });
  const aligned = parsed.content.toLowerCase().includes(parsed.mission_summary.toLowerCase().split(/\s+/)[0] ?? '');
  return { aligned, reasoning: aligned ? 'Content shares mission language.' : 'Content does not clearly reference the mission.' };
}

