import { describe, expect, test } from 'bun:test';
import { tokenUsage } from '@/lib/ai/shared/usage';
import { ProviderError } from '@/lib/ai/providers/errors';
import type { ModelDefinition } from '@/lib/ai/models/types';
import type { ProviderAdapter, ProviderExecuteRequest, ProviderId } from '@/lib/ai/providers/types';
import { ProviderExecutionError } from './errors';
import { executeAction, executeRouteWithFallbacks } from './execute-route';
import type { RouteDecision, RouterDependencies } from './types';

const ORG = 'org_test';

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
        usage: tokenUsage(10, 5),
        providerId: id,
        modelId: request.modelId,
        externalModelId: request.externalModelId,
      };
    },
  };
}

function failingAdapter(id: ProviderId, error: ProviderError): MockAdapter {
  return mockAdapter(id, () => {
    throw error;
  });
}

function chatDecision(overrides: Partial<RouteDecision> = {}): RouteDecision {
  return {
    actionId: 'core.ask',
    organizationId: ORG,
    modelId: 'anthropic.claude-sonnet',
    providerId: 'anthropic',
    externalModelId: 'claude-sonnet-test',
    score: 0.9,
    fallbacks: [
      { modelId: 'anthropic.claude-sonnet', providerId: 'openrouter', externalModelId: 'anthropic/claude-sonnet-test', score: 0.8 },
    ],
    ...overrides,
  };
}

describe('executeRouteWithFallbacks', () => {
  test('returns the normalized provider response on success', async () => {
    const anthropic = mockAdapter('anthropic', () => ({ text: 'hello', toolCalls: [], stopReason: 'end_turn' }));
    const response = await executeRouteWithFallbacks<unknown, { text: string }>({
      decision: chatDecision(),
      input: { messages: [{ role: 'user', content: 'hi' }] },
      adapters: { anthropic },
    });
    expect(response.output.text).toBe('hello');
    expect(response.usage).toEqual({ inputTokens: 10, outputTokens: 5, totalTokens: 15 });
    expect(response.providerId).toBe('anthropic');
    expect(response.externalModelId).toBe('claude-sonnet-test');
    expect(anthropic.calls).toHaveLength(1);
    expect(anthropic.calls[0]?.organizationId).toBe(ORG);
  });

  test('falls back to the next route on a retryable failure', async () => {
    const anthropic = failingAdapter('anthropic', new ProviderError('anthropic', 'provider_unavailable', 'down'));
    const openrouter = mockAdapter('openrouter', () => ({ text: 'fallback answer' }));
    const response = await executeRouteWithFallbacks<unknown, { text: string }>({
      decision: chatDecision(),
      input: { messages: [{ role: 'user', content: 'hi' }] },
      adapters: { anthropic, openrouter },
    });
    expect(response.output.text).toBe('fallback answer');
    expect(response.providerId).toBe('openrouter');
    expect(anthropic.calls).toHaveLength(1);
    expect(openrouter.calls).toHaveLength(1);
  });

  test('does not fall back on a non-retryable validation failure', async () => {
    const anthropic = failingAdapter('anthropic', new ProviderError('anthropic', 'invalid_input', 'bad request'));
    const openrouter = mockAdapter('openrouter', () => ({ text: 'never' }));
    const promise = executeRouteWithFallbacks({
      decision: chatDecision(),
      input: {},
      adapters: { anthropic, openrouter },
    });
    expect(promise).rejects.toBeInstanceOf(ProviderExecutionError);
    await promise.catch((error: ProviderExecutionError) => {
      expect(error.attempts).toHaveLength(1);
      expect(error.attempts[0]?.code).toBe('invalid_input');
    });
    expect(openrouter.calls).toHaveLength(0);
  });

  test('a decision without fallbacks (fixed mode) never tries another provider', async () => {
    const anthropic = failingAdapter('anthropic', new ProviderError('anthropic', 'provider_unavailable', 'down'));
    const openrouter = mockAdapter('openrouter', () => ({ text: 'never' }));
    const promise = executeRouteWithFallbacks({
      decision: chatDecision({ fallbacks: [] }),
      input: {},
      adapters: { anthropic, openrouter },
    });
    expect(promise).rejects.toBeInstanceOf(ProviderExecutionError);
    await promise.catch(() => undefined);
    expect(anthropic.calls).toHaveLength(1);
    expect(openrouter.calls).toHaveLength(0);
  });

  test('non-idempotent actions never fall back after an ambiguous failure', async () => {
    // response_invalid is retryable in general, but it happens AFTER the
    // provider executed — for image.generate a second attempt could create
    // a second billable image, so the chain must stop.
    const openai = failingAdapter('openai', new ProviderError('openai', 'response_invalid', 'garbled'));
    const openrouter = mockAdapter('openrouter', () => ({ images: [] }));
    const decision = chatDecision({
      actionId: 'image.generate',
      modelId: 'openai.gpt-image',
      providerId: 'openai',
      externalModelId: 'gpt-image-test',
      fallbacks: [{ modelId: 'openai.gpt-image', providerId: 'openrouter', externalModelId: 'x/gpt-image', score: 0.5 }],
    });
    expect(
      executeRouteWithFallbacks({ decision, input: {}, adapters: { openai, openrouter } }),
    ).rejects.toBeInstanceOf(ProviderExecutionError);
    await Bun.sleep(0);
    expect(openrouter.calls).toHaveLength(0);
  });

  test('non-idempotent actions still fall back on provably pre-execution failures', async () => {
    const openai = failingAdapter('openai', new ProviderError('openai', 'rate_limited', 'slow down'));
    const openrouter = mockAdapter('openrouter', () => ({ images: [{ base64: 'aa', mimeType: 'image/png' }] }));
    const decision = chatDecision({
      actionId: 'image.generate',
      modelId: 'openai.gpt-image',
      providerId: 'openai',
      externalModelId: 'gpt-image-test',
      fallbacks: [{ modelId: 'openai.gpt-image', providerId: 'openrouter', externalModelId: 'x/gpt-image', score: 0.5 }],
    });
    const response = await executeRouteWithFallbacks<unknown, { images: unknown[] }>({
      decision,
      input: {},
      adapters: { openai, openrouter },
    });
    expect(response.providerId).toBe('openrouter');
    expect(openai.calls).toHaveLength(1);
    expect(openrouter.calls).toHaveLength(1);
  });

  test('an already-aborted signal stops before any provider is called', async () => {
    const anthropic = mockAdapter('anthropic', () => ({ text: 'never' }));
    const controller = new AbortController();
    controller.abort();
    const promise = executeRouteWithFallbacks({
      decision: chatDecision(),
      input: {},
      adapters: { anthropic },
      signal: controller.signal,
    });
    expect(promise).rejects.toMatchObject({ code: 'aborted' });
    await promise.catch(() => undefined);
    expect(anthropic.calls).toHaveLength(0);
  });

  test('an abort raised by the provider is rethrown without trying fallbacks', async () => {
    const anthropic = mockAdapter('anthropic', () => {
      throw new DOMException('The operation was aborted.', 'AbortError');
    });
    const openrouter = mockAdapter('openrouter', () => ({ text: 'never' }));
    const promise = executeRouteWithFallbacks({
      decision: chatDecision(),
      input: {},
      adapters: { anthropic, openrouter },
    });
    expect(promise).rejects.toMatchObject({ code: 'aborted' });
    await promise.catch(() => undefined);
    expect(openrouter.calls).toHaveLength(0);
  });

  test('the abort signal propagates into the provider request', async () => {
    const controller = new AbortController();
    const anthropic = mockAdapter('anthropic', () => ({ text: 'ok' }));
    await executeRouteWithFallbacks({
      decision: chatDecision(),
      input: {},
      adapters: { anthropic },
      signal: controller.signal,
      timeoutMs: 5000,
    });
    expect(anthropic.calls[0]?.signal).toBe(controller.signal);
    expect(anthropic.calls[0]?.timeoutMs).toBe(5000);
  });

  test('missing adapters are recorded and skipped', async () => {
    const openrouter = mockAdapter('openrouter', () => ({ text: 'via fallback' }));
    const response = await executeRouteWithFallbacks<unknown, { text: string }>({
      decision: chatDecision(),
      input: {},
      adapters: { openrouter },
    });
    expect(response.output.text).toBe('via fallback');
  });
});

describe('executeAction', () => {
  const model: ModelDefinition = {
    id: 'anthropic.claude-sonnet',
    name: 'Claude Sonnet',
    actions: ['core.ask'],
    actionProfiles: { 'core.ask': { quality: 0.9, speed: 0.5, costEfficiency: 0.5, reliability: 0.9 } },
    routes: [
      { providerId: 'anthropic', externalModelId: 'claude-sonnet-test', enabled: true },
      { providerId: 'openrouter', externalModelId: 'anthropic/claude-sonnet-test', enabled: true },
    ],
    enabled: true,
  };

  function deps(adapters: Partial<Record<ProviderId, ProviderAdapter>>): RouterDependencies {
    return {
      models: [model],
      adapters,
      organizationProviders: {
        async listProviderIds() {
          return ['anthropic', 'openrouter'];
        },
      },
    };
  }

  test('routes and executes end to end with fallback', async () => {
    const anthropic = failingAdapter('anthropic', new ProviderError('anthropic', 'provider_unavailable', 'down'));
    const openrouter = mockAdapter('openrouter', () => ({ text: 'routed', toolCalls: [], stopReason: 'stop' }));

    const response = await executeAction<unknown, { text: string }>(
      { mode: 'auto', organizationId: ORG, actionId: 'core.ask' },
      { messages: [{ role: 'user', content: 'hello' }] },
      deps({ anthropic, openrouter }),
    );

    expect(response.output.text).toBe('routed');
    expect(response.providerId).toBe('openrouter');
    expect(anthropic.calls[0]?.externalModelId).toBe('claude-sonnet-test');
    expect(openrouter.calls[0]?.externalModelId).toBe('anthropic/claude-sonnet-test');
    expect(openrouter.calls[0]?.actionId).toBe('core.ask');
    expect(openrouter.calls[0]?.organizationId).toBe(ORG);
  });
});
