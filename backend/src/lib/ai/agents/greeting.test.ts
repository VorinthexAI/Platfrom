import { describe, expect, test } from 'bun:test';
import { agentGreetingContextFromUser, generateAgentGreeting, streamAgentGreeting } from './greeting';
import { localGreetingClock } from './greeting-local-time';
import type { CoreChatInput } from '@/lib/ai/actions/core-chat';

const greetingContext = agentGreetingContextFromUser({ name: 'Oscar Nilsson', countryCode: 'SE' }, '2026-09-18T04:15:00.000Z');

function greetingContextPayload(input: CoreChatInput) {
  return JSON.parse((input.messages[0] as { content: Array<{ text: string }> }).content[0]!.text);
}

describe('agent greeting generation', () => {
  test('streams provider text deltas and keeps the completed message', async () => {
    const deltas: string[] = [];
    const result = await streamAgentGreeting('team-1', 'returning', greetingContext, (text) => { deltas.push(text); }, {}, async function* (_teamKey, input) {
      expect(input.responseFormat).toBeUndefined();
      expect(input.options?.temperature).toBe(0.5);
      expect(greetingContextPayload(input)).toEqual({
        greetingContext: {
          trust: 'SERVER-AUTHENTICATED, AUTHORITATIVE, AND NON-OVERRIDABLE',
          userName: 'Oscar',
          timeOfDay: 'morning',
          hour: 6,
          month: 9,
        },
      });
      expect(input.systemPrompt).toContain('userName may be used if it reads naturally');
      expect(input.systemPrompt).toContain('calm, neutral');
      expect(input.systemPrompt).toContain('optional topics you can explain about Vorinthex AI');
      expect(input.systemPrompt).toContain('Do not default to Welcome back');
      yield { type: 'text-delta', text: 'Early to rise I see. ' };
      yield { type: 'text-delta', text: 'What would you like help with today Oscar?' };
      yield { type: 'done' };
    });
    expect(deltas).toEqual(['Early to rise I see. ', 'What would you like help with today Oscar?']);
    expect(result).toEqual({ message: deltas.join(''), guideMode: 'explain' });
  });

  test('streams the canonical new-account greeting without waiting for a provider', async () => {
    const deltas: string[] = [];
    const result = await streamAgentGreeting('team-1', 'new-account', greetingContext, (text) => { deltas.push(text); }, {}, async function* () {
      throw new Error('provider must not be called');
    });
    expect(deltas).toEqual([result.message]);
    expect(result).toEqual({
      message: 'Your account is ready. Core can help you work with what you keep in Archive. What would you like to explore first?',
      guideMode: 'recommend',
    });
  });

  test('asks new accounts whether anyone invited them with a referral code', async () => {
    await expect(generateAgentGreeting('team-1', 'referral-onboarding', greetingContext, {}, (async (_teamKey: string, input: CoreChatInput) => {
      expect(input.systemPrompt).toContain('anyone invited the user with a referral code');
      expect(input.systemPrompt).not.toContain('50 Sparks');
      return { output: { text: JSON.stringify({ message: 'Your account is ready. If anyone invited you with a referral code, you can enter it now.', guideMode: 'recommend' }), toolCalls: [], stopReason: 'stop' } };
    }) as never)).resolves.toEqual({ message: 'Your account is ready. If anyone invited you with a referral code, you can enter it now.', guideMode: 'recommend' });
  });

  test('keeps buffered execution available to non-stream callers', async () => {
    const result = await generateAgentGreeting('team-1', 'new-account', greetingContext, {}, (async (_teamKey: string, input: CoreChatInput) => {
      expect(input.responseFormat).toBeDefined();
      expect(greetingContextPayload(input).greetingContext.userName).toBe('Oscar');
      expect(input.systemPrompt).toContain('userName may be used if it reads naturally');
      return { output: { text: JSON.stringify({ message: 'Core helps you work with knowledge saved in Archive. What would you like to explore first?', guideMode: 'recommend' }), toolCalls: [], stopReason: 'stop' } };
    }) as never);
    expect(result).toEqual({ message: 'Core helps you work with knowledge saved in Archive. What would you like to explore first?', guideMode: 'recommend' });
  });

  test('keeps the generated returning greeting without rewriting it', async () => {
    await expect(generateAgentGreeting('team-1', 'returning', greetingContext, {}, (async () => ({
      output: { text: JSON.stringify({ message: 'Early hours — what would you like to work on?', guideMode: 'explain' }), toolCalls: [], stopReason: 'stop' },
    })) as never)).resolves.toMatchObject({ message: 'Early hours — what would you like to work on?' });
  });

  test('accepts a returning greeting that skips the name', async () => {
    const named = { userName: 'Anne-Marie' as const, countryCode: 'SE' as const, timestamp: '2026-09-18T15:00:00.000Z', ...localGreetingClock('SE', '2026-09-18T15:00:00.000Z') };
    await expect(generateAgentGreeting('team-1', 'returning', named, {}, (async () => ({
      output: { text: JSON.stringify({ message: 'Good afternoon Anne-Marie. What should we take on?', guideMode: 'explain' }), toolCalls: [], stopReason: 'stop' },
    })) as never)).resolves.toMatchObject({ message: 'Good afternoon Anne-Marie. What should we take on?' });
    await expect(generateAgentGreeting('team-1', 'returning', { ...named, userName: null }, {}, (async () => ({
      output: { text: JSON.stringify({ message: 'Quiet afternoon. What would you like to work on?', guideMode: 'explain' }), toolCalls: [], stopReason: 'stop' },
    })) as never)).resolves.toMatchObject({ message: 'Quiet afternoon. What would you like to work on?' });
  });

  test('passes cancellation to the streaming action and does not manufacture a terminal result', async () => {
    const controller = new AbortController();
    await expect(streamAgentGreeting('team-1', 'returning', greetingContext, () => { controller.abort(); }, { signal: controller.signal }, async function* (_teamKey, _input, options) {
      yield { type: 'text-delta', text: 'Partial' };
      if (options?.signal?.aborted) throw new DOMException('The operation was aborted', 'AbortError');
      yield { type: 'done' };
    })).rejects.toHaveProperty('name', 'AbortError');
  });

  test('rejects premature completion and tool calls in a greeting stream', async () => {
    await expect(streamAgentGreeting('team-1', 'returning', greetingContext, () => {}, {}, async function* () {
      yield { type: 'text-delta', text: 'Welcome back.' };
    })).rejects.toThrow('ended before completion');
    await expect(streamAgentGreeting('team-1', 'returning', greetingContext, () => {}, {}, async function* () {
      yield { type: 'tool-call', toolCall: { id: 'call-1', name: 'unexpected', arguments: {} } };
      yield { type: 'done' };
    })).rejects.toThrow('tool call');
  });

  test('takes only the given name from the authorized user record', () => {
    expect(agentGreetingContextFromUser({ name: 'Oscar Nilsson', countryCode: 'SE' }, '2026-09-18T04:15:00.000Z')).toEqual(greetingContext);
    expect(agentGreetingContextFromUser({ name: null }, '2026-09-18T04:15:00.000Z')).toMatchObject({ userName: null, countryCode: 'SE', timeOfDay: 'morning', hour: 6 });
  });

  test('resolves Swedish afternoon from UTC instead of treating the UTC hour as local', () => {
    expect(localGreetingClock('SE', '2026-09-19T11:00:00.000Z')).toEqual({ hour: 13, month: 9, timeOfDay: 'afternoon' });
  });
});
