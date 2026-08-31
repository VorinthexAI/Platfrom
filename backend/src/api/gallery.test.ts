import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { galleryOperationInputSchemas } from '@/lib/gallery/operations';
import { duplicateSearchTransportInput, galleryHighlightListQuerySchema, galleryMemoryListQuerySchema } from './gallery';
import { registerRoutes } from './routes';

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
});
