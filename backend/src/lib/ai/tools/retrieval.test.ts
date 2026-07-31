import { describe, expect, test } from 'bun:test';
import { NODE_REGISTRY, NODE_NAMES, registerNode } from '@/lib/db/registry';
import { createNodeHelpers, getNodeRetrievalMetadata } from '@/lib/db/base';
import { listUsersPage } from '@/lib/db/users.node';
import { listChannelsPage } from '@/lib/db/channels.node';
import { z } from 'zod';
import { retrievalInputSchema, retrievalTool } from './retrieval';

const context = { organizationKey: 'org', membershipKey: 'membership', exclude: { messages: ['current'] }, authorParticipantKeys: { messages: ['human', 'atlas'] } };

describe('retrieval tool', () => {
  test('validates dynamic nodes, optional embeddings, and a per-node limit', async () => {
    expect(retrievalInputSchema.parse({ nodes: [{ node: 'messages', embedding: [1, 0], filters: { keys: ['one', 'one'], organizationKey: 'org', channelKeys: ['channel'] } }, { node: 'documents' }], limit: 10 })).toEqual({ nodes: [{ node: 'messages', embedding: [1, 0], filters: { keys: ['one'], organizationKey: 'org', channelKeys: ['channel'] } }, { node: 'documents' }], limit: 10 });
    expect(() => retrievalInputSchema.parse({ nodes: [{ node: 'missing' }], limit: 10 })).toThrow();
    expect(() => retrievalInputSchema.parse({ nodes: [{ node: 'messages' }, { node: 'messages' }], limit: 10 })).toThrow();
    expect(() => retrievalInputSchema.parse({ nodes: [{ node: 'messages' }], limit: 51 })).toThrow();
  });

  test('discovers a newly registered semantic node without changing retrieval', async () => {
    const node = 'retrievalTestNodes';
    const collection = 'retrievalTestDocuments';
    const schema = z.object({ key: z.string(), organizationKey: z.string(), content: z.string(), embedding: z.array(z.number()).default([]) });
    const helpers = createNodeHelpers(collection, schema, ['content']);
    registerNode(node, { listPage: helpers.listPage, getAllChunked: helpers.getAllChunked, upsertByKey: helpers.upsertByKey as never });
    try {
      const calls: unknown[][] = [];
      const result = await retrievalTool.execute({ nodes: [{ node, embedding: [0, 1] }], limit: 7 }, context, {
        retrieveNode: async (...args) => { calls.push(args); return [{ key: 'match', fields: { content: 'Dynamic result' }, score: 0.8 }]; },
      });
      expect(calls[0]?.slice(0, 4)).toEqual([node, [0, 1], undefined, 7]);
      expect(result).toEqual([{ node, documents: [{ key: 'match', fields: { content: 'Dynamic result' }, score: 0.8 }] }]);
    } finally {
      delete NODE_REGISTRY[node];
      NODE_NAMES.splice(0, NODE_NAMES.length, ...Object.keys(NODE_REGISTRY).sort());
    }
  });

  test('applies strict narrowing filters through bound query values', async () => {
    const calls: Array<{ query: string; bindVars: Record<string, unknown> }> = [];
    const result = await retrievalTool.execute({ nodes: [{ node: 'messages', embedding: [1, 0], filters: { keys: ['message'], organizationKey: 'org', scopeKeys: ['scope'], channelKeys: ['channel'] } }], limit: 5 }, context, {
      queryRetrieval: async (query, bindVars) => {
        calls.push({ query, bindVars });
        return { all: async () => [{ key: 'message', fields: { content: 'Authorized match' }, createdAt: '2026-07-29T12:00:00.000Z', score: 0.8 }] };
      },
    });
    expect(result[0]?.documents[0]?.fields.content).toBe('Authorized match');
    expect(calls[0]?.bindVars).toMatchObject({ filterKeys: ['message'], authorParticipantKeys: ['human', 'atlas'], filterOrganizationKey: 'org', filterScopeKeys: ['scope'], filterChannelKeys: ['channel'], filterStatuses: [] });
    expect(calls[0]?.bindVars).not.toHaveProperty('collectionName');
    expect(calls[0]?.query).toContain('document._key IN @filterKeys');
    expect(calls[0]?.query).toContain('document.channelKey) IN @filterChannelKeys');
    expect(calls[0]?.query).toContain('document.authorParticipantKey IN @authorParticipantKeys');
    const declared = new Set([...calls[0]!.query.matchAll(/@{1,2}([A-Za-z][A-Za-z0-9]*)/g)].map((match) => match[1]));
    expect(Object.keys(calls[0]!.bindVars).map((name) => name.replace(/^@/, '')).filter((name) => !declared.has(name))).toEqual([]);
  });

  test('rejects filters that could broaden or do not apply to a node', async () => {
    await expect(retrievalTool.execute({ nodes: [{ node: 'messages', filters: { organizationKey: 'another-org' } }], limit: 5 }, context, { retrieveNode: async () => [] })).rejects.toThrow('authorized organization');
    await expect(retrievalTool.execute({ nodes: [{ node: 'messages', filters: { statuses: ['open'] } }], limit: 5 }, context, { retrieveNode: async () => [] })).rejects.toThrow('does not support status filters');
    await expect(retrievalTool.execute({ nodes: [{ node: 'models', filters: { organizationKey: 'org' } }], limit: 5 }, context, { retrieveNode: async () => [] })).rejects.toThrow('does not support organization filters');
    expect(() => retrievalInputSchema.parse({ nodes: [{ node: 'messages', filters: { arbitrary: ['value'] } }], limit: 5 })).toThrow();
  });

  test('separates safe retrieval fields from embeddings and derives ownership policies', () => {
    expect(getNodeRetrievalMetadata(listUsersPage)).toMatchObject({ fields: ['name'], access: 'organization' });
    expect(getNodeRetrievalMetadata(listChannelsPage)).toMatchObject({ fields: ['name', 'description'], access: 'channel-self' });
    expect(getNodeRetrievalMetadata(listUsersPage)?.fields).not.toContain('email');
  });

  test('keeps tenant filters and safe semantic projections in the database query', async () => {
    const source = await Bun.file(new URL('./retrieval.ts', import.meta.url)).text();
    expect(source).toContain('document.channelKey IN authorizedChannelKeys');
    expect(source).toContain('document._key IN authorizedChannelKeys');
    expect(source).toContain('document.scopeKey IN authorizedScopeKeys');
    expect(source).toContain('document.organizationKey == @organizationKey');
    expect(source).toContain('document.userKey == viewerUserKey');
    expect(source).toContain('KEEP(document, @fields)');
    expect(source).toContain('document._internalDeletion == null');
    expect(source).toContain('parentFolder._internalDeletion == null');
    expect(source).not.toContain('RETURN document');
  });
});
