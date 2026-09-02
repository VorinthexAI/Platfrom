import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { ProviderError, type ProviderExecuteRequest } from '@/lib/ai/providers';
import { tokenUsage } from '@/lib/ai/shared';
import { executeAction, executeRoute, streamAsk, type RouteAttemptTelemetry } from './execute-route';
import type { RouteDecision } from './types';

const decision: RouteDecision = { organizationKey: newId(), actionSlug: 'text', modelSlug: 'google.gemini-3.1-flash-lite', providerSlug: 'openrouter', providerModelId: 'google/gemini-3.1-flash-lite' };

describe('route execution', () => {
  test('executes exactly one route and reports provider token usage', async () => {
    const calls: ProviderExecuteRequest[] = [];
    const telemetry: RouteAttemptTelemetry[] = [];
    const response = await executeRoute({ decision, input: { prompt: 'hello' }, adapters: { openrouter: { id: 'openrouter', name: 'OpenRouter', async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) { calls.push(request as ProviderExecuteRequest); return { output: { metadata: { status: 'accepted' } } as TOutput, usage: tokenUsage(3, 2), providerId: 'openrouter', modelId: request.modelId, externalModelId: request.externalModelId }; } } }, onAttempt: (attempt) => { telemetry.push(attempt); } });
    expect(calls).toHaveLength(1);
    expect(response.usage.totalTokens).toBe(5);
    expect(telemetry[0]).toMatchObject({ modelSlug: decision.modelSlug, providerSlug: 'openrouter', status: 'completed', usage: { totalTokens: 5 } });
  });

  test('passes optional provider cost through to attempt telemetry', async () => {
    const telemetry: RouteAttemptTelemetry[] = [];
    const response = await executeRoute({ decision, input: { prompt: 'hello' }, adapters: { openrouter: { id: 'openrouter', name: 'OpenRouter', async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) { return { output: {} as TOutput, usage: tokenUsage(1, 2), costUsd: 0.13, providerId: 'openrouter', modelId: request.modelId, externalModelId: request.externalModelId }; } } }, onAttempt: (attempt) => { telemetry.push(attempt); } });
    expect(response.costUsd).toBe(0.13);
    expect(telemetry[0]).toMatchObject({ status: 'completed', usage: { totalTokens: 3 }, costUsd: 0.13 });
  });

  test('accepts provider slots with retry interval and attempt options', async () => {
    let calls = 0;
    const response = await executeAction({ mode: 'auto', organizationKey: newId(), actionSlug: 'text' }, { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] }, {
      providers: ['text.primary'], retry: { intervalMs: 1, attempts: 2 },
      adapters: { openrouter: { id: 'openrouter', name: 'OpenRouter', async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) { calls += 1; if (calls === 1) throw new ProviderError('openrouter', 'rate_limited', 'limited', { status: 429 }); return { output: { text: 'ok' } as TOutput, usage: tokenUsage(), providerId: 'openrouter', modelId: request.modelId, externalModelId: request.externalModelId }; } } },
    });
    expect(calls).toBe(2);
    expect(response.providerId).toBe('openrouter');
  });

  test('does not retry invalid input', async () => {
    let calls = 0;
    await expect(executeAction({ mode: 'auto', organizationKey: newId(), actionSlug: 'text' }, { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] }, {
      providers: ['text.primary'], retry: { intervalMs: 1, attempts: 2 },
      adapters: { openrouter: { id: 'openrouter', name: 'OpenRouter', async execute() { calls += 1; throw new ProviderError('openrouter', 'invalid_input', 'invalid'); } } },
    })).rejects.toMatchObject({ code: 'provider_execution_failed' });
    expect(calls).toBe(1);
  });

  test('retries rate-limited streams only before the first emitted chunk', async () => {
    let calls = 0;
    const chunks = [];
    for await (const chunk of streamAsk(newId(), { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] }, {
      retry: { intervalMs: 1, attempts: 2 },
      adapters: { openrouter: { id: 'openrouter', name: 'OpenRouter', async execute() { throw new Error('unused'); }, async *stream() { calls += 1; if (calls === 1) throw new ProviderError('openrouter', 'rate_limited', 'limited', { status: 429 }); yield { type: 'text-delta' as const, text: 'ok' }; yield { type: 'done' as const }; } } },
    })) chunks.push(chunk);
    expect(calls).toBe(2);
    expect(chunks).toEqual([{ type: 'text-delta', text: 'ok' }, { type: 'done' }]);

    calls = 0;
    const partial: unknown[] = [];
    await expect((async () => {
      for await (const chunk of streamAsk(newId(), { messages: [{ role: 'user', content: [{ type: 'text', text: 'Hello' }] }] }, {
        retry: { intervalMs: 1, attempts: 2 },
        adapters: { openrouter: { id: 'openrouter', name: 'OpenRouter', async execute() { throw new Error('unused'); }, async *stream() { calls += 1; yield { type: 'text-delta' as const, text: 'partial' }; throw new ProviderError('openrouter', 'rate_limited', 'limited', { status: 429 }); } } },
      })) partial.push(chunk);
    })()).rejects.toMatchObject({ code: 'provider_execution_failed' });
    expect(calls).toBe(1);
    expect(partial).toEqual([{ type: 'text-delta', text: 'partial' }]);
  });
});
