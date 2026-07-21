import { afterEach, describe, expect, test } from 'bun:test';
import { BEDROCK_EMBEDDING_MODEL_ID, embedText, embeddingMetadata } from './bedrock-titan';

const originalFetch = globalThis.fetch;
const originalEnvironment = {
  AWS_REGION: process.env.AWS_REGION,
  AWS_DEFAULT_REGION: process.env.AWS_DEFAULT_REGION,
  AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
  AWS_SECRET_ACCESS_KEY: process.env.AWS_SECRET_ACCESS_KEY,
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(originalEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

describe('static Bedrock Titan embeddings', () => {
  test('skips embeddings without AWS credentials', async () => {
    delete process.env.AWS_REGION;
    delete process.env.AWS_DEFAULT_REGION;
    delete process.env.AWS_ACCESS_KEY_ID;
    delete process.env.AWS_SECRET_ACCESS_KEY;
    await expect(embedText({ text: 'Backend Developer' })).resolves.toEqual([]);
  });

  test('invokes the fixed Titan model and records its provider metadata', async () => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'key';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    let request: Request | undefined;
    globalThis.fetch = (async (input, init) => {
      request = new Request(input, init);
      return new Response(JSON.stringify({ embedding: [0.25, 0.75] }), { status: 200 });
    }) as typeof fetch;

    await expect(embedText({ text: 'Backend Developer' })).resolves.toEqual([0.25, 0.75]);
    expect(request?.url).toContain(`/model/${encodeURIComponent(BEDROCK_EMBEDDING_MODEL_ID)}/invoke`);
    await expect(request?.json()).resolves.toEqual({ inputText: 'Backend Developer' });
    expect(embeddingMetadata()).toEqual({ embeddingProvider: 'aws-bedrock', embeddingModel: 'amazon.titan-embed-text-v2' });
  });

  test('chunks long documents and returns one normalized aggregate vector', async () => {
    process.env.AWS_REGION = 'us-east-1';
    process.env.AWS_ACCESS_KEY_ID = 'key';
    process.env.AWS_SECRET_ACCESS_KEY = 'secret';
    let requests = 0;
    globalThis.fetch = (async (_input) => new Response(JSON.stringify({ embedding: requests++ === 0 ? [1, 0] : [0, 1] }), { status: 200 })) as typeof fetch;

    const vector = await embedText({ text: 'x'.repeat(4_001) });
    expect(vector[0]).toBeCloseTo(Math.SQRT1_2);
    expect(vector[1]).toBeCloseTo(Math.SQRT1_2);
  });
});
