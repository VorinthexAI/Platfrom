import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { appSearchInputSchema, createAppSearchService } from './service';

const organizationKey = newId();
const scopeKey = newId();
const userKey = newId();
const membership = { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' };
const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: membership } } as unknown as ToolContext;
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1);

describe('app search service', () => {
  test('has strict model input with defaults, bounds, and distinct collection slugs', () => {
    expect(appSearchInputSchema.parse({ query: 'roadmap', collectionSlugs: ['folders'] })).toEqual({ query: 'roadmap', collectionSlugs: ['folders'], recordHistory: true, limit: 10, minimumScore: 0.55 });
    for (const invalid of [
      { query: '', collectionSlugs: ['folders'] },
      { query: 'roadmap', collectionSlugs: [] },
      { query: 'roadmap', collectionSlugs: ['folders', 'folders'] },
      { query: 'roadmap', collectionSlugs: ['unknown'] },
      { query: 'roadmap', collectionSlugs: ['folders'], organizationKey },
      { query: 'roadmap', collectionSlugs: ['folders'], queryEmbedding: embedding },
    ]) expect(() => appSearchInputSchema.parse(invalid)).toThrow();
  });

  test('embeds once, dispatches adapters in parallel, shares the embedding, and records once last', async () => {
    const events: string[] = [];
    const seenEmbeddings: number[][] = [];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    let started = 0;
    const arrive = async (name: string, supplied?: number[]) => {
      events.push(`${name}:start`);
      seenEmbeddings.push(supplied!);
      if (++started === 3) release();
      await gate;
      events.push(`${name}:end`);
    };
    let embeddingCalls = 0;
    const service = createAppSearchService({
      executeEmbedding: async () => { embeddingCalls += 1; return { embedding }; },
      executeContent: (async (_tool: string, _input: unknown, _context: unknown, dependencies: any) => {
        await arrive('content', dependencies.queryEmbedding);
        return { folders: [], documents: [{ documentKey: newId(), scopeKey, name: 'Plan', isFavorite: false, score: 0.8 }], cached: false, query: 'roadmap' };
      }) as never,
      gallerySearch: (async (_input: unknown, galleryContext: any) => {
        await arrive('gallery', galleryContext.queryEmbedding);
        return { images: [{ key: newId(), filename: 'plan.jpg', caption: 'Plan', imageCaptionKey: null, mimeType: 'image/jpeg', sizeBytes: 100, width: 10, height: 10, city: null, country: null, countryCode: null, latitude: null, longitude: null, locationSource: null, origin: 'generated', mutationPolicy: 'user', isFavorite: false, createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', url: 'https://example.test/plan.jpg', score: 0.9 }] };
      }) as never,
      email: { searchInboxes: async (_actor: unknown, input: any, options: any) => {
        expect(input.recordHistory).toBe(false);
        await arrive('email', options.queryEmbedding);
        return { inboxes: [{ key: newId(), connectorKey: newId(), provider: 'gmail', email: 'work@example.com', name: 'Work', isFavorite: false, status: 'active', syncEnabled: true, initialSyncCompleted: true, syncStatus: 'idle', createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', score: 0.75 }] };
      } } as never,
      userSearches: { record: async () => { events.push('history'); return {} as never; } } as never,
    });

    const result = await service.search({ query: 'roadmap', collectionSlugs: ['documents', 'images', 'inboxes'] }, context);
    expect(result.groups.map(({ collectionSlug }) => collectionSlug)).toEqual(['documents', 'images', 'inboxes']);
    expect(embeddingCalls).toBe(1);
    expect(seenEmbeddings).toHaveLength(3);
    expect(seenEmbeddings.every((value) => value === seenEmbeddings[0])).toBe(true);
    expect(seenEmbeddings[0]).toEqual(embedding);
    expect(events.slice(0, 3).sort()).toEqual(['content:start', 'email:start', 'gallery:start']);
    expect(events.at(-1)).toBe('history');
    expect(JSON.stringify(result)).not.toMatch(/embedding|organizationKey|initialSyncCompleted/);
    expect(result.groups[2]).toEqual({ collectionSlug: 'inboxes', results: [{ key: expect.any(String), connectorKey: expect.any(String), provider: 'gmail', email: 'work@example.com', name: 'Work', isFavorite: false, status: 'active', syncEnabled: true, syncStatus: 'idle', createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', score: 0.75 }] });
    expect(result.groups[1]).toMatchObject({ collectionSlug: 'images', results: [{ origin: 'generated' }] });
  });

  test('strips only the versioned connector field and rejects any other non-legacy inbox field', async () => {
    const connector = { key: newId(), connectorKey: newId(), provider: 'gmail', email: 'work@example.com', name: 'Work', isFavorite: false, status: 'active', syncEnabled: true, initialSyncCompleted: true, syncStatus: 'idle', createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', score: 0.75 };
    const service = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      email: { searchInboxes: async () => ({ inboxes: [{ ...connector, connectorRevision: 'unexpected' }] }) } as never,
    });
    await expect(service.search({ query: 'work', collectionSlugs: ['inboxes'], recordHistory: false }, context)).rejects.toThrow();
  });

  test('does not record history when an adapter fails or history is disabled', async () => {
    let history = 0;
    const base = {
      executeEmbedding: async () => ({ embedding }),
      userSearches: { record: async () => { history += 1; return {} as never; } } as never,
    };
    await expect(createAppSearchService({ ...base, executeContent: (async () => { throw new Error('failed'); }) as never }).search({ query: 'roadmap', collectionSlugs: ['folders'] }, context)).rejects.toThrow('failed');
    expect(history).toBe(0);
    await createAppSearchService({ ...base, executeContent: async () => ({ query: 'roadmap', folders: [], documents: [], cached: false }) as never }).search({ query: 'roadmap', collectionSlugs: ['folders'], recordHistory: false }, context);
    expect(history).toBe(0);
  });

  test('requires a connector and delegates email message boundaries to the email service', async () => {
    const connectorKey = newId();
    let received: any;
    const service = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      email: { searchMessages: async (actor: unknown, input: unknown, options: unknown) => {
        received = { actor, input, options };
        return { threads: [{ key: newId(), subject: 'Roadmap review', summary: 'Review it', intent: 'Review', priority: 'high', state: 'needs_action', lastMessageAt: '2026-08-24T00:00:00.000Z', unread: true, isRead: false, isFavorite: true, inboxCategory: 'Important', createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', score: 0.82 }] };
      } } as never,
    });
    await expect(service.search({ query: 'connector required', collectionSlugs: ['email-messages'], recordHistory: false }, context)).rejects.toThrow('connectorKey');
    const result = await service.search({ query: 'message roadmap', collectionSlugs: ['email-messages'], recordHistory: false, filters: { connectorKey, readState: 'unread', emailFacets: ['important', 'favorite'] } }, context);
    expect(received.input).toMatchObject({ connectorKey, readState: 'unread', facets: ['important', 'favorite'], recordHistory: false });
    expect(received.options.queryEmbedding).toEqual(embedding);
    expect(result.groups[0]).toMatchObject({ collectionSlug: 'email-messages', results: [{ subject: 'Roadmap review', score: 0.82 }] });
  });

  test('searches connector-scoped drafts through the canonical email service', async () => {
    const connectorKey = newId();
    let received: any;
    const draftKey = newId();
    const service = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      email: { searchDrafts: async (actor: unknown, input: unknown, options: unknown) => {
        received = { actor, input, options };
        return { drafts: [{ key: draftKey, variant: 'new', connectorKey, to: ['person@example.com'], subject: 'Roadmap follow-up', generatedContent: 'Here is the roadmap.', status: 'generated', createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', score: 0.91 }] };
      } } as never,
    });
    await expect(service.search({ query: 'connector required', collectionSlugs: ['email-drafts'], recordHistory: false }, context)).rejects.toThrow('connectorKey');
    const result = await service.search({ query: 'roadmap', collectionSlugs: ['email-drafts'], recordHistory: false, filters: { connectorKey } }, context);
    expect(received.input).toMatchObject({ connectorKey, query: 'roadmap', recordHistory: false });
    expect(received.options.queryEmbedding).toEqual(embedding);
    expect(result.groups[0]).toMatchObject({ collectionSlug: 'email-drafts', results: [{ key: draftKey, subject: 'Roadmap follow-up', score: 0.91 }] });
  });

  test('searches books through the canonical book service with trusted scope and shared embedding', async () => {
    let received: any;
    const bookKey = newId();
    const service = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      books: { search: async (input: unknown, actorKey: string, options: unknown) => {
        received = { input, actorKey, options };
        return { books: [{ key: bookKey, title: 'Clear decisions', subtitle: 'A practical guide', description: 'Make better decisions.', status: 'ready', isFavorite: false, isExtending: false, estimatedMinutes: 30, chapterCount: 4, progressPercent: 25, score: 0.88 }] };
      } } as never,
    });
    const result = await service.search({ query: 'decisions', collectionSlugs: ['books'], recordHistory: false }, context);
    expect(received).toEqual({ input: { organizationKey, scopeKey, query: 'decisions', minimumScore: 0.55, limit: 10 }, actorKey: userKey, options: { queryEmbedding: embedding } });
    expect(result.groups).toEqual([{ collectionSlug: 'books', results: [{ key: bookKey, title: 'Clear decisions', subtitle: 'A practical guide', description: 'Make better decisions.', status: 'ready', isFavorite: false, isExtending: false, estimatedMinutes: 30, chapterCount: 4, progressPercent: 25, score: 0.88 }] }]);
  });

  test('searches authorized Gallery collections with trusted membership and ownership metadata', async () => {
    const collectionKey = newId();
    let received: any;
    const service = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      galleryCollectionSearch: async (input: unknown, galleryContext: any) => {
        received = { input, galleryContext };
        return { collections: [{ key: collectionKey, name: 'Road trips', description: null, purpose: null, mutationPolicy: 'user', isFavorite: false, count: 4, coverUrl: null, memberKey: membership.key, isOwned: false, role: 'viewer', access: { canRead: true, canContribute: false, canManage: false }, createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', score: 0.84 }] };
      },
    });
    const result = await service.search({ query: 'road', collectionSlugs: ['collections'], recordHistory: false }, context);
    expect(received.input).toEqual({ query: 'road', minimumScore: 0.55, limit: 10 });
    expect(received.galleryContext).toMatchObject({ organizationKey, scopeKey, membership, queryEmbedding: embedding });
    expect(result.groups).toEqual([{ collectionSlug: 'collections', results: [expect.objectContaining({ key: collectionKey, isOwned: false, role: 'viewer', score: 0.84 })] }]);
  });

  test('rejects a mismatched trusted member context before embedding', async () => {
    let embedded = false;
    const invalid = { ...context, organizationKey: newId() };
    await expect(createAppSearchService({ executeEmbedding: async () => { embedded = true; return { embedding }; } }).search({ query: 'roadmap', collectionSlugs: ['folders'] }, invalid)).rejects.toThrow('membership');
    expect(embedded).toBe(false);
  });
});
