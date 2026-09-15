import { describe, expect, test } from 'bun:test';
import { generateAgentGreeting, streamAgentGreeting } from './greeting';
import type { CoreChatInput } from '@/lib/ai/actions/core-chat';

describe('agent greeting generation', () => {
  test('streams provider text deltas and validates the completed message', async () => {
    const deltas: string[] = [];
    const result = await streamAgentGreeting('team-1', 'returning', (text) => { deltas.push(text); }, {}, async function* (_teamKey, input) {
      expect(input.responseFormat).toBeUndefined();
      yield { type: 'text-delta', text: 'Welcome back. ' };
      yield { type: 'text-delta', text: 'What would you like to work on?' };
      yield { type: 'done' };
    });
    expect(deltas).toEqual(['Welcome back. ', 'What would you like to work on?']);
    expect(result).toEqual({ message: deltas.join(''), guideMode: 'explain' });
  });

  test('keeps buffered execution available to non-stream callers', async () => {
    const result = await generateAgentGreeting('team-1', 'new-account', {}, (async (_teamKey: string, input: CoreChatInput) => {
      expect(input.responseFormat).toBeDefined();
      return { output: { text: JSON.stringify({ message: 'Core helps you work with knowledge saved in Archive. What would you like to explore first?', guideMode: 'recommend' }), toolCalls: [], stopReason: 'stop' } };
    }) as never);
    expect(result).toEqual({ message: 'Core helps you work with knowledge saved in Archive. What would you like to explore first?', guideMode: 'recommend' });
  });

  test('passes cancellation to the streaming action and does not manufacture a terminal result', async () => {
    const controller = new AbortController();
    await expect(streamAgentGreeting('team-1', 'returning', () => { controller.abort(); }, { signal: controller.signal }, async function* (_teamKey, _input, options) {
      yield { type: 'text-delta', text: 'Partial' };
      if (options?.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
      yield { type: 'done' };
    })).rejects.toHaveProperty('name', 'AbortError');
  });

  test('rejects premature completion and tool calls in a greeting stream', async () => {
    await expect(streamAgentGreeting('team-1', 'returning', () => {}, {}, async function* () {
      yield { type: 'text-delta', text: 'Welcome back.' };
    })).rejects.toThrow('ended before completion');
    await expect(streamAgentGreeting('team-1', 'returning', () => {}, {}, async function* () {
      yield { type: 'tool-call', toolCall: { id: 'call-1', name: 'unexpected', arguments: {} } };
      yield { type: 'done' };
    })).rejects.toThrow('tool call');
  });
});
