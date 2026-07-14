import { afterEach, describe, expect, test } from 'bun:test';
import { registerAgent, resetAgentRegistry } from '@/lib/ai/agents/registry';
import { GuardrailViolationError } from '@/lib/ai/guardrails';
import { ProviderError } from '@/lib/ai/providers/errors';
import type { ProviderAdapter, ProviderExecuteRequest, ProviderId } from '@/lib/ai/providers/types';
import type { ModelDefinition } from '@/lib/ai/models/types';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { agentRunSchema, type AgentRun } from '@/lib/ai/agent-runs/schema';
import { AgentRunNotFoundError, type AgentRunRepository } from '@/lib/ai/agent-runs/types';
import { InvalidRunRequestError, runAgentTool, ToolNotGrantedError, type RunAgentToolOptions } from './run-agent-tool';
import { buildOutputMetadata } from './validation';

const ORG = 'org_test';

afterEach(() => resetAgentRegistry());

function memoryRuns(): { repository: AgentRunRepository; store: Map<string, AgentRun> } {
  const store = new Map<string, AgentRun>();
  let sequence = 0;
  const repository: AgentRunRepository = {
    async insertRun(input) {
      const now = new Date().toISOString();
      sequence += 1;
      const run = agentRunSchema.parse({ ...input, key: `run_${sequence}`, createdAt: now, updatedAt: now });
      store.set(run.key, run);
      return run;
    },
    async updateRun(key, patch) {
      const current = store.get(key);
      if (!current) throw new AgentRunNotFoundError(key);
      const next = agentRunSchema.parse({ ...current, ...patch, updatedAt: new Date().toISOString() });
      store.set(key, next);
      return next;
    },
    async getRunById(key) {
      return store.get(key) ?? null;
    },
    async listRunsForOrganization(organizationId) {
      return [...store.values()].filter((run) => run.organizationId === organizationId);
    },
  };
  return { repository, store };
}

interface MockAdapter extends ProviderAdapter {
  calls: ProviderExecuteRequest[];
}

function mockAdapter(id: ProviderId, behavior: (request: ProviderExecuteRequest) => unknown): MockAdapter {
  const calls: ProviderExecuteRequest[] = [];
  return {
    id,
    name: id,
    calls,
    async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) {
      calls.push(request as ProviderExecuteRequest);
      const output = behavior(request as ProviderExecuteRequest);
      return {
        output: output as TOutput,
        usage: tokenUsage(12, 34),
        providerId: id,
        modelId: request.modelId,
        externalModelId: request.externalModelId,
      };
    },
  };
}

const chatModel: ModelDefinition = {
  id: 'anthropic.claude-sonnet',
  name: 'Claude Sonnet',
  actions: ['core.chat', 'core.reason'],
  actionProfiles: {
    'core.chat': { quality: 0.9, speed: 0.5, costEfficiency: 0.5, reliability: 0.95 },
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
    organizationProviders: {
      async listProviderIds() {
        return ['anthropic', 'openrouter'];
      },
    },
    runs: repository,
    store,
    ...overrides,
  };
}

const chatInput = { messages: [{ role: 'user' as const, content: 'hello' }] };

describe('runAgentTool — the execution pipeline', () => {
  test('runs Agent → Tool → Action → Router → Provider and records the run ledger', async () => {
    const anthropic = mockAdapter('anthropic', () => ({ text: 'hi there', toolCalls: [], stopReason: 'end_turn' }));
    const options = optionsWith({ adapters: { anthropic } });

    const { response, run } = await runAgentTool<{ text: string }>(
      { agentId: 'vorinthex.assistant', toolId: 'chat.reply', organizationId: ORG, input: chatInput },
      options,
    );

    expect(response.output.text).toBe('hi there');
    expect(response.providerId).toBe('anthropic');

    // The run records metadata, tokens, timing, steps, and output metadata.
    expect(run.status).toBe('succeeded');
    expect(run.agentId).toBe('vorinthex.assistant');
    expect(run.toolId).toBe('chat.reply');
    expect(run.actionId).toBe('core.chat');
    expect(run.modelId).toBe('anthropic.claude-sonnet');
    expect(run.providerId).toBe('anthropic');
    expect(run.usage).toEqual({ inputTokens: 12, outputTokens: 34, totalTokens: 46 });
    expect(run.steps.map((step) => step.type)).toEqual(['route-selected', 'provider-executed']);
    expect(run.output).toEqual({ type: 'core.chat', stopReason: 'end_turn', itemCount: null });
    expect(run.finishedAt).not.toBeNull();
    expect(run.durationMs).not.toBeNull();
    expect(options.store.get(run.key)).toEqual(run);

    // Prompt compilation: the agent's compiled system prompt reaches the provider.
    const sent = anthropic.calls[0]?.input as { system?: string };
    expect(sent.system).toContain('# Vorinthex Assistant');
    expect(sent.system).toContain('## Available tools');
  });

  test('records the fallback provider that actually executed', async () => {
    const anthropic = mockAdapter('anthropic', () => {
      throw new ProviderError('anthropic', 'provider_unavailable', 'down');
    });
    const openrouter = mockAdapter('openrouter', () => ({ text: 'via fallback', toolCalls: [], stopReason: 'stop' }));
    const options = optionsWith({ adapters: { anthropic, openrouter } });

    const { run } = await runAgentTool(
      { agentId: 'vorinthex.assistant', toolId: 'chat.reply', organizationId: ORG, input: chatInput },
      options,
    );
    expect(run.status).toBe('succeeded');
    expect(run.providerId).toBe('openrouter');
    expect(run.externalModelId).toBe('anthropic/claude-sonnet-test');
  });

  test('records a failed run and rethrows when every route fails', async () => {
    const anthropic = mockAdapter('anthropic', () => {
      throw new ProviderError('anthropic', 'invalid_input', 'bad request');
    });
    const options = optionsWith({ adapters: { anthropic } });

    await expect(
      runAgentTool({ agentId: 'vorinthex.assistant', toolId: 'chat.reply', organizationId: ORG, input: chatInput }, options),
    ).rejects.toThrow();

    const [run] = [...options.store.values()];
    expect(run?.status).toBe('failed');
    expect(run?.error?.code).toBe('provider_execution_failed');
    expect(run?.steps.at(-1)?.type).toBe('provider-failed');
    expect(run?.finishedAt).not.toBeNull();
  });

  test('guardrailed agents are blocked before any run or provider call', async () => {
    registerAgent({
      id: 'org.guardrailed',
      name: 'Guardrailed',
      description: 'Scoped to scope_support only',
      skill: 'Support only.',
      toolIds: ['chat.reply'],
      guardrails: [{ scopeId: 'scope_support' }],
    });
    const anthropic = mockAdapter('anthropic', () => ({ text: 'never' }));
    const options = optionsWith({ adapters: { anthropic } });

    // chat.reply is unscoped — denied for a guardrailed agent.
    await expect(
      runAgentTool({ agentId: 'org.guardrailed', toolId: 'chat.reply', organizationId: ORG, input: chatInput }, options),
    ).rejects.toBeInstanceOf(GuardrailViolationError);
    expect(options.store.size).toBe(0);
    expect(anthropic.calls).toHaveLength(0);
  });

  test('tools not granted to the agent are rejected before any run', async () => {
    const options = optionsWith({ adapters: {} });
    await expect(
      runAgentTool({ agentId: 'vorinthex.assistant', toolId: 'image.create', organizationId: ORG, input: {} }, options),
    ).rejects.toBeInstanceOf(ToolNotGrantedError);
    expect(options.store.size).toBe(0);
  });

  test('the organization allow-list constrains the pipeline end to end', async () => {
    const anthropic = mockAdapter('anthropic', () => ({ text: 'never' }));
    const openrouter = mockAdapter('openrouter', () => ({ text: 'allowed', toolCalls: [], stopReason: 'stop' }));
    const options = optionsWith({
      adapters: { anthropic, openrouter },
      organizationProviders: {
        async listProviderIds() {
          return ['openrouter'];
        },
      },
    });

    const { run } = await runAgentTool(
      { agentId: 'vorinthex.assistant', toolId: 'chat.reply', organizationId: ORG, input: chatInput },
      options,
    );
    expect(run.providerId).toBe('openrouter');
    expect(anthropic.calls).toHaveLength(0);
  });

  test('rejects malformed run requests with a typed error', async () => {
    const options = optionsWith({});
    await expect(
      runAgentTool({ agentId: '', toolId: 'chat.reply', organizationId: ORG, input: {} }, options),
    ).rejects.toBeInstanceOf(InvalidRunRequestError);
    await expect(
      runAgentTool(
        { agentId: 'vorinthex.assistant', toolId: 'chat.reply', organizationId: ORG, input: {}, extra: true } as never,
        options,
      ),
    ).rejects.toBeInstanceOf(InvalidRunRequestError);
    expect(options.store.size).toBe(0);
  });
});

describe('output metadata', () => {
  test('derives shape facts only — never content', () => {
    expect(buildOutputMetadata('core.chat', { text: 'secret content', toolCalls: [], stopReason: 'end_turn' })).toEqual({
      type: 'core.chat',
      stopReason: 'end_turn',
      itemCount: null,
    });
    expect(buildOutputMetadata('image.generate', { images: [{ base64: 'aa', mimeType: 'image/png' }] })).toEqual({
      type: 'image.generate',
      stopReason: null,
      itemCount: 1,
    });
    const metadata = buildOutputMetadata('core.chat', { text: 'secret content' });
    expect(JSON.stringify(metadata)).not.toContain('secret content');
  });
});
