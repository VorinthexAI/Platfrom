import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { createAzureAIFoundryProvider } from './azure-ai-foundry';

describe('Azure AI Foundry provider', () => {
  test('uses the Azure deployment for 1536-dimensional embeddings', async () => {
    let receivedUrl = '';
    let receivedBody: any;
    const vector = Array.from({ length: EMBEDDING_DIMENSIONS }, () => 0.25);
    const fetcher = (async (url: string | URL | Request, init?: RequestInit) => {
      receivedUrl = String(url);
      receivedBody = JSON.parse(String(init?.body));
      return Response.json({ data: [{ embedding: vector, index: 0, object: 'embedding' }], model: 'text-embedding-3-small', object: 'list', usage: { prompt_tokens: 2, total_tokens: 2 } });
    }) as typeof fetch;
    const provider = createAzureAIFoundryProvider({ apiKey: 'key', endpoint: 'https://resource.openai.azure.com/openai/v1' }, fetcher);
    const result = await provider.embed!({ externalModelId: 'text-embedding-3-small', input: 'hello', dimensions: EMBEDDING_DIMENSIONS });

    expect(receivedUrl).toBe('https://resource.openai.azure.com/openai/v1/embeddings');
    expect(receivedBody).toEqual({ model: 'text-embedding-3-small', input: 'hello', dimensions: EMBEDDING_DIMENSIONS, encoding_format: 'float' });
    expect(result.embeddings).toEqual([vector]);
    expect(result.providerId).toBe('azure-ai-foundry');
  });

});
