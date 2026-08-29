import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ProviderAdapter, ProviderExecuteRequest, ProviderId } from '@/lib/ai/providers';
import { selectRoute } from './select-route';
import { executeAsk, executeWebSearch } from './execute-route';
import { NoEligibleRouteError, RouteValidationError } from './errors';

const organizationKey = newId();
const adapter = (id: ProviderId): ProviderAdapter => ({ id, name: id, async execute() { throw new Error('not executed'); } });
const adapters = { 'google-vertex': adapter('google-vertex'), 'azure-ai-foundry': adapter('azure-ai-foundry') };

describe('action-definition router', () => {
  test('selects the only declared Vertex text route deterministically', async () => {
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask' }, { adapters })).resolves.toMatchObject({
      modelSlug: 'google.gemini-3.5-flash-lite', providerSlug: 'google-vertex', providerModelId: 'gemini-3.5-flash-lite',
    });
  });

  test('filters model and fixed modes to exact declared registry bindings', async () => {
    await expect(selectRoute({ mode: 'model', organizationKey, actionSlug: 'ask', modelSlug: 'google.gemini-3.5-flash-lite' }, { adapters })).resolves.toMatchObject({ providerSlug: 'google-vertex' });
    await expect(selectRoute({ mode: 'fixed', organizationKey, actionSlug: 'ask', modelSlug: 'google.gemini-3.5-flash-lite', providerSlug: 'azure-ai-foundry' }, { adapters })).rejects.toBeInstanceOf(NoEligibleRouteError);
  });

  test('makes malformed or missing environment configuration unavailable', async () => {
    const request = { mode: 'fixed' as const, organizationKey, actionSlug: 'ask' as const, modelSlug: 'google.gemini-3.5-flash-lite' as const, providerSlug: 'google-vertex' as const };
    await expect(selectRoute(request, { env: {} })).rejects.toBeInstanceOf(NoEligibleRouteError);
    await expect(selectRoute(request, { env: { GOOGLE_VERTEX_ACCESS_TOKEN: 'token' } })).rejects.toBeInstanceOf(NoEligibleRouteError);
    await expect(selectRoute(request, { env: { GOOGLE_VERTEX_API_KEY: 'key' } })).resolves.toMatchObject({ providerSlug: 'google-vertex' });
  });

  test('rejects retired organization provider selectors as unknown fields', async () => {
    await expect(selectRoute({ mode: 'auto', organizationKey, actionSlug: 'ask', organizationProviderKey: 'retired' } as never, { adapters })).rejects.toBeInstanceOf(RouteValidationError);
  });

  test('executes ask through Gemini 3.5 Flash-Lite and web search through Gemini 3.7 without forwarding mode', async () => {
    const calls: Array<{ provider: string; model: string; input: unknown }> = [];
    const vertex: ProviderAdapter = { id: 'google-vertex', name: 'Vertex', async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) { calls.push({ provider: 'google-vertex', model: request.modelId, input: request.input }); return { output: { text: 'ok', toolCalls: [], stopReason: 'stop' } as TOutput, usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, providerId: 'google-vertex', modelId: request.modelId, externalModelId: request.externalModelId }; } };
    const options = { adapters: { 'google-vertex': vertex } };
    const input = { messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'Hello' }] }] };
    await executeAsk(organizationKey, input, options);
    await executeAsk(organizationKey, { ...input, mode: 'deep' }, options);
    await executeWebSearch(organizationKey, { prompt: 'Current facts' }, options);
    expect(calls.map(({ provider, model }) => [provider, model])).toEqual([
      ['google-vertex', 'google.gemini-3.5-flash-lite'],
      ['google-vertex', 'google.gemini-3.5-flash-lite'],
      ['google-vertex', 'google.gemini-3.7-flash'],
    ]);
    expect(calls.every(({ input: value }) => !('mode' in (value as Record<string, unknown>)))).toBe(true);
  });
});
