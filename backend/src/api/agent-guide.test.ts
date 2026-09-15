import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools';
import { createAgentGreetingHandler, createAgentGreetingTopicsHandler, greetingDeltaEventSchema, greetingDoneEventSchema, greetingErrorEventSchema, greetingTopicEventSchema, greetingTopicsDoneEventSchema } from './agent-guide';

function frames(value: string) {
  return value.trim().split(/\r?\n\r?\n/u).map((frame) => Object.fromEntries(frame.split(/\r?\n/u).map((line) => {
    const separator = line.indexOf(':');
    return [line.slice(0, separator), line.slice(separator + 1).trimStart()];
  }))).map((frame) => ({ event: frame.event!, id: frame.id!, data: JSON.parse(frame.data!) })) as Array<{ event: string; id: string; data: any }>;
}

describe('agent greeting SSE API', () => {
  const teamKey = 'team-1';
  const scopeKey = newId();
  const userKey = newId();
  const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId() }, scopeMember: null } } as unknown as ToolContext;

  test('requires authentication and strict transport input before opening SSE', async () => {
    const unauthorized = new Hono().post('/agent/greeting', createAgentGreetingHandler({ getIdentity: async () => null }));
    expect((await unauthorized.request('/agent/greeting', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamKey, scopeKey, occasion: 'returning' }) })).status).toBe(401);

    const handler = createAgentGreetingHandler({ getIdentity: async () => ({ identityType: 'user', key: userKey }) as never, authorize: async () => ({ context }) });
    const app = new Hono().post('/agent/greeting', handler);
    expect((await app.request('/agent/greeting', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamKey, scopeKey, occasion: 'returning', message: 'forged prompt' }) })).status).toBe(400);
  });

  test('streams canonical greeting deltas followed by one signed done frame', async () => {
    const calls: unknown[][] = [];
    const correlationKey = newId(), messageKey = newId();
    const ids = [correlationKey, messageKey];
    const handler = createAgentGreetingHandler({
      getIdentity: async () => ({ identityType: 'user', key: userKey }) as never,
      authorize: async () => ({ context }),
      run: async (...args: unknown[]) => {
        calls.push(args);
        const trusted = args[3] as { onGreetingDelta(text: string): Promise<void> };
        await trusted.onGreetingDelta('Welcome back. ');
        await trusted.onGreetingDelta('What can I help with?');
        return { greetingState: 'returning', message: 'Welcome back. What can I help with?', showReferralCodeAction: false, guideMode: 'explain' };
      },
      recordEvent: async () => {},
      id: () => ids.shift()!,
      issueGreetingToken: async () => 'signed-greeting',
    });
    const app = new Hono().post('/agent/greeting', handler);
    const response = await app.request('/agent/greeting', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamKey, scopeKey, occasion: 'returning' }) });
    const events = frames(await response.text());

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/event-stream');
    expect(events.map(({ event }) => event)).toEqual(['delta', 'delta', 'done']);
    expect(events.every(({ id }) => id === correlationKey)).toBe(true);
    expect(events[0]!.data).toEqual(greetingDeltaEventSchema.parse({ type: 'delta', correlationKey, messageKey, text: 'Welcome back. ' }));
    expect(events[2]!.data).toEqual(greetingDoneEventSchema.parse({ type: 'done', correlationKey, messageKey, message: 'Welcome back. What can I help with?', showReferralCodeAction: false, topicsPending: true, persistenceToken: 'signed-greeting' }));
    expect(() => greetingDoneEventSchema.parse({ ...events[2]!.data, unexpected: true })).toThrow('Unrecognized key');
    expect(calls[0]?.slice(0, 3)).toEqual(['agent.guide', '', { mode: 'greet', occasion: 'returning' }]);
    expect((calls[0]?.[3] as { requestKey: string }).requestKey).toBe(correlationKey);
    expect(JSON.stringify(calls)).not.toContain('conversation.create');
  });

  test('emits complete topics in order and signs only the exact final output', async () => {
    const topics = [1, 2, 3].map((value) => ({ key: `topic-${value}`, label: `Topic ${value}`, question: `Question ${value}?` }));
    const signed: unknown[] = [];
    const correlationKey = newId();
    const handler = createAgentGreetingTopicsHandler({
      getIdentity: async () => ({ identityType: 'user', key: userKey }) as never,
      authorize: async () => ({ context }),
      verifyGreetingToken: async () => ({ version: 1, key: newId(), teamKey, scopeKey, userKey, occasion: 'returning', greetingState: 'returning', message: 'Welcome back?', guideTopicMode: 'explain', guideTopics: { status: 'NONE' }, createdAt: new Date().toISOString(), expiresAt: Date.now() + 60_000 }),
      run: async (...args: unknown[]) => {
        expect(args.slice(0, 3)).toEqual(['agent.guide', '', { mode: 'opening-topics', greetingState: 'returning', message: 'Welcome back?' }]);
        const trusted = args[3] as { onGuideTopic(topic: typeof topics[number]): Promise<void> };
        for (const topic of topics) await trusted.onGuideTopic(topic);
        return { mode: 'topics', guideMode: 'explain', topics };
      },
      id: () => correlationKey,
      issueGreetingToken: async (input) => { signed.push(input); return 'ready-greeting'; },
    });
    const app = new Hono().post('/agent/greeting/topics', handler);
    const response = await app.request('/agent/greeting/topics', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamKey, scopeKey, persistenceToken: 'pending-greeting' }) });
    const events = frames(await response.text());
    expect(events.map(({ event }) => event)).toEqual(['topic', 'topic', 'topic', 'done']);
    expect(events.every(({ id }) => id === correlationKey)).toBe(true);
    expect(events.slice(0, 3).map(({ data }) => greetingTopicEventSchema.parse(data).topic)).toEqual(topics);
    expect(events[3]!.data).toEqual(greetingTopicsDoneEventSchema.parse({ type: 'done', correlationKey, topics, persistenceToken: 'ready-greeting' }));
    expect(() => greetingTopicEventSchema.parse({ ...events[0]!.data, rawJson: '{}' })).toThrow('Unrecognized key');
    expect(signed[0]).toMatchObject({ guideTopicMode: 'explain', guideTopics: { status: 'READY', topics } });
  });

  test('ends with one safe error and never emits done after canonical failure', async () => {
    const correlationKey = newId(), messageKey = newId();
    const ids = [correlationKey, messageKey];
    const handler = createAgentGreetingHandler({
      getIdentity: async () => ({ identityType: 'user', key: userKey }) as never,
      authorize: async () => ({ context }),
      id: () => ids.shift()!,
      run: async (_name, _skill, _input, trusted) => { await trusted.onGreetingDelta?.('Partial'); throw new Error('provider secret'); },
    });
    const app = new Hono().post('/agent/greeting', handler);
    const response = await app.request('/agent/greeting', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ teamKey, scopeKey, occasion: 'returning' }) });
    const events = frames(await response.text());
    expect(events.map(({ event }) => event)).toEqual(['delta', 'error']);
    expect(events[1]!.data).toEqual(greetingErrorEventSchema.parse({ type: 'error', correlationKey, code: 'FAILED', message: 'Agent greeting failed.' }));
    expect(JSON.stringify(events)).not.toContain('provider secret');
    expect(() => greetingErrorEventSchema.parse({ ...events[1]!.data, detail: 'private' })).toThrow('Unrecognized key');
  });
});
