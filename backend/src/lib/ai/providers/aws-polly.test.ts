import { afterEach, describe, expect, test } from 'bun:test';
import { createAwsPollyProvider } from './aws-polly';

const originalFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = originalFetch; });

describe('AWS Polly provider', () => {
  test('synthesizes speak audio with the configured engine', async () => {
    let body = '';
    globalThis.fetch = (async (_input, init) => {
      body = String(init?.body);
      return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'audio/mpeg' } });
    }) as typeof fetch;
    const provider = createAwsPollyProvider({ region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret' });
    const result = await provider.execute({ actionId: 'generate-speech', modelId: 'amazon.polly-generative', externalModelId: 'generative', input: { text: 'Hello', voice: 'Joanna', format: 'mp3' }, organizationKey: 'organization' });
    expect(result.output).toEqual({ audioBase64: 'AQID', mimeType: 'audio/mpeg' });
    expect(JSON.parse(body)).toMatchObject({ Text: 'Hello', VoiceId: 'Joanna', Engine: 'generative' });
  });
});
