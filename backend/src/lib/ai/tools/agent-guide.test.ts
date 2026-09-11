import { describe, expect, test } from 'bun:test';
import { agentGuideInputSchema, createAgentGuideTool } from './agent-guide';
import type { AgentGreetingExecutor } from '@/lib/ai/agents/greeting';
import { initialWorkspaceDocumentKey } from '@/lib/initial-workspace-content-identifiers';
import { newId } from '@/lib/ids';

describe('agent.guide', () => {
  test('accepts only catalog modes or a strict greeting occasion', () => {
    expect(agentGuideInputSchema.parse({ mode: 'recommend' })).toEqual({ mode: 'recommend' });
    expect(agentGuideInputSchema.parse({ mode: 'explain' })).toEqual({ mode: 'explain' });
    expect(agentGuideInputSchema.parse({ mode: 'greet', occasion: 'onboarding' })).toEqual({ mode: 'greet', occasion: 'onboarding' });
    expect(() => agentGuideInputSchema.parse({ mode: 'greet' })).toThrow();
    expect(() => agentGuideInputSchema.parse({ mode: 'greet', occasion: 'launch' })).toThrow();
    expect(() => agentGuideInputSchema.parse({ mode: 'recommend', userKey: 'forged' })).toThrow('Unrecognized key');
    expect(JSON.stringify(createAgentGuideTool().providerDefinition)).not.toContain('greet');
  });

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

    if (result.mode === 'greet') throw new Error('Expected workspace guidance.');
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

  test('generates only a greeting from trusted context without reading workspace guides', async () => {
    const calls: unknown[][] = [];
    const execute = (async (...args: unknown[]) => {
      calls.push(args);
      return { output: { text: 'Welcome back. What would you like to work on?', toolCalls: [], stopReason: 'stop' } };
    }) as AgentGreetingExecutor;
    const tool = createAgentGuideTool({ executeGreeting: execute });
    const context = { teamKey: 'team-1', runtimeScopeKey: 'scope-1', principal: { kind: 'system' } } as const;

    const result = await tool.execute({ mode: 'greet', occasion: 'returning' }, { context, signal: new AbortController().signal });

    expect(result).toEqual({ mode: 'greet', occasion: 'returning', message: 'Welcome back. What would you like to work on?', showReferralCodeAction: false });
    expect(calls[0]?.[0]).toBe('team-1');
    expect(JSON.stringify(calls)).toContain('Generate the opening greeting now.');
    expect(JSON.stringify(calls)).not.toContain('returning');
  });

  test('regenerates invalid prose and falls back to a compliant greeting', async () => {
    const calls: unknown[][] = [];
    const execute = (async (...args: unknown[]) => {
      calls.push(args);
      return { output: { text: 'Welcome to Vorinthex - what can I do?', toolCalls: [], stopReason: 'stop' } };
    }) as AgentGreetingExecutor;
    const tool = createAgentGuideTool({ executeGreeting: execute });
    const context = { teamKey: 'team-1', runtimeScopeKey: 'scope-1', principal: { kind: 'system' } } as const;

    const result = await tool.execute({ mode: 'greet', occasion: 'onboarding' }, { context, signal: new AbortController().signal });

    if (result.mode !== 'greet') throw new Error('Expected greeting guidance.');
    expect(result.message).toBe('Your account is ready. A friend who referred you can receive 50 Sparks now and another 100 after your first subscription payment. Do you have their referral code?');
    expect(result.showReferralCodeAction).toBe(true);
    expect(result.message).not.toMatch(/[-\u2010-\u2015\u2212]/u);
    expect(calls).toHaveLength(2);
    expect(JSON.stringify(calls[1])).toContain('Regenerate it.');
  });

  test('does not ask for another referral code when onboarding attribution already exists', async () => {
    const execute = (async () => ({ output: { text: 'Your account is ready. What would you like to work on first?', toolCalls: [], stopReason: 'stop' } })) as unknown as AgentGreetingExecutor;
    const tool = createAgentGuideTool({ executeGreeting: execute, referrals: { readRedemptionStatus: async () => ({ attributed: true, referrerName: 'Friend', signupRewardIssued: true, firstPaidRewardStatus: 'pending' }) } });
    const context = { teamKey: 'team-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userTeam: { key: 'membership-1', userId: 'user-1', teamKey: 'team-1', status: 'active' } } } as const;

    const result = await tool.execute({ mode: 'greet', occasion: 'onboarding' }, { context: context as never });

    expect(result).toMatchObject({ mode: 'greet', message: 'Your account is ready. What would you like to work on first?' });
    if (result.mode === 'greet') expect(result.showReferralCodeAction).toBe(false);
  });

  test('rejects referral prompts after attribution and claims about recent product activity', async () => {
    const attributedExecute = (async () => ({ output: { text: 'Your account is ready. Do you have a referral code?', toolCalls: [], stopReason: 'stop' } })) as unknown as AgentGreetingExecutor;
    const attributedTool = createAgentGuideTool({ executeGreeting: attributedExecute, referrals: { readRedemptionStatus: async () => ({ attributed: true, referrerName: 'Friend', signupRewardIssued: true, firstPaidRewardStatus: 'pending' }) } });
    const memberContext = { teamKey: 'team-1', runtimeScopeKey: 'scope-1', principal: { kind: 'member', user: { key: 'user-1' }, userTeam: { key: 'membership-1', userId: 'user-1', teamKey: 'team-1', status: 'active' } } } as const;
    await expect(attributedTool.execute({ mode: 'greet', occasion: 'onboarding' }, { context: memberContext as never })).resolves.toMatchObject({ message: 'Your account is ready. What would you like to work on first?', showReferralCodeAction: false });

    const returningExecute = (async () => ({ output: { text: 'I reviewed your recent activity in Archive. What should we continue?', toolCalls: [], stopReason: 'stop' } })) as unknown as AgentGreetingExecutor;
    const returningTool = createAgentGuideTool({ executeGreeting: returningExecute });
    const result = await returningTool.execute({ mode: 'greet', occasion: 'returning' }, { context: { teamKey: 'team-1', runtimeScopeKey: 'scope-1', principal: { kind: 'system' } } as const });
    if (result.mode !== 'greet') throw new Error('Expected greeting guidance.');
    expect(result.message).not.toMatch(/recent activity|Archive/i);
  });

  test('does not attach the referral action to returning greetings', async () => {
    const execute = (async () => ({ output: { text: 'Welcome back. What would you like to work on?', toolCalls: [], stopReason: 'stop' } })) as unknown as AgentGreetingExecutor;
    const result = await createAgentGuideTool({ executeGreeting: execute }).execute({ mode: 'greet', occasion: 'returning' }, { context: { teamKey: 'team-1', runtimeScopeKey: 'scope-1', principal: { kind: 'system' } } as const });
    if (result.mode === 'greet') expect(result.showReferralCodeAction).toBe(false);
  });
});
