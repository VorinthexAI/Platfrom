import { describe, expect, test } from 'bun:test';
import type { CoreChatInput } from '@/lib/ai/actions/core-chat';
import { agentGuideInputSchema, agentGuideOutputSchema, agentGuideTopicsInputSchema, createAgentGuideTool } from './agent-guide';
import type { AgentGreetingExecutor } from '@/lib/ai/agents/greeting';
import { initialWorkspaceDocumentKey } from '@/lib/initial-workspace-content-identifiers';
import { newId } from '@/lib/ids';

describe('agent.guide', () => {
  const topics = [1, 2, 3].map((value) => ({ label: `Topic ${value}`, question: `Question ${value}?` }));
  const greetingOutput = (message: string, guideMode: 'recommend' | 'explain' = 'explain') => ({ output: { text: JSON.stringify({ message, guideMode }), toolCalls: [], stopReason: 'stop' } });
  const executeContent = (async (_tool: string, input: { documentKeys: string[] }) => ({ results: input.documentKeys.map((documentKey) => ({ key: documentKey, success: true, data: { documentKey, title: 'Guide', content: 'Canonical guide content' } })), summary: { requested: input.documentKeys.length, succeeded: input.documentKeys.length, failed: 0 } })) as never;

  test('accepts only catalog modes or a strict greeting occasion', () => {
    expect(agentGuideInputSchema.parse({ mode: 'recommend' })).toEqual({ mode: 'recommend' });
    expect(agentGuideInputSchema.parse({ mode: 'explain' })).toEqual({ mode: 'explain' });
    expect(agentGuideInputSchema.parse({ mode: 'greet', occasion: 'onboarding' })).toEqual({ mode: 'greet', occasion: 'onboarding' });
    expect(() => agentGuideInputSchema.parse({ mode: 'greet' })).toThrow();
    expect(() => agentGuideInputSchema.parse({ mode: 'greet', occasion: 'launch' })).toThrow();
    expect(() => agentGuideInputSchema.parse({ mode: 'recommend', userKey: 'forged' })).toThrow('Unrecognized key');
    expect(JSON.stringify(createAgentGuideTool().providerDefinition)).not.toContain('greet');
    expect(() => agentGuideOutputSchema.parse({ mode: 'topics', guideMode: 'recommend', topics: [] })).toThrow();
    expect(agentGuideOutputSchema.parse({ mode: 'greet', occasion: 'returning', greetingState: 'returning', message: 'Welcome back?', showReferralCodeAction: false, guideMode: 'explain' })).toMatchObject({ guideMode: 'explain' });
  });

  const memberContext = { teamKey: 'team-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userTeam: { key: 'membership-1', userId: 'user-1', teamKey: 'team-1', status: 'active' } } } as const;
  const noConversations = { list: async () => ({ items: [], nextCursor: null }) };

  test('reads deterministic current-scope guides through the canonical Content runtime', async () => {
    const scopeKey = newId();
    const calls: unknown[][] = [];
    const context = { teamKey: 'team-1', runtimeScopeKey: scopeKey, principal: { kind: 'system' } } as const;
    const tool = createAgentGuideTool();
    const result = await tool.execute({ mode: 'recommend' }, { context, executeContent: (async (...args: unknown[]) => {
      calls.push(args);
      const documentKeys = (args[1] as { documentKeys: string[] }).documentKeys;
      return { results: documentKeys.map((documentKey, index) => ({ key: documentKey, success: true, data: { documentKey, title: `Guide ${index}`, content: `Content ${index}` } })), summary: { requested: documentKeys.length, succeeded: documentKeys.length, failed: 0 } };
    }) as never });

    if (result.mode === 'greet' || result.mode === 'topics') throw new Error('Expected workspace guidance.');
    expect(result.guides.map(({ id }) => id)).toEqual(['assistant-start', 'knowledge-start', 'media-start', 'communication-start', 'travel-start', 'learning-start']);
    expect(calls[0]?.slice(0, 2)).toEqual(['document.read', { documentKeys: result.guides.map(({ id }) => initialWorkspaceDocumentKey(scopeKey, id)) }]);
    expect(result.guides[0]).toEqual({ id: 'assistant-start', title: 'Guide 0', content: 'Content 0' });
    expect(JSON.stringify(result)).not.toContain(scopeKey);
    await expect(tool.execute({ mode: 'explain' })).rejects.toThrow('trusted execution context');
  });

  test('fails closed when a seeded scope guide is unavailable', async () => {
    const context = { teamKey: 'team-1', runtimeScopeKey: newId(), principal: { kind: 'system' } } as const;
    await expect(createAgentGuideTool().execute({ mode: 'recommend' }, {
      context,
      executeContent: (async (_tool: string, input: { documentKeys: string[] }) => ({ results: input.documentKeys.slice(1).map((documentKey) => ({ key: documentKey, success: true, data: { documentKey, title: 'Guide', content: 'Content' } })), summary: { requested: input.documentKeys.length, succeeded: input.documentKeys.length - 1, failed: 1 } })) as never,
    })).rejects.toThrow('Canonical workspace guide assistant-start is unavailable');
  });

  test('classifies stored conversations as returning before referral lookup despite an onboarding hint', async () => {
    const calls: unknown[][] = [];
    let referralReads = 0;
    const execute = (async (...args: unknown[]) => {
      calls.push(args);
      return greetingOutput('Welcome back. What would you like to work on?');
    }) as AgentGreetingExecutor;
    const tool = createAgentGuideTool({
      executeGreeting: execute,
      conversationService: { list: async (input, context) => { calls.push(['list', input, context]); return { items: [{} as never], nextCursor: null }; } },
      referrals: { readRedemptionStatus: async () => { referralReads += 1; throw new Error('must not read referral'); } },
    });

    const result = await tool.execute({ mode: 'greet', occasion: 'onboarding' }, { context: memberContext as never, executeContent, signal: new AbortController().signal });

    expect(result).toMatchObject({ mode: 'greet', occasion: 'onboarding', greetingState: 'returning', message: 'Welcome back. What would you like to work on?', showReferralCodeAction: false, guideMode: 'explain' });
    expect(calls[0]).toEqual(['list', { limit: 1, favoriteOnly: false }, memberContext]);
    expect(referralReads).toBe(0);
    expect(JSON.stringify(calls)).not.toContain('Canonical guide content');
  });

  test('uses a normal guide greeting when an empty Core is reopened', async () => {
    const calls: unknown[][] = [];
    let referralReads = 0;
    const execute = (async (...args: unknown[]) => {
      calls.push(args);
      return greetingOutput('Welcome back. What would you like to work on?');
    }) as AgentGreetingExecutor;
    const tool = createAgentGuideTool({ executeGreeting: execute, conversationService: noConversations, referrals: { readRedemptionStatus: async () => { referralReads += 1; return { attributed: false, referrerName: null, signupRewardIssued: false, firstPaidRewardStatus: null }; } } });

    const result = await tool.execute({ mode: 'greet', occasion: 'returning' }, { context: memberContext as never, executeContent, signal: new AbortController().signal });

    if (result.mode !== 'greet') throw new Error('Expected greeting guidance.');
    expect(result).toMatchObject({ greetingState: 'returning', message: 'Welcome back. What would you like to work on?', showReferralCodeAction: false });
    expect(referralReads).toBe(0);
    expect(calls).toHaveLength(1);
  });

  test('streams genuine greeting model deltas while returning the final validated message', async () => {
    const deltas: string[] = [];
    let executeCalled = false;
    const tool = createAgentGuideTool({
      executeGreeting: (async () => { executeCalled = true; return greetingOutput('unused'); }) as never,
      streamGreeting: async function* (_teamKey, input, options) {
        expect(input.systemPrompt).toContain('plain text');
        expect(options?.signal).toBeInstanceOf(AbortSignal);
        yield { type: 'text-delta', text: 'Welcome back. ' };
        yield { type: 'text-delta', text: 'What would you like to work on?' };
        yield { type: 'done' };
      },
      conversationService: noConversations,
    });
    const result = await tool.execute({ mode: 'greet', occasion: 'returning' }, { context: memberContext as never, signal: new AbortController().signal, onGreetingDelta: (text) => { deltas.push(text); } });
    expect(deltas).toEqual(['Welcome back. ', 'What would you like to work on?']);
    expect(result).toMatchObject({ mode: 'greet', message: deltas.join(''), guideMode: 'explain' });
    expect(executeCalled).toBe(false);
  });

  test('keeps streamed greeting prose provisional and returns the safe canonical fallback', async () => {
    const deltas: string[] = [];
    const tool = createAgentGuideTool({
      streamGreeting: async function* () { yield { type: 'text-delta', text: 'Welcome to Vorinthex.' }; yield { type: 'done' }; },
      conversationService: noConversations,
    });
    const result = await tool.execute({ mode: 'greet', occasion: 'returning' }, { context: memberContext as never, onGreetingDelta: (text) => { deltas.push(text); } });
    expect(deltas).toEqual(['Welcome to Vorinthex.']);
    expect(result).toMatchObject({ mode: 'greet', message: 'Good to see you. How can I help today?' });
  });

  test('shows the referral action during the initial unattributed onboarding greeting', async () => {
    const execute = (async () => greetingOutput('Your account is ready. A friend who referred you can receive 50 Sparks now and another 100 after your first subscription payment. Do you have their referral code?', 'recommend')) as unknown as AgentGreetingExecutor;
    const tool = createAgentGuideTool({ executeGreeting: execute, conversationService: noConversations, referrals: { readRedemptionStatus: async () => ({ attributed: false, referrerName: null, signupRewardIssued: false, firstPaidRewardStatus: null }) } });

    const result = await tool.execute({ mode: 'greet', occasion: 'onboarding' }, { context: memberContext as never });

    expect(result).toMatchObject({ greetingState: 'referral-onboarding', showReferralCodeAction: true });
  });

  test('classifies an attributed account as new and requires a concise Core and Archive introduction', async () => {
    const execute = (async () => greetingOutput('Core helps you work with knowledge saved in Archive. What would you like to explore first?', 'recommend')) as unknown as AgentGreetingExecutor;
    const tool = createAgentGuideTool({ executeGreeting: execute, conversationService: noConversations, referrals: { readRedemptionStatus: async () => ({ attributed: true, referrerName: 'Friend', signupRewardIssued: true, firstPaidRewardStatus: 'pending' }) } });

    const result = await tool.execute({ mode: 'greet', occasion: 'onboarding' }, { context: memberContext as never, executeContent });

    expect(result).toMatchObject({ mode: 'greet', occasion: 'onboarding', greetingState: 'new-account', message: 'Core helps you work with knowledge saved in Archive. What would you like to explore first?' });
    if (result.mode === 'greet') expect(result.showReferralCodeAction).toBe(false);
  });

  test('rejects referral prompts after attribution and claims about recent product activity', async () => {
    const attributedExecute = (async () => greetingOutput('Your account is ready. Do you have a referral code?', 'recommend')) as unknown as AgentGreetingExecutor;
    const attributedTool = createAgentGuideTool({ executeGreeting: attributedExecute, conversationService: noConversations, referrals: { readRedemptionStatus: async () => ({ attributed: true, referrerName: 'Friend', signupRewardIssued: true, firstPaidRewardStatus: 'pending' }) } });
    await expect(attributedTool.execute({ mode: 'greet', occasion: 'onboarding' }, { context: memberContext as never, executeContent })).resolves.toMatchObject({ message: 'Your account is ready. Core can help you work with what you keep in Archive. What would you like to explore first?', greetingState: 'new-account', showReferralCodeAction: false, guideMode: 'recommend' });

    const returningExecute = (async () => greetingOutput('I reviewed your recent activity in Archive. What should we continue?')) as unknown as AgentGreetingExecutor;
    const returningTool = createAgentGuideTool({ executeGreeting: returningExecute, conversationService: { list: async () => ({ items: [{} as never], nextCursor: null }) } });
    const result = await returningTool.execute({ mode: 'greet', occasion: 'returning' }, { context: memberContext as never, executeContent });
    if (result.mode !== 'greet') throw new Error('Expected greeting guidance.');
    expect(result.message).not.toMatch(/recent activity|Archive/i);
  });

  test('uses the completed Core answer as the sole topic-language anchor while keeping topic mode provider-invisible', async () => {
    const calls: any[][] = [];
    let key = 0;
    const tool = createAgentGuideTool({ id: () => `topic-key-${++key}`, executeTopics: (async (...args: unknown[]) => {
      calls.push(args);
      return { output: { text: JSON.stringify({ guideMode: 'explain', topics: [{ label: 'Go deeper', question: 'How does Archive work?' }, { label: 'Compare tools', question: 'How do the apps work together?' }, { label: 'Get started', question: 'What should I try first?' }] }), toolCalls: [], stopReason: 'stop' } };
    }) as never });
    const answer = 'You can organize your content in Archive.';
    const result = await tool.execute({ mode: 'topics', question: '¿Qué puedo hacer?', answer, guideContext: { mode: 'recommend', guides: [{ title: 'Guía española' }] }, recentTopicLabels: ['Etiquetado de imágenes'] }, { context: { teamKey: 'team-1', runtimeScopeKey: newId(), principal: { kind: 'system' } } as const });
    expect(result).toMatchObject({ mode: 'topics', guideMode: 'explain' });
    if (result.mode !== 'topics') throw new Error('Expected topics.');
    expect(result.topics[0]).toMatchObject({ key: 'topic-key-1', label: 'Go deeper' });
    expect(calls[0]?.[1]).toMatchObject({ responseFormat: { schema: { properties: { topics: { minItems: 3, maxItems: 3 } } } } });
    const request = calls[0]![1] as CoreChatInput;
    expect(request.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: JSON.stringify({ message: answer }) }] });
    expect(JSON.stringify(request.messages[0])).not.toContain('completedCoreAnswer');
    expect(JSON.stringify(request.messages[0])).toContain('Etiquetado de imágenes');
    expect(request.systemPrompt).toContain('completed Core answer');
    expect(JSON.stringify(tool.providerDefinition)).not.toContain('topics');
    expect(() => agentGuideTopicsInputSchema.parse({ mode: 'topics', question: 'Question', answer, recentTopicLabels: [], languageAnchor: 'Spanish' })).toThrow('Unrecognized key');
    let invalidAttempts = 0; const invalidRequests: CoreChatInput[] = [];
    const invalid = createAgentGuideTool({ executeTopics: (async (_team: string, input: CoreChatInput) => { invalidAttempts += 1; invalidRequests.push(input); return { output: { text: JSON.stringify({ guideMode: 'recommend', topics: Array.from({ length: 3 }, () => ({ label: 'Same', question: 'Same?' })) }), toolCalls: [], stopReason: 'stop' } }; }) as never });
    await expect(invalid.execute({ mode: 'topics', question: 'x', answer: 'y', recentTopicLabels: [] }, { context: { teamKey: 'team-1', runtimeScopeKey: newId(), principal: { kind: 'system' } } } as never)).rejects.toThrow('malformed structured output');
    expect(invalidAttempts).toBe(2);
    expect(JSON.stringify(invalidRequests[1]!.messages[0])).toContain('previous response was invalid');
    expect(invalidRequests[1]!.messages.at(-1)).toEqual({ role: 'user', content: [{ type: 'text', text: JSON.stringify({ message: 'y' }) }] });
  });

  test('emits only complete validated topics from structured model deltas before final validation', async () => {
    const emitted: Array<{ key: string; label: string; question: string }> = [];
    const observations: number[] = [];
    const payload = JSON.stringify({ guideMode: 'explain', topics });
    const secondTopic = payload.indexOf('{', payload.indexOf('topics'));
    const secondBoundary = payload.indexOf('},{', secondTopic) + 2;
    const thirdBoundary = payload.indexOf('},{', secondBoundary) + 2;
    let key = 0;
    const tool = createAgentGuideTool({
      id: () => `stream-topic-${++key}`,
      streamTopics: async function* () {
        yield { type: 'text-delta', text: payload.slice(0, secondBoundary) };
        observations.push(emitted.length);
        yield { type: 'text-delta', text: payload.slice(secondBoundary, thirdBoundary) };
        observations.push(emitted.length);
        yield { type: 'text-delta', text: payload.slice(thirdBoundary) };
        yield { type: 'done' };
      },
    });
    const result = await tool.execute({ mode: 'topics', question: 'Question', answer: 'Answer', recentTopicLabels: [] }, {
      context: { teamKey: 'team-1', runtimeScopeKey: newId(), principal: { kind: 'system' } } as const,
      onGuideTopic: (topic) => { emitted.push(topic); },
    });
    expect(observations).toEqual([1, 2]);
    expect(emitted.map(({ label }) => label)).toEqual(topics.map(({ label }) => label));
    expect(result).toMatchObject({ mode: 'topics', topics: emitted });
  });

  test('generates opening topics from focused canonical guides after returning the greeting', async () => {
    const scopeKey = newId();
    const documentReads: string[][] = [];
    let prompt = '';
    const tool = createAgentGuideTool({
      conversationService: noConversations,
      referrals: { readRedemptionStatus: async () => ({ attributed: true, referrerName: 'Friend', signupRewardIssued: true, firstPaidRewardStatus: 'pending' }) },
      executeGreeting: (async (_teamKey: string, request: unknown) => {
        prompt = JSON.stringify(request);
        return greetingOutput('Your account is ready. Core can help you work with Archive. What would you like to explore first?', 'recommend');
      }) as never,
      executeTopics: (async () => ({ output: { text: JSON.stringify({ guideMode: 'recommend', topics }), toolCalls: [], stopReason: 'stop' } })) as never,
    });
    const greeting = await tool.execute({ mode: 'greet', occasion: 'onboarding' }, {
      context: { ...memberContext, runtimeScopeKey: scopeKey } as never,
      executeContent: (async (_tool: string, input: { documentKeys: string[] }) => {
        documentReads.push(input.documentKeys);
        return { results: input.documentKeys.map((documentKey) => ({ key: documentKey, success: true, data: { documentKey, title: 'Guide', content: 'Content' } })), summary: { requested: input.documentKeys.length, succeeded: input.documentKeys.length, failed: 0 } };
      }) as never,
    });

    expect(documentReads).toEqual([]);
    expect(prompt).toContain('Naturally introduce Core as the assistant and Archive as the place');
    expect(greeting).toMatchObject({ mode: 'greet', greetingState: 'new-account' });
    const generated = await tool.execute({ mode: 'opening-topics', greetingState: 'new-account', message: 'Core can help with Archive. What would you like to explore first?' }, {
      context: { ...memberContext, runtimeScopeKey: scopeKey } as never,
      executeContent: (async (_tool: string, input: { documentKeys: string[] }) => {
        documentReads.push(input.documentKeys);
        return { results: input.documentKeys.map((documentKey) => ({ key: documentKey, success: true, data: { documentKey, title: 'Guide', content: 'Content' } })), summary: { requested: input.documentKeys.length, succeeded: input.documentKeys.length, failed: 0 } };
      }) as never,
    });
    expect(documentReads).toEqual([['assistant-overview', 'assistant-start', 'conversation-history', 'knowledge-overview', 'knowledge-start'].map((id) => initialWorkspaceDocumentKey(scopeKey, id))]);
    expect(generated).toMatchObject({ mode: 'topics', guideMode: 'recommend', topics: expect.any(Array) });
  });

});
