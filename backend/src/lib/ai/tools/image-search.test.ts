import { describe, expect, test } from 'bun:test';
import { currentEmbeddingSchema, QWEN_RETRIEVAL_INSTRUCTION } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import type { DomainToolContext } from './domain-execute';
import { imageSearchTool } from './image-search';

const embedding = currentEmbeddingSchema.parse(Array.from({ length: 4_096 }, () => 0.25));
const now = '2026-08-11T12:00:00.000Z';

function context(): DomainToolContext {
  const organizationKey = newId();
  return {
    organizationKey,
    runtimeScopeKey: newId(),
    principal: {
      kind: 'member',
      user: { key: newId() },
      userOrganization: { key: newId(), organizationId: organizationKey, status: 'active', orgRole: 'member' },
      scopeMember: null,
    } as never,
  };
}

function result(scopeKey: string, key = newId()) {
  return {
      image: {
      key, scopeKey, filename: 'mountain.jpg', caption: 'Snow-covered mountains beneath a blue sky.',
      storageKey: 'private/mountain.jpg', mimeType: 'image/jpeg', sizeBytes: 100, width: 1_200, height: 800,
      embedding, imageCaptionKey: null, isFavorite: false, deletedAt: null, createdAt: now, updatedAt: now,
    },
    score: 0.92,
  };
}

describe('image.search tool', () => {
  test('embeds the query and defaults to 50 ordered results without a threshold', async () => {
    const toolContext = context();
    let embedded: unknown;
    let searched: any;
    const output = await imageSearchTool.execute({ query: 'snowy mountain' }, {
      context: toolContext,
      async executeEmbedding(organizationKey, input) {
        embedded = { organizationKey, input };
        return { output: { embedding } } as never;
      },
      async searchImages(input) {
        searched = input;
        return [result(toolContext.runtimeScopeKey)];
      },
    });

    expect(embedded).toEqual({
      organizationKey: toolContext.organizationKey,
      input: { text: `${QWEN_RETRIEVAL_INSTRUCTION}snowy mountain` },
    });
    expect(searched).toMatchObject({
      organizationKey: toolContext.organizationKey,
      scopeKey: toolContext.runtimeScopeKey,
      actorKey: (toolContext.principal as any).userOrganization.key,
      limit: 50,
    });
    expect(searched.threshold).toBeUndefined();
    expect(output.images).toEqual([expect.objectContaining({ filename: 'mountain.jpg', score: 0.92 })]);
    expect(output.images[0]).not.toHaveProperty('embedding');
    expect(output.images[0]).not.toHaveProperty('storageKey');
    expect(output.images[0]).toEqual(expect.objectContaining({ imageCaptionKey: null }));
  });

  test('passes explicit threshold and limit and rejects malformed input', async () => {
    const toolContext = context();
    let searched: any;
    await imageSearchTool.execute({ query: 'city', threshold: 0.7, limit: 12 }, {
      context: toolContext,
      executeEmbedding: async () => ({ output: { embedding } }) as never,
      canAccessCollection: async () => true,
      async searchImages(input) { searched = input; return []; },
    });
    expect(searched).toMatchObject({ threshold: 0.7, limit: 12 });
    await imageSearchTool.execute({ query: `  ${QWEN_RETRIEVAL_INSTRUCTION}city  `, threshold: 0 }, {
      context: toolContext,
      executeEmbedding: async (_organizationKey, input) => { expect(input.text).toBe(`${QWEN_RETRIEVAL_INSTRUCTION}city`); return { output: { embedding } } as never; },
      async searchImages(input) { expect(input.threshold).toBe(0); return []; },
    });
    await expect(imageSearchTool.execute({ query: '', extra: true }, { context: toolContext })).rejects.toThrow();
    await expect(imageSearchTool.execute({ query: 'city', limit: 51 }, { context: toolContext })).rejects.toThrow();
    await expect(imageSearchTool.execute({ query: 'city', imageKey: newId() }, { context: toolContext })).rejects.toThrow();
    await expect(imageSearchTool.execute({ duplicates: true }, { context: toolContext })).rejects.toThrow();
  });

  test('scopes text retrieval to a verified collection', async () => {
    const toolContext = context();
    const collectionKey = newId();
    let searched: any;
    await imageSearchTool.execute({ query: 'city', collectionKey }, {
      context: toolContext,
      executeEmbedding: async () => ({ output: { embedding } }) as never,
      canAccessCollection: async () => true,
      getCollection: async (scopeKey, key) => {
        expect({ scopeKey, key }).toEqual({ scopeKey: toolContext.runtimeScopeKey, key: collectionKey });
        return { key: collectionKey } as never;
      },
      searchImages: async (input) => { searched = input; return []; },
    });
    expect(searched).toMatchObject({ collectionKey, scopeKey: toolContext.runtimeScopeKey });
    await expect(imageSearchTool.execute({ query: 'city', collectionKey }, { context: toolContext, canAccessCollection: async () => true, getCollection: async () => null })).rejects.toThrow('not found');
  });

  test('finds source-image similarity through image.search and excludes the source', async () => {
    const toolContext = context();
    const sourceKey = newId(), targetKey = newId();
    const source = result(toolContext.runtimeScopeKey, sourceKey).image;
    let searched: any;
    let metrics: { mode: string; resultCount: number; durationMs: number } | undefined;
    const output = await imageSearchTool.execute({ imageKey: sourceKey, threshold: 0.8, limit: 12 }, {
      context: toolContext,
      getImage: async () => source,
      canAccessImage: async () => true,
      searchImages: async (input) => { searched = input; return [result(toolContext.runtimeScopeKey, sourceKey), result(toolContext.runtimeScopeKey, targetKey)]; },
      onMetrics(value) { metrics = value; },
    });
    expect(searched).toMatchObject({ embedding: source.embedding, threshold: 0.8, limit: 13 });
    expect(output.images.map(({ key }) => key)).toEqual([targetKey]);
    expect(metrics).toMatchObject({ mode: 'similar', resultCount: 1 });
    expect(metrics!.durationMs).toBeLessThan(1_000);
    await expect(imageSearchTool.execute({ imageKey: sourceKey }, { context: toolContext, getImage: async () => source, canAccessImage: async () => false })).rejects.toThrow('not found');
  });

  test('finds deterministic collection duplicates through image.search without inventing scores', async () => {
    const toolContext = context();
    const collectionKey = newId();
    const duplicate = result(toolContext.runtimeScopeKey).image;
    const output = await imageSearchTool.execute({ duplicates: true, collectionKey }, {
      context: toolContext,
      canAccessCollection: async () => true,
      getCollection: async () => ({ key: collectionKey }) as never,
      findDuplicateImages: async (scopeKey, key) => {
        expect({ scopeKey, key }).toEqual({ scopeKey: toolContext.runtimeScopeKey, key: collectionKey });
        return [duplicate];
      },
    });
    expect(output.images).toEqual([expect.objectContaining({ key: duplicate.key })]);
    expect(output.images[0]).not.toHaveProperty('score');
    await expect(imageSearchTool.execute({ duplicates: true, collectionKey }, {
      context: toolContext,
      getCollection: async () => ({ key: collectionKey }) as never,
      canAccessCollection: async () => false,
    })).rejects.toThrow('not found');
  });

  test('rejects malformed embedding responses and invalid result scores', async () => {
    const toolContext = context();
    await expect(imageSearchTool.execute({ query: 'city' }, {
      context: toolContext,
      executeEmbedding: async () => ({ output: { embedding: embedding.slice(1) } }) as never,
      searchImages: async () => [],
    })).rejects.toThrow();
    await expect(imageSearchTool.execute({ query: 'city' }, {
      context: toolContext,
      executeEmbedding: async () => ({ output: { embedding } }) as never,
      searchImages: async () => [{ ...result(toolContext.runtimeScopeKey), score: 1.1 }],
    })).rejects.toThrow();
  });

  test('requires an active member in the current organization', async () => {
    const systemContext = { ...context(), principal: { kind: 'system' } as never };
    await expect(imageSearchTool.execute({ query: 'city' }, { context: systemContext })).rejects.toMatchObject({ code: 'human_principal_required' });
    const otherOrganization = context();
    (otherOrganization.principal as any).userOrganization.organizationId = newId();
    await expect(imageSearchTool.execute({ query: 'city' }, { context: otherOrganization })).rejects.toMatchObject({ code: 'organization_forbidden' });
  });
});
