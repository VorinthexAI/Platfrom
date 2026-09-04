import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { galleryOperationInputSchemas } from '@/lib/gallery/operations';
import { createGalleryOperationHandler, duplicateSearchTransportInput, galleryHighlightListQuerySchema, galleryMemoryListQuerySchema } from './gallery';
import { registerRoutes } from './routes';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { SparkRepositoryError } from '@/lib/sparks/repository';

describe('Gallery HTTP transport', () => {
  test('maps duplicate discovery to the canonical image search input', () => {
    const collectionKey = newId();
    expect(duplicateSearchTransportInput({ collectionKey })).toEqual({ duplicates: true, collectionKey });
    expect(galleryOperationInputSchemas.search.parse(duplicateSearchTransportInput({ collectionKey }))).toEqual({ duplicates: true, collectionKey });
    expect(() => galleryOperationInputSchemas.search.parse(duplicateSearchTransportInput({ collectionKey, unexpected: true }))).toThrow();
  });

  test('strictly validates highlight list query selectors', () => {
    const input = { organizationKey: 'organization', scopeKey: newId(), collectionKey: newId() };
    expect(galleryHighlightListQuerySchema.parse(input)).toEqual(input);
    expect(() => galleryHighlightListQuerySchema.parse({ ...input, unexpected: true })).toThrow();
  });

  test('lists and creates highlights on the same resource with distinct verbs', () => {
    const app = new Hono();
    registerRoutes(app);
    const routes = app.routes.map(({ method, path }) => `${method} ${path}`);
    expect(routes).toContain('GET /gallery/highlights');
    expect(routes).toContain('POST /gallery/highlights');
    expect(routes).not.toContain('POST /gallery/highlights/list');
    const collectionKey = newId(), imageKeys = [newId(), newId()];
    expect(galleryOperationInputSchemas.createHighlight.parse({ collectionKey, imageKeys })).toEqual({ collectionKey, imageKeys });
    expect(() => galleryOperationInputSchemas.createHighlight.parse({ collectionKey, imageKeys, unknown: true })).toThrow();
  });

  test('exposes strict memory CRUD routes', () => {
    const query = { organizationKey: 'organization', scopeKey: newId(), collectionKey: newId() };
    expect(galleryMemoryListQuerySchema.parse(query)).toEqual(query);
    expect(() => galleryMemoryListQuerySchema.parse({ ...query, unexpected: true })).toThrow();
    const app = new Hono();
    registerRoutes(app);
    const routes = app.routes.map(({ method, path }) => `${method} ${path}`);
    expect(routes).toEqual(expect.arrayContaining(['POST /gallery/memories', 'GET /gallery/memories', 'POST /gallery/memories/read', 'POST /gallery/memories/delete']));
    const memoryKey = newId(), collectionKey = newId();
    expect(galleryOperationInputSchemas.deleteMemory.parse({ memoryKey, collectionKey })).toEqual({ memoryKey, collectionKey });
    expect(() => galleryOperationInputSchemas.deleteMemory.parse({ memoryKey })).toThrow();
    expect(() => galleryOperationInputSchemas.deleteMemory.parse({ memoryKey, collectionKey, unexpected: true })).toThrow();
    const imageKey = newId();
    expect(galleryOperationInputSchemas.createMemory.parse({ collectionKey, imageKey })).toEqual({ collectionKey, imageKey });
    expect(() => galleryOperationInputSchemas.createMemory.parse({ collectionKey, imageKey, unknown: true })).toThrow();
  });

  test('coordinates fixed subject, highlight, and memory HTTP debits, refunds, and 402 responses', async () => {
    const organizationKey = 'organization', scopeKey = newId(), userKey = newId();
    const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
    const cases = [
      ['createSubject', 'subject.create', 15_000_000, { name: 'Alex', imageKeys: [newId()] }],
      ['createHighlight', 'highlight.create', 20_000_000, { collectionKey: newId() }],
      ['createMemory', 'image.create-memory', 10_000_000, { collectionKey: newId() }],
    ] as const;
    for (const [operation, slug, amount, input] of cases) {
      const charges: Record<string, unknown>[] = [], refunds: Record<string, unknown>[] = [];
      const dependencies = {
        getIdentity: async () => ({ key: userKey, identityType: 'user' as const }), authorize: async () => ({ context }), recordEvent: async () => {},
        operations: { [operation]: async () => ({ ok: true }) },
        billing: {
          charge: async (_key: string, charge: Record<string, unknown>) => { charges.push(charge); return { status: 'applied', transaction: { key: newId(), eventKey: charge.eventKey } } as never; },
          refund: async (_key: string, refund: Record<string, unknown>) => { refunds.push(refund); return { status: 'applied', transaction: { key: newId() } } as never; },
        },
      };
      const app = new Hono().post('/', createGalleryOperationHandler(operation, 201, (value) => value, slug, dependencies));
      const response = await app.request('/', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `${slug}-request` }, body: JSON.stringify({ organizationKey, scopeKey, ...input }) });
      expect(response.status).toBe(201);
      expect(charges[0]).toMatchObject({ kind: 'tool', toolSlug: slug, microSparks: amount });
      expect(refunds).toEqual([]);

      const failed = new Hono().post('/', createGalleryOperationHandler(operation, 201, (value) => value, slug, { ...dependencies, operations: { [operation]: async () => { throw new Error('operation failed'); } } }));
      expect((await failed.request('/', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `${slug}-failed` }, body: JSON.stringify({ organizationKey, scopeKey, ...input }) })).status).toBe(500);
      expect(refunds).toHaveLength(1);

      const insufficient = new Hono().post('/', createGalleryOperationHandler(operation, 201, (value) => value, slug, { ...dependencies, billing: { charge: async () => { throw new SparkRepositoryError('INSUFFICIENT_BALANCE', 'private'); } } }));
      expect((await insufficient.request('/', { method: 'POST', headers: { 'content-type': 'application/json', 'idempotency-key': `${slug}-insufficient` }, body: JSON.stringify({ organizationKey, scopeKey, ...input }) })).status).toBe(402);
    }
  });
});
