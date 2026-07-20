import { afterEach, describe, expect, test } from 'bun:test';
import { createAwsBedrockProvider } from './aws-bedrock';

const provider = () => createAwsBedrockProvider({ region: 'us-east-1', accessKeyId: 'key', secretAccessKey: 'secret' });
const originalFetch = globalThis.fetch;

afterEach(() => { globalThis.fetch = originalFetch; });

describe('AWS Bedrock provider', () => {
  test('invokes Titan embeddings for embed', async () => {
    let url = '';
    globalThis.fetch = (async (input) => {
      url = String(input);
      return new Response(JSON.stringify({ embedding: [0.25, 0.75], inputTextTokenCount: 3 }), { status: 200 });
    }) as typeof fetch;
    const result = await provider().execute({ actionId: 'embed', modelId: 'amazon.titan-embed-text-v2', externalModelId: 'amazon.titan-embed-text-v2:0', input: { text: 'hello' }, organizationKey: 'organization' });
    expect(result.output).toEqual({ embedding: [0.25, 0.75] });
    expect(result.usage.inputTokens).toBe(3);
    expect(url).toContain('/model/amazon.titan-embed-text-v2%3A0/invoke');
  });
});
