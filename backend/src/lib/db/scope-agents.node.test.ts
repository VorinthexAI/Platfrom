import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { scopeAgentSchema } from './scope-agents.node';

describe('scopeAgents schema', () => {
  test('links one persisted agent to its effective runtime scope', () => {
    const link = scopeAgentSchema.parse({ key: newId(), scopeKey: newId(), agentKey: newId() });
    expect(Object.keys(link)).toEqual(['key', 'scopeKey', 'agentKey']);
  });

  test('rejects non-CUID relation keys and unknown fields', () => {
    expect(() => scopeAgentSchema.parse({ key: newId(), scopeKey: 'core', agentKey: newId() })).toThrow();
    expect(() => scopeAgentSchema.parse({ key: newId(), scopeKey: newId(), agentKey: newId(), scopeId: newId() })).toThrow();
  });
});
