import { describe, expect, test } from 'bun:test';
import { Hono } from 'hono';
import { newId } from '@/lib/ids';
import { galleryOperationInputSchemas } from '@/lib/gallery/operations';
import { duplicateSearchTransportInput, galleryHighlightListQuerySchema } from './gallery';
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
  });
});
