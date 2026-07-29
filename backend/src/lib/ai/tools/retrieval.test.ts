import { describe, expect, test } from 'bun:test';
import { NODE_REGISTRY, NODE_NAMES, registerNode } from '@/lib/db/registry';
import { createNodeHelpers, getNodeRetrievalMetadata } from '@/lib/db/base';
import { listUsersPage } from '@/lib/db/users.node';
import { listChannelsPage } from '@/lib/db/channels.node';
import { z } from 'zod';
import { retrievalInputSchema, retrievalTool } from './retrieval';

const context = { organizationKey: 'org', membershipKey: 'membership', exclude: { messages: ['current'] } };

describe('retrieval tool', () => {
  test('validates dynamic nodes, optional embeddings, and a per-node limit', async () => {
    expect(retrievalInputSchema.parse({ nodes: [{ node: 'messages', embedding: [1, 0] }, { node: 'documents' }], limit: 10 })).toEqual({ nodes: [{ node: 'messages', embedding: [1, 0] }, { node: 'documents' }], limit: 10 });
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
      expect(calls[0]?.slice(0, 3)).toEqual([node, [0, 1], 7]);
      expect(result).toEqual([{ node, documents: [{ key: 'match', fields: { content: 'Dynamic result' }, score: 0.8 }] }]);
    } finally {
      delete NODE_REGISTRY[node];
      NODE_NAMES.splice(0, NODE_NAMES.length, ...Object.keys(NODE_REGISTRY).sort());
    }
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
