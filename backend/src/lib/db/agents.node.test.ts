import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { agentSchema, agentsEmbedKeys } from './agents.node';

describe('agent node schema', () => {
  test('stores identity and scope with a CUID2 key', () => {
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
      embedding: [],
    });
  });

  test('embeds name and title', () => {
    expect(agentsEmbedKeys.options).toEqual(['name', 'title']);
  });
});
