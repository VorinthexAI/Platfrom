import type { z } from 'zod';
import { skillSchema, getSkillBySlug, insertSkill, type Skill } from '@/lib/db/skills.node';
import { isArangoUniqueConstraintError } from '@/lib/db/base';

export const createSkillInputSchema = skillSchema
  .omit({ key: true, embedding: true })
  .strict();
export type CreateSkillInput = z.input<typeof createSkillInputSchema>;

export interface SkillServiceDataSource {
  findSkillBySlug(slug: string): Promise<Skill | null>;
  saveSkill(input: CreateSkillInput): Promise<Skill>;
}

export class DuplicateSkillSlugError extends Error {
  constructor(public readonly slug: string) {
    super(`Skill slug ${slug} already exists`);
    this.name = 'DuplicateSkillSlugError';
  }
}

export function createSkillService(source: SkillServiceDataSource = {
  findSkillBySlug: getSkillBySlug,
  saveSkill: insertSkill,
}) {
  return {
    async createSkill(input: unknown): Promise<Skill> {
      const valid = createSkillInputSchema.parse(input);
      if (await source.findSkillBySlug(valid.slug)) throw new DuplicateSkillSlugError(valid.slug);
      try {
        return await source.saveSkill(valid);
      } catch (error) {
        if (isArangoUniqueConstraintError(error)) throw new DuplicateSkillSlugError(valid.slug);
        throw error;
      }
    },
  };
}
