import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { agentToolSchema } from './agent-tools.node';

describe('agent tool relation schema', () => {
  test('stores only the agent-to-tool permission', () => {
    const relation = agentToolSchema.parse({ key: newId(), agentKey: newId(), toolKey: newId() });
    expect(Object.keys(relation)).toEqual(['key', 'agentKey', 'toolKey']);
  });

  test('requires CUID references', () => {
    expect(() => agentToolSchema.parse({ key: newId(), agentKey: 'forge', toolKey: 'reason.solve' })).toThrow();
  });
});
