import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { tokenUsage } from '@/lib/ai/shared';
import type { ProviderExecuteRequest } from '@/lib/ai/providers';
import { executeRoute, type RouteAttemptTelemetry } from './execute-route';
import type { RouteDecision } from './types';

const decision: RouteDecision = { organizationKey: newId(), actionSlug: 'ask', modelSlug: 'google.gemini-3.5-flash-lite', providerSlug: 'google-vertex', providerModelId: 'gemini-3.5-flash-lite' };
describe('route execution', () => {
  test('executes exactly one route and reports provider token usage', async () => {
    const calls: ProviderExecuteRequest[] = [];
    const telemetry: RouteAttemptTelemetry[] = [];
    const response = await executeRoute({ decision, input: { prompt: 'hello' }, adapters: { 'google-vertex': { id: 'google-vertex', name: 'Vertex', async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) { calls.push(request as ProviderExecuteRequest); return { output: { metadata: { status: 'accepted' } } as TOutput, usage: tokenUsage(3, 2), providerId: 'google-vertex', modelId: request.modelId, externalModelId: request.externalModelId }; } } }, onAttempt: (attempt) => { telemetry.push(attempt); } });
    expect(calls).toHaveLength(1);
    expect(response.usage.totalTokens).toBe(5);
    expect(telemetry[0]).toMatchObject({ modelSlug: decision.modelSlug, providerSlug: decision.providerSlug, status: 'completed', usage: { totalTokens: 5 } });
  });

  test('passes optional provider cost through to attempt telemetry', async () => {
    const telemetry: RouteAttemptTelemetry[] = [];
    const response = await executeRoute({ decision, input: { prompt: 'hello' }, adapters: { 'google-vertex': { id: 'google-vertex', name: 'Vertex', async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) { return { output: {} as TOutput, usage: tokenUsage(1, 2), costUsd: 0.13, providerId: 'google-vertex', modelId: request.modelId, externalModelId: request.externalModelId }; } } }, onAttempt: (attempt) => { telemetry.push(attempt); } });
    expect(response.costUsd).toBe(0.13);
    expect(telemetry[0]).toMatchObject({ status: 'completed', usage: { totalTokens: 3 }, costUsd: 0.13 });
  });
});
