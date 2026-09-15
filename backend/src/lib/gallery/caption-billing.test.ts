import { expect, test } from 'bun:test';
import type { ProviderExecuteRequest } from '@/lib/ai/providers';
import { tokenUsage } from '@/lib/ai/shared';
import { newId } from '@/lib/ids';
import { executeGalleryCaptionBatch } from './upload-processing';

test('a twenty-image Gallery caption job reports tokens and falls back to action Spark billing', async () => {
  const imageUrls = Array.from({ length: 20 }, (_, index) => `https://images.example/${index}.png`);
  const events: Array<Record<string, unknown>> = [];
  const charges: Array<Record<string, unknown>> = [];
  let providerRequest: ProviderExecuteRequest | undefined;
  const captions = await executeGalleryCaptionBatch({
    actorKey: newId(),
    imageUrls,
    requestKey: 'gallery-caption-performance-fixture',
    scopeKey: newId(),
    teamKey: newId(),
    userKey: newId(),
  }, {
    appScopeKey: newId(),
    adapters: {
      openrouter: {
        id: 'openrouter',
        name: 'OpenRouter',
        async execute<TInput, TOutput>(request: ProviderExecuteRequest<TInput>) {
          providerRequest = request as ProviderExecuteRequest;
          return {
            output: { results: imageUrls.map((_, index) => ({ caption: `Caption ${index + 1}.`, score: 90 })) } as TOutput,
            usage: tokenUsage(20_000, 2_000),
            providerId: 'openrouter' as const,
            modelId: request.modelId,
            externalModelId: request.externalModelId,
          };
        },
      },
    },
    recordEvent: async (event) => { events.push(event as unknown as Record<string, unknown>); },
    billing: {
      getBalance: async () => 1_000_000_000,
      getDebt: async () => 0,
      charge: async (_userKey, input) => {
        charges.push(input as unknown as Record<string, unknown>);
        return { status: 'replayed', transaction: { key: 'caption-charge', eventKey: input.eventKey } } as never;
      },
    },
  });

  const report = {
    imageCount: captions.length,
    inputTokens: 20_000,
    outputTokens: 2_000,
    totalTokens: 22_000,
    microSparks: 1_600_000,
    sparks: 1.6,
  };
  expect(report).toMatchObject({ imageCount: 20, inputTokens: 20_000, outputTokens: 2_000, totalTokens: 22_000, microSparks: 1_600_000, sparks: 1.6 });
  expect(providerRequest).toMatchObject({ actionId: 'image', modelId: 'google.gemini-3.1-flash-lite', externalModelId: 'google/gemini-3.1-flash-lite', input: { operation: 'caption', imageUrls } });
  expect(charges).toHaveLength(1);
  expect(charges[0]).toMatchObject({ kind: 'action', actionSlug: 'image', microSparks: 1_600_000, metadata: { inputTokens: 20_000, outputTokens: 2_000, totalTokens: 22_000, amountMicroSparks: 1_600_000 } });
  expect(events).toHaveLength(1);
  expect(events[0]).toMatchObject({ slug: 'image.caption', status: 'completed', inputTokens: 20_000, outputTokens: 2_000, totalTokens: 22_000, microSparks: 1_600_000, sparkTransactionKey: 'caption-charge' });
});
