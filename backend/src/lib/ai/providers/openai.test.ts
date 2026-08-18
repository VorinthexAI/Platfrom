import { afterEach, describe, expect, test } from 'bun:test';
import { createOpenAIProvider } from './openai';
import { LEGACY_EMBEDDING_DIMENSIONS, LEGACY_EXTERNAL_EMBEDDING_MODEL_ID } from '@/lib/embedding-constants';
import { speechInputSchema } from './types';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('retains only generic legacy embedding compatibility for persisted rollout routes', async () => {
  const embedding = Array(LEGACY_EMBEDDING_DIMENSIONS).fill(0.25);
  globalThis.fetch = (async () => Response.json({ data: [{ index: 0, embedding }], usage: { prompt_tokens: 2, total_tokens: 2 } })) as unknown as typeof fetch;
  const provider = createOpenAIProvider({ apiKey: 'test-key' });
  const result = await provider.embed!({ externalModelId: LEGACY_EXTERNAL_EMBEDDING_MODEL_ID, input: 'legacy' });
  expect(result.embeddings).toEqual([embedding]);
  await expect(provider.embed!({ externalModelId: 'qwen/qwen3-embedding-8b', input: 'current' })).rejects.toMatchObject({ code: 'unsupported_action' });
});

describe('OpenAI Realtime provider', () => {
  test('accepts the complete Archive speech action contract', () => {
    expect(speechInputSchema.parse({ text: 'Read this', voice: 'marin', format: 'wav', language: 'English', speakingRate: 1.25 }))
      .toEqual({ text: 'Read this', voice: 'marin', format: 'wav', language: 'English', speakingRate: 1.25 });
  });

  test('uses Realtime 2 for chat and speech', async () => {
    const source = await Bun.file(new URL('./openai.ts', import.meta.url)).text();
    expect(source).toContain("OPENAI_REALTIME_MODEL = 'gpt-realtime-2'");
    expect(source.match(/OpenAIRealtimeWebSocket\.create/g)?.length).toBeGreaterThanOrEqual(2);
    expect(source).toContain("request.actionId === 'speak'");
    expect(source).toContain("voice: input.voice");
    expect(source).not.toContain('client.audio.speech.create');
  });
});
