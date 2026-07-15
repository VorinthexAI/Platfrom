import { afterEach, describe, expect, test } from 'bun:test';
import { registerAgent, resetAgentRegistry } from '@/lib/ai/agents/registry';
import type { AgentRun } from '@/lib/ai/agent-runs/schema';
import { agentRunSchema } from '@/lib/ai/agent-runs/schema';
import type { AgentRunRepository } from '@/lib/ai/agent-runs/types';
import { GuardrailViolationError } from '@/lib/ai/guardrails';
import type { ModelDefinition } from '@/lib/ai/models/types';
import { ProviderError } from '@/lib/ai/providers/errors';
import type { ProviderAdapter, ProviderExecuteRequest, ProviderId } from '@/lib/ai/providers/types';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { newId } from '@/lib/ids';
import { InvalidRunRequestError, runAgentTool, ToolNotGrantedError, type RunAgentToolOptions, type RunAgentToolParams } from './run-agent-tool';

const keys = {
  organization: newId(), scope: newId(), agent: newId(), skill: newId(), tool: newId(),
  action: newId(), model: newId(), anthropic: newId(), openrouter: newId(),
};

afterEach(() => resetAgentRegistry());

function memoryRuns(): { repository: AgentRunRepository; store: Map<string, AgentRun> } {
  const store = new Map<string, AgentRun>();
  const repository: AgentRunRepository = {
    async insertRun(input) {
      const run = agentRunSchema.parse({ ...input, key: newId(), createdAt: new Date().toISOString() });
      store.set(run.key, run);
      return run;
    },
    async getRunById(key) { return store.get(key) ?? null; },
    async listRunsForOrganization(organizationKey) { return [...store.values()].filter((run) => run.organizationKey === organizationKey); },
  };
  return { repository, store };
}

interface MockAdapter extends ProviderAdapter { calls: ProviderExecuteRequest[] }

function mockAdapter(id: ProviderId, behavior: (request: ProviderExecuteRequest) => unknown): MockAdapter {
  const calls: ProviderExecuteRequest[] = [];
  return {
    id,
    name: id,
    calls,
    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) {
      calls.push(request as ProviderExecuteRequest);
      const output = behavior(request as ProviderExecuteRequest);
      return { output: output as TOutput, usage: tokenUsage(12, 34), providerId: id, modelId: request.modelId, externalModelId: request.externalModelId };
    },
  };
}

const chatModel: ModelDefinition = {
  id: 'anthropic.claude-sonnet',
  name: 'Claude Sonnet',
  actions: ['core.ask', 'core.reason'],
  actionProfiles: {
    'core.ask': { quality: 0.9, speed: 0.5, costEfficiency: 0.5, reliability: 0.95 },
    'core.reason': { quality: 0.95, speed: 0.4, costEfficiency: 0.4, reliability: 0.95 },
  },
  routes: [
    { providerId: 'anthropic', externalModelId: 'claude-sonnet-test', enabled: true },
    { providerId: 'openrouter', externalModelId: 'anthropic/claude-sonnet-test', enabled: true },
  ],
  enabled: true,
};

function optionsWith(overrides: Partial<RunAgentToolOptions> = {}): RunAgentToolOptions & { store: Map<string, AgentRun> } {
  const { repository, store } = memoryRuns();
  return {
    models: [chatModel],
    organizationProviders: { async listProviderIds() { return ['anthropic', 'openrouter']; } },
    runs: repository,
    runKeys: {
      async resolveActionKey() { return keys.action; },
      async resolveModelKey() { return keys.model; },
      async resolveProviderKey(providerId) { return providerId === 'anthropic' ? keys.anthropic : keys.openrouter; },
    },
    store,
    ...overrides,
  };
}

const chatInput = { messages: [{ role: 'user' as const, content: 'hello' }] };

function params(overrides: Partial<RunAgentToolParams> = {}): RunAgentToolParams {
  return {
    agentId: 'vorinthex.assistant', toolId: 'ask.answer',
    organizationKey: keys.organization, scopeKey: keys.scope, agentKey: keys.agent,
    skillKey: keys.skill, toolKey: keys.tool, stepId: 'answer-request',
    status: 'accepted', reason: 'Request matches engineering scope', score: 0.94, input: chatInput,
    ...overrides,
  };
}

describe('runAgentTool — call-level usage ledger', () => {
  test('records provider usage as one exact model call', async () => {
    const anthropic = mockAdapter('anthropic', () => ({ text: 'hi', toolCalls: [], stopReason: 'end_turn' }));
    const options = optionsWith({ adapters: { anthropic } });
    const { response, run } = await runAgentTool<{ text: string }>(params(), options);

    expect(response.output.text).toBe('hi');
    expect(run.status).toBe('accepted');
    expect(run.organizationKey).toBe(keys.organization);
    expect(run.callsCount).toBe(1);
    expect(run.calls[0]).toMatchObject({ skillKey: keys.skill, toolKey: keys.tool, actionKey: keys.action, modelKey: keys.model, providerKey: keys.anthropic, inputTokens: 12, outputTokens: 34, totalTokens: 46 });
    expect(run.steps[0]).toMatchObject({ stepId: 'answer-request', status: 'completed', inputTokens: 12, outputTokens: 34, totalTokens: 46 });
    expect(run.totalTokens).toBe(46);
    expect(options.store.get(run.key)).toEqual(run);
    expect((anthropic.calls[0]?.input as { system?: string }).system).toContain('# Vorinthex Assistant');
  });

  test('records every real fallback attempt separately', async () => {
    const anthropic = mockAdapter('anthropic', () => { throw new ProviderError('anthropic', 'provider_unavailable', 'down'); });
    const openrouter = mockAdapter('openrouter', () => ({ text: 'fallback' }));
    const { run } = await runAgentTool(params(), optionsWith({ adapters: { anthropic, openrouter } }));

    expect(run.callsCount).toBe(2);
    expect(run.calls.map((call) => call.providerKey)).toEqual([keys.anthropic, keys.openrouter]);
    expect(run.calls.map((call) => call.totalTokens)).toEqual([0, 46]);
    expect(run.totalTokens).toBe(46);
    expect(run.providerKeys).toEqual([keys.anthropic, keys.openrouter]);
  });

  test('persists a failed step with the attempted call and rethrows', async () => {
    const anthropic = mockAdapter('anthropic', () => { throw new ProviderError('anthropic', 'invalid_input', 'bad'); });
    const options = optionsWith({ adapters: { anthropic } });
    await expect(runAgentTool(params(), options)).rejects.toThrow();

    const [run] = [...options.store.values()];
    expect(run?.status).toBe('accepted');
    expect(run?.steps[0]?.status).toBe('failed');
    expect(run?.calls).toHaveLength(1);
    expect(run?.totalTokens).toBe(0);
  });

  test('blocks guardrails and ungranted tools before creating a run', async () => {
    registerAgent({ id: 'org.guardrailed', name: 'Guardrailed', description: 'Scoped', skill: 'Support only.', toolIds: ['ask.answer'], guardrails: [{ scopeId: 'scope_support' }] });
    const anthropic = mockAdapter('anthropic', () => ({ text: 'never' }));
    const guarded = optionsWith({ adapters: { anthropic } });
    await expect(runAgentTool(params({ agentId: 'org.guardrailed' }), guarded)).rejects.toBeInstanceOf(GuardrailViolationError);
    expect(guarded.store.size).toBe(0);

    const ungranted = optionsWith({ adapters: {} });
    await expect(runAgentTool(params({ toolId: 'image.create', input: {} }), ungranted)).rejects.toBeInstanceOf(ToolNotGrantedError);
    expect(ungranted.store.size).toBe(0);
  });

  test('uses the organization allow-list and rejects malformed metadata', async () => {
    const anthropic = mockAdapter('anthropic', () => ({ text: 'never' }));
    const openrouter = mockAdapter('openrouter', () => ({ text: 'allowed' }));
    const options = optionsWith({
      adapters: { anthropic, openrouter },
      organizationProviders: { async listProviderIds() { return ['openrouter']; } },
    });
    const { run } = await runAgentTool(params(), options);
    expect(run.providerKeys).toEqual([keys.openrouter]);
    expect(anthropic.calls).toHaveLength(0);

    await expect(runAgentTool(params({ reason: 'one two three four five six seven eight nine ten eleven' }), options)).rejects.toBeInstanceOf(InvalidRunRequestError);
  });
});
