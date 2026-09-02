import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { MAX_APP_SEARCH_RETRIEVAL_RESULTS, appSearchInputSchema, appSearchRetrievalSchema, createAppSearchService, projectAppSearchRetrieval } from './service';

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

  test('projects every collection into strict compact message-owned identities and labels', () => {
    const date = '2026-08-24T00:00:00.000Z';
    const keyed = (name: string) => ({ key: newId(), scopeKey, name, isFavorite: false, score: 0.8 });
    const folder = keyed('Folder');
    const document = keyed('Document');
    const file = { ...keyed('File'), extension: 'pdf' };
    const collection = { key: newId(), name: 'Collection', description: null, purpose: null, mutationPolicy: 'user', isFavorite: false, count: 1, coverUrl: null, memberKey: newId(), isOwned: true, role: 'owner', access: { canRead: true, canContribute: true, canManage: true }, createdAt: date, updatedAt: date, score: 0.8 };
    const image = { key: newId(), filename: 'fallback.jpg', caption: '  ', imageCaptionKey: null, mimeType: 'image/jpeg', sizeBytes: 1, width: 1, height: 1, city: null, country: null, countryCode: null, latitude: null, longitude: null, locationSource: null, origin: 'uploaded', mutationPolicy: 'user', isFavorite: false, createdAt: date, updatedAt: date, url: 'https://example.test/image.jpg', score: 0.8 };
    const inbox = { key: newId(), connectorKey: newId(), provider: 'gmail', email: 'person@example.com', name: '', isFavorite: false, status: 'active', syncEnabled: true, syncStatus: 'idle', createdAt: date, updatedAt: date, score: 0.8 };
    const tone = { key: newId(), name: 'Warm', instruction: 'Be warm', isFavorite: false, createdAt: date, updatedAt: date, score: 0.8 };
    const emailMessage = { key: newId(), subject: 'Subject', summary: 'Summary', intent: 'Intent', priority: 'normal', state: 'informational', lastMessageAt: date, unread: false, isRead: true, isFavorite: false, inboxCategory: 'Important', createdAt: date, updatedAt: date, score: 0.8 };
    const newDraft = { key: newId(), variant: 'new', connectorKey: newId(), to: ['person@example.com'], subject: 'Draft subject', generatedContent: 'Draft', status: 'generated', createdAt: date, updatedAt: date, score: 0.8 };
    const replyDraft = { key: newId(), variant: 'reply', threadKey: newId(), messageKey: newId(), replyMode: 'reply', to: ['person@example.com'], cc: [], generatedContent: 'Reply', status: 'generated', createdAt: date, updatedAt: date, score: 0.8 };
    const place = { key: newId(), kind: 'place', name: 'Paris', summary: 'City', countryCode: 'FR', latitude: 48.8, longitude: 2.3, status: 'wishlist', isFavorite: false, createdAt: date };
    const trip = { key: newId(), name: 'Spring trip', status: 'planned', isFavorite: false, createdAt: date, updatedAt: date, places: [], attachments: [] };
    const country = { name: 'France', countryCode: 'FR', latitude: 46, longitude: 2 };
    const book = { key: newId(), title: 'Clear Decisions', subtitle: 'Guide', description: 'Description', status: 'ready', isFavorite: false, isExtending: false, estimatedMinutes: 10, chapterCount: 2, progressPercent: 0, score: 0.8 };
    const groups = [
      { collectionSlug: 'folders', results: [folder] }, { collectionSlug: 'documents', results: [document] }, { collectionSlug: 'files', results: [file] },
      { collectionSlug: 'collections', results: [collection] }, { collectionSlug: 'images', results: [image] }, { collectionSlug: 'inboxes', results: [inbox] },
      { collectionSlug: 'email-tones', results: [tone] }, { collectionSlug: 'email-messages', results: [emailMessage] }, { collectionSlug: 'email-drafts', results: [newDraft, replyDraft] },
      { collectionSlug: 'places', results: [place] }, { collectionSlug: 'trips', results: [trip] }, { collectionSlug: 'countries', results: [country] }, { collectionSlug: 'books', results: [book] },
    ];
    const first = projectAppSearchRetrieval({ query: ' find ', collectionSlugs: groups.slice(0, 10).map(({ collectionSlug }) => collectionSlug), limit: 7, minimumScore: 0.4, filters: { readState: 'unread' } }, { query: 'find', groups: groups.slice(0, 10) })!;
    const second = projectAppSearchRetrieval({ query: 'find', collectionSlugs: groups.slice(10).map(({ collectionSlug }) => collectionSlug) }, { query: 'find', groups: groups.slice(10) })!;
    expect(first).toMatchObject({ query: 'find', limit: 7, minimumScore: 0.4, filters: { readState: 'unread' } });
    expect(first.groups.find(({ collectionSlug }) => collectionSlug === 'inboxes')?.results[0]).toMatchObject({ key: inbox.key, destinationKey: inbox.connectorKey });
    expect([...first.groups, ...second.groups].map((group) => [group.collectionSlug, group.results.map(({ key, label }) => [key, label])])).toEqual([
      ['folders', [[folder.key, 'Folder']]], ['documents', [[document.key, 'Document']]], ['files', [[file.key, 'File']]], ['collections', [[collection.key, 'Collection']]],
      ['images', [[image.key, 'fallback.jpg']]], ['inboxes', [[inbox.key, 'person@example.com']]], ['email-tones', [[tone.key, 'Warm']]],
      ['email-messages', [[emailMessage.key, 'Subject']]], ['email-drafts', [[newDraft.key, 'Draft subject'], [replyDraft.key, 'Reply draft']]],
      ['places', [[place.key, 'Paris']]], ['trips', [[trip.key, 'Spring trip']]], ['countries', [['FR', 'France']]], ['books', [[book.key, 'Clear Decisions']]],
    ]);
    expect(projectAppSearchRetrieval({ query: 'none', collectionSlugs: ['folders'] }, { query: 'none', groups: [{ collectionSlug: 'folders', results: [] }] })).toBeNull();
    expect(() => appSearchRetrievalSchema.parse({ ...first, unexpected: true })).toThrow('Unrecognized key');
    expect(JSON.stringify(first)).not.toMatch(/url|summary|score|filename/);
  });

  test('bounds persisted results and normalizes unsafe labels without failing a successful search', () => {
    const results = Array.from({ length: 50 }, (_, index) => ({ key: newId(), scopeKey, name: index === 0 ? '   ' : 'x'.repeat(300), isFavorite: false, score: 0.8 }));
    const retrieval = projectAppSearchRetrieval({ query: 'many', collectionSlugs: ['folders', 'documents', 'files'] }, { query: 'many', groups: [
      { collectionSlug: 'folders', results }, { collectionSlug: 'documents', results }, { collectionSlug: 'files', results },
    ] })!;
    expect(retrieval.groups.flatMap(({ results: items }) => items)).toHaveLength(MAX_APP_SEARCH_RETRIEVAL_RESULTS);
    expect(retrieval.groups[0]!.results[0]!.label).toBe('Resource');
    expect(retrieval.groups[0]!.results[1]!.label).toHaveLength(200);
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
