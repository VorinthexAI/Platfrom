import { describe, expect, test } from 'bun:test';
import { traverseNodes } from './data';

const registry = {
  documents: {
    async listPage(after?: string) {
      if (after) return { items: [], nextCursor: null };
      return {
        items: [
          { key: 'one', status: 'active', embedding: [1, 0] },
          { key: 'two', status: 'inactive', embedding: [0, 1] },
        ],
        nextCursor: null,
      };
    },
  },
};

describe('registered node traversal', () => {
  test('selects from any registered node with flat equality fields', async () => {
    await expect(traverseNodes({ node: 'documents', where: { status: 'active' } }, registry)).resolves.toEqual([
      { key: 'one', status: 'active', embedding: [1, 0] },
    ]);
  });

  test('filters supplied embeddings by the required threshold', async () => {
    await expect(traverseNodes({
      node: 'documents',
      similarity: { embedding: [1, 0], threshold: 0.9 },
    }, registry)).resolves.toEqual([
      { key: 'one', status: 'active', embedding: [1, 0], similarity: 1 },
    ]);
  });

  test('returns every matching record across registry pages', async () => {
    const pagedRegistry = {
      documents: {
        async listPage(after?: string) {
          if (!after) return { items: [{ key: 'one', status: 'active', embedding: [] }], nextCursor: 'one' };
          return { items: [{ key: 'two', status: 'active', embedding: [] }], nextCursor: null };
        },
      },
    };
    await expect(traverseNodes({ node: 'documents', where: { status: 'active' } }, pagedRegistry)).resolves.toEqual([
      { key: 'one', status: 'active', embedding: [] },
      { key: 'two', status: 'active', embedding: [] },
    ]);
  });

  test('rejects unknown collections and unsafe selector paths', async () => {
    await expect(traverseNodes({ node: 'missing' }, registry)).rejects.toThrow('Unknown node collection');
    await expect(traverseNodes({ node: 'documents', where: { 'status.value': 'active' } }, registry)).rejects.toThrow();
  });
});
