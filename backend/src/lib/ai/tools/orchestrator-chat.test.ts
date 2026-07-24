import { describe, expect, test } from 'bun:test';
import { orchestratorChatTool } from './orchestrator-chat';

describe('orchestrator chat tool', () => {
  test('validates messages and uses the injected executor', async () => {
    await expect(orchestratorChatTool.execute('Atlas', { message: ' hello ' }, {
      async execute(organizationKey, input) {
        expect(organizationKey).toBe('nexus');
        expect(input.messages[0]?.content[0]).toEqual({ type: 'text', text: 'hello' });
        return { output: { text: 'Answer', toolCalls: [], stopReason: 'stop' } } as never;
      },
    })).resolves.toBe('Answer');
    await expect(orchestratorChatTool.execute('Atlas', { message: '' }, { execute: async () => ({}) as never })).rejects.toThrow();
  });
});
