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

function result(scopeKey: string) {
  return {
    image: {
      key: newId(), scopeKey, filename: 'mountain.jpg', caption: 'Snow-covered mountains beneath a blue sky.',
      storageKey: 'private/mountain.jpg', mimeType: 'image/jpeg', sizeBytes: 100, width: 1_200, height: 800,
      embedding, isFavorite: false, deletedAt: null, createdAt: now, updatedAt: now,
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
  });

  test('passes explicit threshold and limit and rejects malformed input', async () => {
    const toolContext = context();
    let searched: any;
    await imageSearchTool.execute({ query: 'city', threshold: 0.7, limit: 12 }, {
      context: toolContext,
      executeEmbedding: async () => ({ output: { embedding } }) as never,
      async searchImages(input) { searched = input; return []; },
    });
    expect(searched).toMatchObject({ threshold: 0.7, limit: 12 });
    await expect(imageSearchTool.execute({ query: '', extra: true }, { context: toolContext })).rejects.toThrow();
    await expect(imageSearchTool.execute({ query: 'city', limit: 51 }, { context: toolContext })).rejects.toThrow();
  });

  test('requires an active member in the current organization', async () => {
    const systemContext = { ...context(), principal: { kind: 'system' } as never };
    await expect(imageSearchTool.execute({ query: 'city' }, { context: systemContext })).rejects.toMatchObject({ code: 'human_principal_required' });
    const otherOrganization = context();
    (otherOrganization.principal as any).userOrganization.organizationId = newId();
    await expect(imageSearchTool.execute({ query: 'city' }, { context: otherOrganization })).rejects.toMatchObject({ code: 'organization_forbidden' });
  });
});
