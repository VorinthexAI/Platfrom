import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { skillSchema, type Skill } from '@/lib/db/skills.node';
import { createSkillService, DuplicateSkillSlugError } from './skill-service';

describe('skill service', () => {
  test('validates input and rejects duplicate registry slugs', async () => {
    const skills: Skill[] = [];
    const service = createSkillService({
      async findSkillBySlug(slug) { return skills.find((skill) => skill.slug === slug) ?? null; },
      async saveSkill(input) {
        const skill = skillSchema.parse({ ...(input as object), key: newId() });
        skills.push(skill);
        return skill;
      },
    });
    const input = { slug: 'backend-developer', name: 'Backend Engineering', title: 'Backend Developer', definition: '# Backend Developer' };
    await service.createSkill(input);
    await expect(service.createSkill(input)).rejects.toBeInstanceOf(DuplicateSkillSlugError);
    await expect(service.createSkill({ ...input, unexpected: true })).rejects.toThrow();
  });
});
