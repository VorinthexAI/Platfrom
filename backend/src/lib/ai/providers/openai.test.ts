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

describe('OpenAI provider transcription', () => {
  test('sends 24k mono PCM16 as WAV to the multipart transcription API', async () => {
    let requestUrl = '';
    let requestBody: FormData | undefined;
    globalThis.fetch = (async (input, init) => {
      requestUrl = String(input);
      requestBody = init?.body as FormData;
      return Response.json({
        text: '  Hello @Oscar.  ',
        usage: { type: 'tokens', input_tokens: 8, output_tokens: 3, total_tokens: 11 },
      });
    }) as typeof fetch;

    const provider = createOpenAIProvider({ apiKey: 'test-key' });
    const response = await provider.execute({
      actionId: 'transcribe',
      modelId: 'openai.gpt-4o-mini-transcribe',
      externalModelId: 'gpt-4o-mini-transcribe',
      input: {
        audioBase64: Buffer.from([1, 0, 2, 0]).toString('base64'),
        mimeType: 'audio/pcm',
        language: 'en',
        prompt: 'Oscar is a person name.',
      },
      organizationKey: 'organization',
    });

    expect(requestUrl).toEndWith('/audio/transcriptions');
    expect(requestBody).toBeInstanceOf(FormData);
    expect(requestBody?.get('model')).toBe('gpt-4o-mini-transcribe');
    expect(requestBody?.get('language')).toBe('en');
    expect(String(requestBody?.get('prompt'))).toContain('Oscar is a person name.');
    const file = requestBody?.get('file') as File;
    expect(file.name).toBe('audio.wav');
    expect(file.type).toBe('audio/wav');
    expect(Buffer.from(await file.arrayBuffer()).subarray(0, 12).toString('ascii')).toBe('RIFF(\u0000\u0000\u0000WAVE');
    expect(response.output).toEqual({ text: 'Hello @Oscar.' });
    expect(response.usage).toEqual({ inputTokens: 8, outputTokens: 3, totalTokens: 11 });
    expect(response.providerId).toBe('openai');
    expect(response.modelId).toBe('openai.gpt-4o-mini-transcribe');
    expect(response.externalModelId).toBe('gpt-4o-mini-transcribe');
  });
});

describe('OpenAI Realtime provider', () => {
  test('accepts the complete Archive speech action contract', () => {
    expect(speechInputSchema.parse({ text: 'Read this', voice: 'marin', format: 'wav', language: 'English', speakingRate: 1.25 }))
      .toEqual({ text: 'Read this', voice: 'marin', format: 'wav', language: 'English', speakingRate: 1.25 });
  });

  test('uses Realtime 2 for chat, transcription, and speech', async () => {
    const source = await Bun.file(new URL('./openai.ts', import.meta.url)).text();
    expect(source).toContain("OPENAI_REALTIME_MODEL = 'gpt-realtime-2'");
    expect(source.match(/OpenAIRealtimeWebSocket\.create/g)?.length).toBeGreaterThanOrEqual(3);
    expect(source).toContain("request.actionId === 'transcribe' && request.externalModelId === OPENAI_REALTIME_MODEL");
    expect(source).toContain("request.actionId === 'speak'");
    expect(source).toContain("voice: input.voice");
    expect(source).not.toContain('client.audio.speech.create');
  });
});
