import { describe, expect, test } from 'bun:test';
import { orchestratorChatTool } from './orchestrator-chat';

describe('orchestrator chat tool', () => {
  test('validates messages and uses the injected executor', async () => {
    await expect(orchestratorChatTool.execute('Atlas', { message: ' hello ' }, {
      async execute(organizationKey, input) {
        expect(organizationKey).toBe('nexus');
        expect(input.messages[0]?.content[0]).toEqual({ type: 'text', text: 'hello' });
        expect(input.options?.maxTokens).toBe(1_200);
        return { output: { text: 'Answer', toolCalls: [], stopReason: 'stop' } } as never;
      },
    })).resolves.toBe('Answer');
    await expect(orchestratorChatTool.execute('Atlas', { message: '' }, { execute: async () => ({}) as never })).rejects.toThrow();
    await expect(orchestratorChatTool.execute('Atlas', { message: 'new', history: [{ role: 'user', content: 'old' }] }, { execute: async () => ({}) as never })).rejects.toThrow();
  });

  test('allows detailed responses', async () => {
    const calls: unknown[] = [];
    await orchestratorChatTool.execute('Atlas', { message: 'Explain the plan' }, { execute: async (_organizationKey, input) => { calls.push(input); return { output: { text: 'Answer', toolCalls: [], stopReason: null } } as never; } });
    expect(calls[0]).toMatchObject({ options: { maxTokens: 1_200 } });
  });
});
