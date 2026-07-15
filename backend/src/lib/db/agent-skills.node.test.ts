import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { agentSkillSchema } from './agent-skills.node';

describe('agent skill relation schema', () => {
  test('stores only the relation and its priority', () => {
    const link = agentSkillSchema.parse({
      key: newId(),
      agentKey: newId(),
      skillKey: newId(),
      priority: 100,
      embedding: [],
    });

    expect(link).toEqual({
      key: link.key,
      agentKey: link.agentKey,
      skillKey: link.skillKey,
      priority: 100,
    });
    expect(link).not.toHaveProperty('embedding');
  });

  test('rejects negative and fractional priorities', () => {
    const base = { key: newId(), agentKey: newId(), skillKey: newId() };
    expect(() => agentSkillSchema.parse({ ...base, priority: -1 })).toThrow();
    expect(() => agentSkillSchema.parse({ ...base, priority: 1.5 })).toThrow();
  });
});
