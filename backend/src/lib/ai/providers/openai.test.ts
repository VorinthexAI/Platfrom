import { afterEach, describe, expect, test } from 'bun:test';
import { createOpenAIProvider } from './openai';
import { speechInputSchema } from './types';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

test('does not expose a direct OpenAI embedding route', async () => {
  const provider = createOpenAIProvider({ apiKey: 'test-key' });
  expect(provider.embed).toBeUndefined();
  await expect(provider.execute({ actionId: 'embed', modelId: 'openai.text-embedding-3-small', externalModelId: 'text-embedding-3-small', input: { text: 'query' }, organizationKey: 'organization' })).rejects.toMatchObject({ code: 'unsupported_action' });
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
