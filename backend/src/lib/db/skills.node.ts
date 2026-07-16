import { z } from 'zod';
import { aql } from 'arangojs';
import { newId } from '@/lib/ids';
import { createNodeHelpers, withArangoKey } from './base';
import { db } from './client';

export const SKILLS_COLLECTION = 'skills';

export const skillSchema = z.object({
  key: z.string().cuid(),
  slug: z.string().trim().min(1).max(160).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Skill slug must use lowercase kebab-case'),
  name: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(160),
  definition: z.string().trim().min(1),
  embedding: z.array(z.number().finite()).default([]),
});

export type Skill = z.infer<typeof skillSchema>;
export type SkillInsert = Omit<z.input<typeof skillSchema>, 'key' | 'embedding'> & { key?: string };

export const skillsEmbedKeys = z.enum(['name', 'title', 'definition']);

const helpers = createNodeHelpers(SKILLS_COLLECTION, skillSchema, skillsEmbedKeys.options);

export function insertSkill(input: SkillInsert) {
  return helpers.insert({ ...input, key: input.key ?? newId() });
}

export const getSkillById = helpers.getById;

export async function getSkillBySlug(slug: string): Promise<Skill | null> {
  const validSlug = skillSchema.shape.slug.parse(slug);
  const cursor = await db.query(aql`
    FOR skill IN ${db.collection(SKILLS_COLLECTION)}
      FILTER skill.slug == ${validSlug}
      LIMIT 1
      RETURN skill
  `);
  const document = await cursor.next();
  return document ? skillSchema.parse(withArangoKey(document)) : null;
}
export const updateSkill = helpers.updateById;
export const deleteSkill = helpers.deleteById;
export const upsertSkillByKey = helpers.upsertByKey;
export const getAllSkillsChunked = helpers.getAllChunked;
export const listSkillsPage = helpers.listPage;
