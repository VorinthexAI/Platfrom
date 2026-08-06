import { afterEach, describe, expect, test } from 'bun:test';
import { createOpenAIProvider } from './openai';
import { EMBEDDING_DIMENSIONS } from '@/lib/openai-embeddings';

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe('OpenAI provider embeddings', () => {
  test('uses the embeddings API and normalizes vectors in input order', async () => {
    let requestBody: unknown;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({
        object: 'list',
        model: 'text-embedding-3-small',
        data: [
          { object: 'embedding', index: 1, embedding: [0, 1] },
          { object: 'embedding', index: 0, embedding: [1, 0] },
        ],
        usage: { prompt_tokens: 4, total_tokens: 4 },
      });
    }) as typeof fetch;

    const provider = createOpenAIProvider({ apiKey: 'test-key' });
    const response = await provider.embed?.({
      externalModelId: 'text-embedding-3-small',
      input: ['first', 'second'],
    });

    expect(requestBody).toEqual({
      model: 'text-embedding-3-small',
      input: ['first', 'second'],
      encoding_format: 'float',
    });
    expect(response?.embeddings).toEqual([[1, 0], [0, 1]]);
    expect(response?.usage).toEqual({ inputTokens: 4, outputTokens: 0, totalTokens: 4 });
  });

  test('executes the routed embed action at 1536 dimensions', async () => {
    const embedding = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.5);
    let requestBody: Record<string, unknown> | undefined;
    globalThis.fetch = (async (_input, init) => {
      requestBody = JSON.parse(String(init?.body));
      return Response.json({ object: 'list', model: 'text-embedding-3-small', data: [{ object: 'embedding', index: 0, embedding }], usage: { prompt_tokens: 2, total_tokens: 2 } });
    }) as typeof fetch;

    const response = await createOpenAIProvider({ apiKey: 'test-key' }).execute({
      actionId: 'embed',
      modelId: 'openai.text-embedding-3-small',
      externalModelId: 'text-embedding-3-small',
      input: { text: 'hello' },
      organizationKey: 'organization',
    });

    expect(requestBody).toMatchObject({ model: 'text-embedding-3-small', dimensions: 1_536, input: 'hello' });
    expect(response.output).toEqual({ embedding });
    expect(response.providerId).toBe('openai');
  });
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
