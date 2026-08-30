import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ProviderAdapter, ProviderExecuteRequest } from '@/lib/ai/providers';
import { selectRoute } from './select-route';
import { executeAsk, executeWebSearch } from './execute-route';
import { NoEligibleRouteError, RouteValidationError } from './errors';

const organizationKey = newId();
const unavailableAdapter: ProviderAdapter = { id: 'openrouter', name: 'OpenRouter', async execute() { throw new Error('not executed'); } };
const adapters = { openrouter: unavailableAdapter };

describe('action-definition router', () => {
  test('selects the only declared OpenRouter text route deterministically', async () => {
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'text' }, { adapters })).resolves.toMatchObject({
      modelSlug: 'google.gemini-3.1-flash-lite-preview', providerSlug: 'openrouter', providerModelId: 'google/gemini-3.1-flash-lite-preview',
    });
  });

  test('filters model and fixed modes to exact declared registry bindings', async () => {
    await expect(selectRoute({ mode: 'model', organizationKey, actionSlug: 'text', modelSlug: 'google.gemini-3.1-flash-lite-preview' }, { adapters })).resolves.toMatchObject({ providerSlug: 'openrouter' });
    await expect(selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'text', modelSlug: 'google.gemini-3.1-flash-lite-image', providerSlug: 'openrouter' }, { adapters })).rejects.toBeInstanceOf(NoEligibleRouteError);
  });

  test('makes malformed or missing environment configuration unavailable', async () => {
    const request = { mode: 'fixed' as const, organizationKey, actionSlug: 'text' as const, modelSlug: 'google.gemini-3.1-flash-lite-preview' as const, providerSlug: 'openrouter' as const };
    await expect(selectRoute(request, { env: {} })).rejects.toBeInstanceOf(NoEligibleRouteError);
    await expect(selectRoute(request, { env: { OPENROUTER_API_KEY: '' } })).rejects.toBeInstanceOf(NoEligibleRouteError);
    await expect(selectRoute(request, { env: { OPENROUTER_API_KEY: 'key' } })).resolves.toMatchObject({ providerSlug: 'openrouter' });
  });

  test('rejects retired organization provider selectors as unknown fields', async () => {
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'text', organizationProviderKey: 'retired' } as never, { adapters })).rejects.toBeInstanceOf(RouteValidationError);
  });

  test('executes text and web through OpenRouter without forwarding mode', async () => {
    const calls: Array<{ model: string; input: unknown }> = [];
    const openrouter: ProviderAdapter = { id: 'openrouter', name: 'OpenRouter', async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) { calls.push({ model: request.modelId, input: request.input }); return { output: { text: 'ok', toolCalls: [], stopReason: 'stop' } as TOutput, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, providerId: 'openrouter', modelId: request.modelId, externalModelId: request.externalModelId }; } };
    const options = { adapters: { openrouter } };
    const input = { messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }] };
    await executeAsk(organizationKey, input, options);
    await executeAsk(organizationKey, { ...input, mode: 'deep' }, options);
    await executeWebSearch(organizationKey, { prompt: 'Current facts' }, options);
    expect(calls.map(({ model }) => model)).toEqual([
      'google.gemini-3.1-flash-lite-preview',
      'google.gemini-3.1-flash-lite-preview',
      'google.gemini-3.1-flash-lite-preview',
    ]);
    expect(calls.every(({ input: value }) => !('mode' in (value as Record<string, unknown>)))).toBe(true);
  });
});
