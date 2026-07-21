import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { tokenUsage } from '@/lib/ai/shared';
import type { ProviderExecuteRequest } from '@/lib/ai/providers';
import { executeRoute, type RouteAttemptTelemetry } from './execute-route';
import type { RouteDecision } from './types';

const decision: RouteDecision = { organizationKey: newId(), actionKey: newId(), actionSlug: 'chat', modelKey: newId(), modelSlug: 'openai.gpt-5.4-nano', providerKey: newId(), orgProviderKey: newId(), providerSlug: 'openai', providerModelId: 'gpt-5.4-nano', credentialSource: 'organization' };
describe('route execution', () => {
  test('executes exactly one route and reports provider token usage', async () => {
    const calls: ProviderExecuteRequest[] = [];
    const telemetry: RouteAttemptTelemetry[] = [];
    const response = await executeRoute({ decision, input: { prompt: 'hello' }, adapters: { openai: { id: 'openai', name: 'OpenAI', async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) { calls.push(request as ProviderExecuteRequest); return { output: { metadata: { status: 'accepted', reason: 'Request completed', score: 1 } } as TOutput, usage: tokenUsage(3, 2), providerId: 'openai', modelId: request.modelId, externalModelId: request.externalModelId }; } } }, onAttempt: (attempt) => { telemetry.push(attempt); } });
    expect(calls).toHaveLength(1);
    expect(response.usage.totalTokens).toBe(5);
    expect(telemetry[0]).toMatchObject({ modelKey: decision.modelKey, providerKey: decision.providerKey, status: 'completed', usage: { totalTokens: 5 } });
  });
});
