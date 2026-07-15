import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { skillSchema, skillsEmbedKeys } from './skills.node';

describe('skill node schema', () => {
  test('contains the canonical skill fields with a CUID2 key', () => {
    const skill = skillSchema.parse({
      key: newId(),
      slug: 'backend-developer',
      title: 'Backend Developer',
      definition: 'Build and maintain reliable backend systems.',
    });

    expect(skill).toEqual({
      key: skill.key,
      slug: 'backend-developer',
      title: 'Backend Developer',
      definition: 'Build and maintain reliable backend systems.',
      embedding: [],
    });
    expect(() => skillSchema.parse({ ...skill, key: 'not-a-cuid' })).toThrow();
  });

  test('embeds title and definition', () => {
    expect(skillsEmbedKeys.options).toEqual(['title', 'definition']);
  });
});
