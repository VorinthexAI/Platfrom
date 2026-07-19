import { describe, expect, test } from 'bun:test';
import { embed } from './embed';
import type { ProviderAdapter } from './ai/providers/types';

describe('semantic embeddings', () => {
  test('route through the canonical OpenAI provider', async () => {
    const requests: unknown[] = [];
    const provider: ProviderAdapter = {
      id: 'openai',
      name: 'OpenAI',
      async execute() { throw new Error('not used'); },
      async embed(request) {
        requests.push(request);
        return { embeddings: [[0.25, 0.75]], usage: { inputTokens: 2, outputTokens: 0, totalTokens: 2 }, providerId: 'openai', externalModelId: request.externalModelId };
      },
    };
    await expect(embed({ text: 'Backend Developer' }, { provider })).resolves.toEqual([0.25, 0.75]);
    expect(requests).toEqual([{ externalModelId: 'text-embedding-3-small', input: 'Backend Developer' }]);
  });

  test('fails clearly when no explicit provider adapter is supplied', async () => {
    await expect(embed({ text: 'Backend Developer' })).rejects.toThrow('Supply an explicit provider adapter');
  });

  test('chunks long documents and returns one normalized aggregate vector', async () => {
    const requests: unknown[] = [];
    const provider: ProviderAdapter = {
      id: 'openai',
      name: 'OpenAI',
      async execute() { throw new Error('not used'); },
      async embed(request) {
        requests.push(request);
        return { embeddings: [[1, 0], [0, 1]], usage: { inputTokens: 2, outputTokens: 0, totalTokens: 2 }, providerId: 'openai', externalModelId: request.externalModelId };
      },
    };
    const vector = await embed({ text: 'x'.repeat(4_001) }, { provider });
    expect(requests).toEqual([{ externalModelId: 'text-embedding-3-small', input: ['x'.repeat(4_000), 'x'] }]);
    expect(vector[0]).toBeCloseTo(Math.SQRT1_2);
    expect(vector[1]).toBeCloseTo(Math.SQRT1_2);
  });
});
