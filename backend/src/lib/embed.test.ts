import { describe, expect, test } from 'bun:test';
import { embed } from './embed';

function cosine(left: number[], right: number[]) { return left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0); }

describe('local semantic embeddings', () => {
  test('are normalized, deterministic, and distinguish unrelated text', async () => {
    const backend = await embed({ text: 'Backend Developer' });
    const same = await embed({ text: 'Backend Developer' });
    const unrelated = await embed({ text: 'Account Executive' });
    expect(backend).toHaveLength(1536);
    expect(backend).toEqual(same);
    expect(cosine(backend, backend)).toBeCloseTo(1, 8);
    expect(cosine(backend, unrelated)).toBeLessThan(0.5);
  });
});
