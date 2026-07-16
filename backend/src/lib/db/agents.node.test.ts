import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { agentSchema, agentsEmbedKeys } from './agents.node';

describe('agent node schema', () => {
  test('stores identity and scope with a CUID key', () => {
    const agent = agentSchema.parse({
      key: newId(),
      slug: 'forge',
      name: 'Forge',
      title: 'Backend Developer',
      scopeKey: newId(),
    });

    expect(agent).toEqual({
      key: agent.key,
      slug: 'forge',
      name: 'Forge',
      title: 'Backend Developer',
      scopeKey: agent.scopeKey,
      explorationRate: 0.5,
      embedding: [],
    });
  });

  test('embeds name and title', () => {
    expect(agentsEmbedKeys.options).toEqual(['name', 'title']);
  });

  test('stores only a bounded exploration rate and defaults to balanced', () => {
    const base = { key: newId(), slug: 'atlas', name: 'Atlas', title: 'Researcher', scopeKey: newId() };
    expect(agentSchema.parse(base).explorationRate).toBe(0.5);
    expect(() => agentSchema.parse({ ...base, explorationRate: -0.01 })).toThrow();
    expect(() => agentSchema.parse({ ...base, explorationRate: 1.01 })).toThrow();
    expect(Object.keys(agentSchema.shape)).not.toContain('selfSustaining');
  });
});
