import { z } from 'zod';
import { newId } from '@/lib/ids';
import { createNodeHelpers } from './base';

export const SKILLS_COLLECTION = 'skills';

export const skillSchema = z.object({
  key: z.string().cuid2(),
  slug: z.string(),
  title: z.string(),
  definition: z.string(),
  embedding: z.array(z.number()).default([]),
});

export type Skill = z.infer<typeof skillSchema>;
export type SkillInsert = Omit<z.input<typeof skillSchema>, 'key' | 'embedding'> & { key?: string };

export const skillsEmbedKeys = z.enum(['title', 'definition']);

const helpers = createNodeHelpers(SKILLS_COLLECTION, skillSchema, skillsEmbedKeys.options);

export function insertSkill(input: SkillInsert) {
  return helpers.insert({ ...input, key: input.key ?? newId() });
}

export const getSkillById = helpers.getById;
export const updateSkill = helpers.updateById;
export const deleteSkill = helpers.deleteById;
export const upsertSkillByKey = helpers.upsertByKey;
export const getAllSkillsChunked = helpers.getAllChunked;
export const listSkillsPage = helpers.listPage;
