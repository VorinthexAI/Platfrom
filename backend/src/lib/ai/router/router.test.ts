import { describe, expect, test } from 'bun:test';
import { askAction } from '@/lib/ai/actions/ask';
import { newId } from '@/lib/ids';
import type { ProviderAdapter } from '@/lib/ai/providers';
import { selectRoute } from './select-route';
import { executeAsk, executeWebSearch } from './execute-route';
import { NoEligibleRouteError, RouteValidationError } from './errors';

const organizationKey = newId();
const adapter = (id: 'openai' | 'openrouter'): ProviderAdapter => ({ id, name: id, async execute() { throw new Error('not executed'); } });
const adapters = { openai: adapter('openai'), openrouter: adapter('openrouter') };

describe('action-definition router', () => {
  test('uses descending priority and declaration order deterministically', async () => {
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, { adapters })).resolves.toMatchObject({
      modelSlug: 'google.gemini-2.5-flash-lite', providerSlug: 'openrouter', providerModelId: 'google/gemini-2.5-flash-lite',
    });
    const bindings = askAction.models as Array<{ provider: 'openai' | 'openrouter'; model: typeof askAction.models[number]['model']; priority: number }>;
    const priorities = bindings.map(({ priority }) => priority);
    try {
      bindings[0]!.priority = 50;
      bindings[1]!.priority = 50;
      expect((await selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, { adapters })).modelSlug).toBe(bindings[0]!.model);
    } finally {
      bindings.forEach((binding, index) => { binding.priority = priorities[index]!; });
    }
  });

  test('filters model and fixed modes to exact declared registry bindings', async () => {
    await expect(selectRoute({ mode: 'model', organizationKey, actionSlug: 'ask', modelSlug: 'openai.gpt-5.6-luna' }, { adapters })).resolves.toMatchObject({ providerSlug: 'openai' });
    await expect(selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'ask', modelSlug: 'google.gemini-2.5-flash-lite', providerSlug: 'openai' }, { adapters })).rejects.toBeInstanceOf(NoEligibleRouteError);
  });

  test('makes malformed or missing environment configuration unavailable', async () => {
    await expect(selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'ask', modelSlug: 'openai.gpt-5.6-luna', providerSlug: 'openai' }, { env: {} })).rejects.toBeInstanceOf(NoEligibleRouteError);
    await expect(selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'ask', modelSlug: 'openai.gpt-5.6-luna', providerSlug: 'openai' }, { env: { OPENAI_API_KEY: 'key', OPENAI_BASE_URL: 'not-a-url' } })).rejects.toBeInstanceOf(NoEligibleRouteError);
    await expect(selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'ask', modelSlug: 'openai.gpt-5.6-luna', providerSlug: 'openai' }, { env: { OPENAI_API_KEY: 'key' } })).resolves.toMatchObject({ providerSlug: 'openai' });
  });

  test('rejects retired organization provider selectors as unknown fields', async () => {
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask', organizationProviderKey: 'retired' } as never, { adapters })).rejects.toBeInstanceOf(RouteValidationError);
  });

  test('executes default and deep modes without forwarding routing fields', async () => {
    const calls: Array<{ provider: string; model: string; input: unknown }> = [];
    const makeAdapter = (id: 'openai' | 'openrouter'): ProviderAdapter => ({ id, name: id, async execute<TInput, TOutput>(request: import('@/lib/ai/providers').ProviderExecuteRequest<TInput>) { calls.push({ provider: id, model: request.modelId, input: request.input }); return { output: { text: 'ok', toolCalls: [], stopReason: 'stop' } as TOutput, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, providerId: id, modelId: request.modelId, externalModelId: request.externalModelId }; } });
    const options = { adapters: { openrouter: makeAdapter('openrouter'), openai: makeAdapter('openai') } };
    const input = { messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }] };
    await executeAsk(organizationKey, input, options);
    await executeAsk(organizationKey, { ...input, mode: 'deep' }, options);
    await executeWebSearch(organizationKey, { prompt: 'Current facts' }, options);
    expect(calls.map(({ provider, model }) => [provider, model])).toEqual([['openrouter', 'google.gemini-2.5-flash-lite'], ['openai', 'openai.gpt-5.6-luna'], ['openrouter', 'google.gemini-2.5-flash-lite']]);
    expect(calls.every(({ input: value }) => !('mode' in (value as Record<string, unknown>)))).toBe(true);
  });
});
