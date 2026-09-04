import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { APP_SEARCH_COLLECTION_ADAPTERS, MAX_APP_SEARCH_RETRIEVAL_RESULTS, appSearchInputSchema, appSearchModelInputSchema, appSearchRetrievalSchema, appSearchSumOutputSchema, createAppSearchService, describeAppSearchCollections, projectAppSearchModelResult, projectAppSearchRetrieval } from './service';

const organizationKey = newId();
const scopeKey = newId();
const userKey = newId();
const membership = { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' };
const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: membership } } as unknown as ToolContext;
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0.1);

describe('app search service', () => {
  test('has strict model input with defaults, bounds, and distinct collection slugs', () => {
    expect(appSearchInputSchema.parse({ query: 'roadmap', collectionSlugs: ['folders'] })).toEqual({ query: 'roadmap', collectionSlugs: ['folders'], recordHistory: true, limit: 10 });
    expect(appSearchInputSchema.parse({ collectionSlugs: ['collections'] })).toEqual({ collectionSlugs: ['collections'], recordHistory: true, limit: 10 });
    for (const invalid of [
      { query: '', collectionSlugs: ['folders'] },
      { query: 'roadmap', collectionSlugs: [] },
      { query: 'roadmap', collectionSlugs: ['folders', 'folders'] },
      { query: 'roadmap', collectionSlugs: ['unknown'] },
      { query: 'roadmap', collectionSlugs: ['folders'], organizationKey },
      { query: 'roadmap', collectionSlugs: ['folders'], queryEmbedding: embedding },
      { query: 'roadmap', collectionSlugs: ['folders'], minimumScore: 0.55 },
    ]) expect(() => appSearchInputSchema.parse(invalid)).toThrow();
    expect(() => appSearchModelInputSchema.parse({ query: 'roadmap', collectionSlugs: ['folders'] })).toThrow();
    expect(appSearchModelInputSchema.parse({ query: 'roadmap', collectionSlugs: ['folders'], limit: 1 })).toMatchObject({ limit: 1 });
    expect(appSearchModelInputSchema.parse({ query: 'roadmap', collectionSlugs: ['folders'], limit: 50 })).toMatchObject({ limit: 50 });
  });

  test('publishes distinct field, filter, operation, and status metadata for every collection adapter', () => {
    expect(Object.keys(APP_SEARCH_COLLECTION_ADAPTERS)).toHaveLength(15);
    for (const [slug, adapter] of Object.entries(APP_SEARCH_COLLECTION_ADAPTERS)) {
      expect(adapter.description.length, `${slug} semantic description`).toBeGreaterThan(30);
      expect(adapter.operations.length, `${slug} operations`).toBeGreaterThan(0);
      expect(adapter.fields.length, `${slug} fields`).toBeGreaterThan(0);
      expect(new Set(adapter.operations).size, `${slug} operation uniqueness`).toBe(adapter.operations.length);
      expect(new Set(adapter.filters).size, `${slug} filter uniqueness`).toBe(adapter.filters.length);
      expect(new Set(adapter.fields).size, `${slug} field uniqueness`).toBe(adapter.fields.length);
      expect(adapter.fields.every((field) => /^[A-Za-z][A-Za-z0-9]*$/.test(field)), `${slug} field names`).toBe(true);
      const sumFields = Object.entries('sumFields' in adapter ? adapter.sumFields ?? {} : {});
      expect((adapter.operations as readonly string[]).includes('sum'), `${slug} sum metadata`).toBe(sumFields.length > 0);
      for (const [field, metadata] of sumFields) {
        expect(adapter.fields as readonly string[], `${slug}.${field} is public`).toContain(field);
        expect(metadata.description.length, `${slug}.${field} description`).toBeGreaterThan(20);
        expect(['bytes', 'minutes', 'chapters']).toContain(metadata.unit);
      }
      if (slug === 'countries' || slug === 'tag-assignments') expect(adapter.filters).not.toEqual(expect.arrayContaining(['createdFrom', 'createdTo']));
      else expect(adapter.filters, `${slug} creation filters`).toEqual(expect.arrayContaining(['createdFrom', 'createdTo']));
    }
    expect(APP_SEARCH_COLLECTION_ADAPTERS.trips).toMatchObject({ filters: ['status', 'isFavorite', 'createdFrom', 'createdTo', 'tagNames', 'tagKeys', 'tagMatch'], statuses: ['planned', 'completed'] });
    expect(APP_SEARCH_COLLECTION_ADAPTERS.places).toMatchObject({ filters: ['status', 'createdFrom', 'createdTo', 'tagNames', 'tagKeys', 'tagMatch'], statuses: ['wishlist', 'visited'] });
    expect(APP_SEARCH_COLLECTION_ADAPTERS.tags).toMatchObject({ operations: ['search', 'list', 'count', 'get'], filters: ['createdFrom', 'createdTo'], fields: ['key', 'name', 'description', 'createdAt', 'updatedAt'] });
    expect(APP_SEARCH_COLLECTION_ADAPTERS['tag-assignments']).toMatchObject({ operations: ['list', 'count', 'get'], filters: ['tagNames', 'tagKeys', 'tagMatch', 'targetTypes'], fields: ['key', 'tag', 'target'] });
    expect(APP_SEARCH_COLLECTION_ADAPTERS.trips.fields).toEqual(expect.arrayContaining(['status', 'isFavorite', 'createdAt', 'updatedAt']));
    expect(APP_SEARCH_COLLECTION_ADAPTERS.books.statuses).toEqual(['queued', 'researching', 'planning', 'writing', 'narrating', 'finalizing', 'failed', 'ready', 'cancelled']);
    expect(APP_SEARCH_COLLECTION_ADAPTERS.books.fields).toEqual(expect.arrayContaining(['title', 'status', 'isFavorite', 'createdAt', 'updatedAt']));
    expect(APP_SEARCH_COLLECTION_ADAPTERS.images.operations).toEqual(['search', 'list', 'count', 'sum']);
    expect(APP_SEARCH_COLLECTION_ADAPTERS.images.sumFields).toEqual({ sizeBytes: { description: expect.any(String), unit: 'bytes' } });
    expect(APP_SEARCH_COLLECTION_ADAPTERS.documents.fields).toEqual(expect.arrayContaining(['mimeType', 'sizeBytes']));
    for (const [slug, adapter] of Object.entries(APP_SEARCH_COLLECTION_ADAPTERS)) {
      const raw = { operation: 'count', collectionSlugs: [slug], ...((slug === 'email-messages' || slug === 'email-drafts') ? { filters: { connectorKey: newId() } } : {}) };
      expect(appSearchInputSchema.safeParse(raw).success, `${slug} count support`).toBe((adapter.operations as readonly string[]).includes('count'));
    }
    expect(appSearchInputSchema.parse({ query: 'recent', collectionSlugs: ['folders'], filters: { createdFrom: '2026-08-01T02:00:00+02:00' } }).filters?.createdFrom).toBe('2026-08-01T00:00:00.000Z');
    const catalog = describeAppSearchCollections();
    for (const [slug, adapter] of Object.entries(APP_SEARCH_COLLECTION_ADAPTERS)) {
      expect(catalog).toContain(`${slug}: ${adapter.description}`);
      expect(catalog.match(new RegExp(`(?:^| )${slug}:`, 'g'))).toHaveLength(1);
    }
  });

  test('strictly validates operation, collection, key, and filter combinations', () => {
    expect(appSearchInputSchema.parse({ operation: 'list', collectionSlugs: ['books'] })).toMatchObject({ operation: 'list', collectionSlugs: ['books'] });
    expect(appSearchInputSchema.parse({ operation: 'get', collectionSlugs: ['books'], key: newId() })).toMatchObject({ operation: 'get' });
    expect(appSearchInputSchema.parse({ operation: 'summarize', collectionSlugs: ['documents'], key: newId(), summary: { style: 'executive' } })).toMatchObject({ operation: 'summarize', summary: { style: 'executive' } });
    expect(appSearchInputSchema.parse({ operation: 'count', collectionSlugs: ['trips'], filters: { status: 'completed' } })).toMatchObject({ filters: { status: 'completed' } });
    expect(appSearchInputSchema.parse({ operation: 'count', collectionSlugs: ['places'], filters: { status: 'visited' } })).toMatchObject({ filters: { status: 'visited' } });
    expect(appSearchInputSchema.parse({ operation: 'count', collectionSlugs: ['books'], filters: { isFavorite: true } })).toMatchObject({ filters: { isFavorite: true } });
    expect(appSearchInputSchema.parse({ operation: 'sum', collectionSlugs: ['images', 'files'], field: 'sizeBytes' })).toMatchObject({ operation: 'sum', field: 'sizeBytes' });
    expect(appSearchInputSchema.parse({ operation: 'sum', collectionSlugs: ['books'], field: 'chapterCount', filters: { status: 'ready', isFavorite: true } })).toMatchObject({ operation: 'sum', field: 'chapterCount' });
    for (const invalid of [
      { operation: 'list', query: 'books', collectionSlugs: ['books'] },
      { operation: 'get', collectionSlugs: ['books'] },
      { operation: 'get', collectionSlugs: ['books', 'trips'], key: newId() },
      { operation: 'summarize', collectionSlugs: ['books'], key: newId() },
      { query: 'recent', collectionSlugs: ['countries'], filters: { createdFrom: '2026-08-01T00:00:00.000Z' } },
      { operation: 'count', collectionSlugs: ['trips'], filters: { status: 'ready' } },
      { operation: 'search', query: 'books', collectionSlugs: ['books'], filters: { isFavorite: true } },
      { operation: 'search', query: 'mail', collectionSlugs: ['email-messages', 'places'], filters: { connectorKey: newId() } },
      { operation: 'search', query: 'files', collectionSlugs: ['files'], filters: { includeDescendants: true } },
      { operation: 'sum', collectionSlugs: ['images'] },
      { operation: 'sum', collectionSlugs: ['images'], field: 'chapterCount' },
      { operation: 'sum', collectionSlugs: ['images', 'books'], field: 'sizeBytes' },
      { operation: 'count', collectionSlugs: ['images'], field: 'sizeBytes' },
    ]) expect(() => appSearchInputSchema.parse(invalid)).toThrow();

    for (const [input, path] of [
      [{ query: 'books', collectionSlugs: ['books'], key: newId() }, 'key'],
      [{ operation: 'get', collectionSlugs: ['books'], key: newId(), filters: { isFavorite: true } }, 'filters'],
      [{ operation: 'count', collectionSlugs: ['email-messages'] }, 'filters.connectorKey'],
      [{ operation: 'list', collectionSlugs: ['email-drafts'], filters: { connectorKey: newId(), emailFacets: [] } }, 'filters.emailFacets'],
      [{ query: 'mail', collectionSlugs: ['email-messages'], filters: { emailFacets: ['urgent', 'urgent'], readState: 'unread' } }, 'filters.emailFacets'],
    ] as const) {
      const result = appSearchInputSchema.safeParse(input);
      expect(result.success).toBe(false);
      if (!result.success) expect(result.error.issues.map((issue) => issue.path.join('.'))).toContain(path);
    }
    const firstTag = newId(), secondTag = newId();
    expect(appSearchInputSchema.parse({ operation: 'count', collectionSlugs: ['documents', 'files'], filters: { tagKeys: [firstTag, secondTag] } }).filters).toMatchObject({ tagKeys: [firstTag, secondTag], tagMatch: 'any' });
    expect(appSearchModelInputSchema.parse({ operation: 'count', collectionSlugs: ['documents'], limit: 10, filters: { tagNames: ['  Ｗork  ', 'Priority'] } }).filters).toEqual({ tagNames: ['Work', 'Priority'], tagMatch: 'any' });
    expect(appSearchModelInputSchema.parse({ operation: 'list', collectionSlugs: ['documents', 'places'], limit: 10, filters: { tagKeys: [firstTag, secondTag], tagMatch: 'all' } }).filters).toEqual({ tagKeys: [firstTag, secondTag], tagMatch: 'all' });
    for (const invalid of [
      { operation: 'count', collectionSlugs: ['books'], filters: { tagMatch: 'all' } },
      { operation: 'count', collectionSlugs: ['books'], filters: { tagKeys: [firstTag, firstTag] } },
      { operation: 'count', collectionSlugs: ['books'], filters: { tagNames: ['Work', ' work '] } },
      { operation: 'count', collectionSlugs: ['books'], filters: { tagNames: ['Work'], tagKeys: [firstTag] } },
      { query: 'Europe', collectionSlugs: ['countries'], filters: { tagKeys: [firstTag] } },
      { query: 'Work', collectionSlugs: ['tags'], filters: { tagNames: ['Work'] } },
      { query: 'mixed', collectionSlugs: ['books', 'countries'], filters: { tagKeys: [firstTag] } },
      { query: 'relationships', collectionSlugs: ['tag-assignments'] },
      { operation: 'list', collectionSlugs: ['tag-assignments'], filters: { targetTypes: ['document', 'document'] } },
    ]) expect(() => appSearchInputSchema.parse(invalid)).toThrow();
  });

  test('filters authorized tags before limits and exact count/sum, projects tags, redacts keys, and persists filters', async () => {
    const workTag = newId(), urgentTag = newId();
    const rows = [
      { key: newId(), title: 'First', subtitle: '', description: '', status: 'ready', isFavorite: false, isExtending: false, estimatedMinutes: 10, chapterCount: 1, progressPercent: 0, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', score: 0.9 },
      { key: newId(), title: 'Tagged second', subtitle: '', description: '', status: 'ready', isFavorite: false, isExtending: false, estimatedMinutes: 20, chapterCount: 2, progressPercent: 0, createdAt: '2026-01-02T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z', score: 0.8 },
      { key: newId(), title: 'Tagged third', subtitle: '', description: '', status: 'ready', isFavorite: false, isExtending: false, estimatedMinutes: 30, chapterCount: 3, progressPercent: 0, createdAt: '2026-01-03T00:00:00.000Z', updatedAt: '2026-01-03T00:00:00.000Z', score: 0.7 },
    ];
    const calls: unknown[] = [];
    const scopeTags = {
      get: async (_owner: unknown, key: string) => [workTag, urgentTag].includes(key) ? { key } : null,
      list: async () => [],
      resolveOwnedByNormalizedNames: async (_owner: unknown, names: string[]) => names.map((name) => name === 'work' ? { key: workTag, normalizedName: name } : { key: urgentTag, normalizedName: name }),
      searchOwned: async () => [],
      resolveCandidateKeys: async (_owner: unknown, keys: string[], types: string[], match: string) => { calls.push({ keys, types, match }); return { book: match === 'all' ? [rows[2]!.key] : [rows[1]!.key, rows[2]!.key] }; },
      resolveEmailThreadKeys: async () => [],
      rankCandidateKeys: async (_owner: unknown, _type: string, keys: string[]) => keys.map((key) => ({ key, score: rows.find((row) => row.key === key)?.score ?? 0 })),
      listTargetTags: async (_owner: unknown, targets: Array<{ type: string; key: string }>) => Object.fromEntries(targets.map((target) => [`${target.type}\0${target.key}`, target.key === rows[2]!.key ? [{ key: urgentTag, name: 'Urgent' }, { key: workTag, name: 'Work' }] : [{ key: workTag, name: 'Work' }]])),
    } as never;
    const service = createAppSearchService({ scopeTags, executeEmbedding: async () => ({ embedding }), books: { overview: async () => ({ books: rows }), search: async () => ({ books: rows }), detail: async () => ({ book: {}, chapters: [] }) } as never });
    const list = await service.search({ operation: 'list', collectionSlugs: ['books'], limit: 1, filters: { tagKeys: [workTag] } }, context);
    expect(list.groups[0]?.results).toEqual([{ ...rows[1], tags: [{ key: workTag, name: 'Work' }] }]);
    await expect(service.search({ operation: 'count', collectionSlugs: ['books'], filters: { tagKeys: [workTag] } }, context)).resolves.toEqual({ operation: 'count', groups: [{ collectionSlug: 'books', count: 2 }] });
    await expect(service.search({ operation: 'count', collectionSlugs: ['books'], filters: { tagNames: [' Ｗork '] } }, context)).resolves.toEqual({ operation: 'count', groups: [{ collectionSlug: 'books', count: 2 }] });
    await expect(service.search({ operation: 'sum', collectionSlugs: ['books'], field: 'estimatedMinutes', filters: { tagKeys: [workTag, urgentTag], tagMatch: 'all' } }, context)).resolves.toEqual({ operation: 'sum', groups: [{ collectionSlug: 'books', field: 'estimatedMinutes', sum: 30, unit: 'minutes', matchedCount: 1, valueCount: 1 }] });
    const search = await service.search({ query: 'tagged', collectionSlugs: ['books'], limit: 1, filters: { tagKeys: [workTag] }, recordHistory: false }, context);
    expect(search.groups[0]?.results[0]).toMatchObject({ key: rows[1]!.key, tags: [{ key: workTag, name: 'Work' }] });
    const compact = projectAppSearchModelResult(search) as any;
    expect(compact.groups[0].examples[0].tags).toEqual([{ name: 'Work' }]);
    expect(JSON.stringify(compact)).not.toContain(workTag);
    const retrieval = projectAppSearchRetrieval({ query: 'tagged', collectionSlugs: ['books'], limit: 1, filters: { tagKeys: [workTag] } }, search)!;
    expect(retrieval.filters).toEqual({ tagKeys: [workTag], tagMatch: 'any' });
    expect(JSON.stringify(retrieval.groups)).not.toContain('Work');
    expect(calls).toEqual(expect.arrayContaining([{ keys: [workTag], types: ['book'], match: 'any' }, { keys: [workTag, urgentTag], types: ['book'], match: 'all' }]));
  });

  test('lists multiple resource collections requiring every supplied tag key', async () => {
    const firstTag = newId(), secondTag = newId(), documentKey = newId(), placeKey = newId(), excludedKey = newId();
    const date = '2026-09-04T00:00:00.000Z';
    const calls: unknown[] = [];
    const tags = [{ key: firstTag, name: 'Work' }, { key: secondTag, name: 'Priority' }];
    const scopeTags = {
      get: async (_owner: unknown, key: string) => tags.find((tag) => tag.key === key) ?? null,
      resolveCandidateKeys: async (_owner: unknown, keys: string[], targetTypes: string[], match: string) => {
        calls.push({ keys, targetTypes, match });
        return { document: [documentKey], place: [placeKey] };
      },
      resolveEmailThreadKeys: async () => [],
      listTargetTags: async (_owner: unknown, targets: Array<{ type: string; key: string }>) => Object.fromEntries(targets.map((target) => [`${target.type}\0${target.key}`, tags])),
    } as never;
    const service = createAppSearchService({
      scopeTags,
      executeContent: (async () => ({ documents: [
        { key: documentKey, scopeKey, name: 'Tagged document', isFavorite: false, createdAt: date, updatedAt: date },
        { key: excludedKey, scopeKey, name: 'Only one tag', isFavorite: false, createdAt: date, updatedAt: date },
      ] })) as never,
      travel: { overview: async () => ({ places: [
        { key: placeKey, kind: 'place', name: 'Tagged place', summary: 'Matches every tag', countryCode: 'SE', latitude: 59.3, longitude: 18.1, status: 'wishlist', isFavorite: false, createdAt: date },
        { key: excludedKey, kind: 'place', name: 'Other place', summary: 'Does not match', countryCode: 'SE', latitude: 59.3, longitude: 18.1, status: 'wishlist', isFavorite: false, createdAt: date },
      ] }) } as never,
    });
    const result = await service.search({ operation: 'list', collectionSlugs: ['documents', 'places'], limit: 10, filters: { tagKeys: [firstTag, secondTag], tagMatch: 'all' } }, context);
    const groups = result.groups as Array<{ collectionSlug: string; results: Array<{ key: string; tags?: Array<{ key: string }> }> }>;
    expect(groups.map((group) => [group.collectionSlug, group.results.map(({ key }) => key)])).toEqual([['documents', [documentKey]], ['places', [placeKey]]]);
    expect(groups.every((group) => group.results.every((item) => item.tags?.map(({ key }) => key).sort().join() === [firstTag, secondTag].sort().join()))).toBe(true);
    expect(calls).toEqual([{ keys: [firstTag, secondTag], targetTypes: ['document', 'place'], match: 'all' }]);
  });

  test('validates every tag before searching and maps files, collections, and messages to exact target types', async () => {
    const valid = newId(), missing = newId(); let searches = 0; const types: string[][] = [];
    const scopeTags = { get: async (_owner: unknown, key: string) => key === valid ? { key } : null, resolveOwnedByNormalizedNames: async () => [], resolveCandidateKeys: async (_owner: unknown, _keys: string[], targetTypes: string[]) => { types.push(targetTypes); return Object.fromEntries(targetTypes.map((type) => [type, []])); }, resolveEmailThreadKeys: async () => [], rankCandidateKeys: async () => [], listTargetTags: async () => ({}) } as never;
    const service = createAppSearchService({ scopeTags, executeEmbedding: async () => ({ embedding }), executeContent: (async () => { searches += 1; return { folders: [], documents: [] }; }) as never, galleryOverview: (async () => ({ collections: [], images: [] })) as never, email: { overview: async () => ({ accounts: [] }) } as never });
    await expect(service.search({ query: 'x', collectionSlugs: ['files', 'collections', 'email-messages'], filters: { tagKeys: [missing] }, recordHistory: false }, context)).rejects.toMatchObject({ code: 'CONTENT_NOT_FOUND' });
    await expect(service.search({ query: 'x', collectionSlugs: ['files'], filters: { tagNames: ['Missing'] }, recordHistory: false }, context)).rejects.toMatchObject({ code: 'CONTENT_NOT_FOUND', message: 'Tag was not found in the authenticated user and scope.' });
    expect(searches).toBe(0);
    await service.search({ query: 'x', collectionSlugs: ['files', 'collections', 'email-messages'], filters: { tagKeys: [valid] }, recordHistory: false }, context);
    expect(types).toEqual([['document', 'image-collection', 'email-thread', 'email-message']]);
  });

  test('searches, lists, counts, and gets private scope tags while redacting keys from Core', async () => {
    const first = { key: newId(), scopeKey, userKey, name: 'Work', normalizedName: 'work', description: 'Projects and planning', embedding, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-02T00:00:00.000Z' };
    const second = { ...first, key: newId(), name: 'Priority', normalizedName: 'priority', description: undefined };
    const scopeTags = {
      list: async () => [first, second],
      get: async (_owner: unknown, key: string) => key === first.key ? first : null,
      searchOwned: async () => [{ ...first, score: 0.91 }],
      listTargetTags: async () => ({}),
    } as never;
    const service = createAppSearchService({ scopeTags, executeEmbedding: async () => ({ embedding }) });
    const searched = await service.search({ query: 'planning', collectionSlugs: ['tags'], limit: 1, recordHistory: false }, context);
    expect(searched.groups).toEqual([{ collectionSlug: 'tags', results: [{ key: first.key, name: 'Work', description: 'Projects and planning', createdAt: first.createdAt, updatedAt: first.updatedAt, score: 0.91 }] }]);
    await expect(service.search({ operation: 'list', collectionSlugs: ['tags'], limit: 1 }, context)).resolves.toMatchObject({ groups: [{ results: [{ key: first.key, name: 'Work' }] }] });
    await expect(service.search({ operation: 'count', collectionSlugs: ['tags'] }, context)).resolves.toEqual({ operation: 'count', groups: [{ collectionSlug: 'tags', count: 2 }] });
    await expect(service.search({ operation: 'get', collectionSlugs: ['tags'], key: first.key }, context)).resolves.toMatchObject({ groups: [{ results: [{ key: first.key, name: 'Work' }] }] });
    const compact = projectAppSearchModelResult(searched);
    expect(compact).toMatchObject({ groups: [{ examples: [{ label: 'Work', description: 'Projects and planning' }] }] });
    expect(JSON.stringify(compact)).not.toContain(first.key);
    expect(projectAppSearchRetrieval({ query: 'planning', collectionSlugs: ['tags'], limit: 1, recordHistory: false }, searched)).toMatchObject({ groups: [{ collectionSlug: 'tags', results: [{ key: first.key, label: 'Work' }] }] });
  });

  test('lists, counts, and gets recognizable tag assignments while stripping every key from Core', async () => {
    const workKey = newId(), priorityKey = newId(), assignmentKey = newId(), targetKey = newId();
    const assignment = { key: assignmentKey, tag: { key: workKey, name: 'Work' }, target: { type: 'document' as const, key: targetKey, label: 'Research Note' } };
    const calls: unknown[] = [];
    const scopeTags = {
      resolveOwnedByNormalizedNames: async (_owner: unknown, names: string[]) => names.filter((name) => name === 'work' || name === 'priority').map((name) => ({ key: name === 'work' ? workKey : priorityKey, normalizedName: name })),
      listAssignments: async (_owner: unknown, query: unknown) => { calls.push(['list', query]); return [assignment]; },
      countAssignments: async (_owner: unknown, query: unknown) => { calls.push(['count', query]); return 1; },
      getAssignment: async (_owner: unknown, key: string) => key === assignmentKey ? assignment : null,
    } as never;
    const service = createAppSearchService({ scopeTags });
    const input = { operation: 'list' as const, collectionSlugs: ['tag-assignments'] as const, limit: 10, filters: { tagNames: [' Work ', 'Priority'], tagMatch: 'all' as const, targetTypes: ['document'] as const } };
    const listed = await service.search(input, context);
    expect(listed).toEqual({ operation: 'list', groups: [{ collectionSlug: 'tag-assignments', results: [assignment] }] });
    await expect(service.search({ operation: 'count', collectionSlugs: ['tag-assignments'], filters: { tagNames: ['Work', 'Priority'], tagMatch: 'all', targetTypes: ['document'] } }, context)).resolves.toEqual({ operation: 'count', groups: [{ collectionSlug: 'tag-assignments', count: 1 }] });
    await expect(service.search({ operation: 'get', collectionSlugs: ['tag-assignments'], key: assignmentKey }, context)).resolves.toEqual({ operation: 'get', groups: [{ collectionSlug: 'tag-assignments', results: [assignment] }] });
    await expect(service.search({ operation: 'list', collectionSlugs: ['tag-assignments'], filters: { tagNames: ['Missing'] } }, context)).rejects.toMatchObject({ code: 'CONTENT_NOT_FOUND' });
    expect(calls).toEqual([
      ['list', { tagKeys: [workKey, priorityKey], tagMatch: 'all', targetTypes: ['document'], limit: 10 }],
      ['count', { tagKeys: [workKey, priorityKey], tagMatch: 'all', targetTypes: ['document'] }],
    ]);
    const compact = projectAppSearchModelResult(listed);
    expect(compact).toMatchObject({ groups: [{ examples: [{ tag: 'Work', targetType: 'document', targetLabel: 'Research Note' }] }] });
    expect(JSON.stringify(compact)).not.toMatch(new RegExp(`${assignmentKey}|${workKey}|${targetKey}`));
    expect(projectAppSearchRetrieval(input, listed)).toBeNull();
  });

  test('lists and counts canonical resources without creating an embedding or search history', async () => {
    let embedded = false; let history = 0;
    const books = [
      { key: newId(), title: 'First', status: 'ready', isFavorite: false, isExtending: false, estimatedMinutes: 10, chapterCount: 1, progressPercent: 0, createdAt: '2026-07-01T00:00:00.000Z', updatedAt: '2026-07-02T00:00:00.000Z' },
      { key: newId(), title: 'Second', status: 'ready', isFavorite: true, isExtending: false, estimatedMinutes: 5, chapterCount: 0, progressPercent: 0, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z' },
    ];
    const service = createAppSearchService({
      executeEmbedding: async () => { embedded = true; return { embedding }; },
      userSearches: { record: async () => { history += 1; return {} as never; } } as never,
      books: { overview: async () => ({ books }) } as never,
    });
    await expect(service.search({ operation: 'list', collectionSlugs: ['books'], limit: 1 }, context)).resolves.toEqual({ operation: 'list', groups: [{ collectionSlug: 'books', results: [books[0]] }] });
    await expect(service.search({ collectionSlugs: ['books'], limit: 1 }, context)).resolves.toEqual({ operation: 'list', groups: [{ collectionSlug: 'books', results: [books[0]] }] });
    await expect(service.search({ operation: 'count', collectionSlugs: ['books'] }, context)).resolves.toEqual({ operation: 'count', groups: [{ collectionSlug: 'books', count: 2 }] });
    await expect(service.search({ operation: 'count', collectionSlugs: ['books'], filters: { isFavorite: true } }, context)).resolves.toEqual({ operation: 'count', groups: [{ collectionSlug: 'books', count: 1 }] });
    await expect(service.search({ operation: 'list', collectionSlugs: ['books'], filters: { createdFrom: '2026-07-15T00:00:00.000Z' } }, context)).resolves.toEqual({ operation: 'list', groups: [{ collectionSlug: 'books', results: [books[1]] }] });
    await expect(service.search({ operation: 'count', collectionSlugs: ['books'], filters: { status: 'ready', isFavorite: false, createdTo: '2026-07-01T00:00:00.000Z' } }, context)).resolves.toEqual({ operation: 'count', groups: [{ collectionSlug: 'books', count: 1 }] });
    expect({ embedded, history }).toEqual({ embedded: false, history: 0 });
  });

  test('gets book detail and previews a document summary through canonical services', async () => {
    const bookKey = newId(); const documentKey = newId(); const calls: Array<{ tool: string; input: unknown }> = [];
    const service = createAppSearchService({
      books: { detail: async () => ({ book: { key: bookKey, title: 'Systems', description: 'A systems guide.', status: 'ready', isFavorite: false, isExtending: false, estimatedMinutes: 20, chapterCount: 2, progressPercent: 50 }, chapters: [] }) } as never,
      executeContent: (async (tool: string, input: unknown) => { calls.push({ tool, input }); return { results: [{ success: true, data: { documentKey, text: 'Brief summary.' } }] }; }) as never,
    });
    await expect(service.search({ operation: 'get', collectionSlugs: ['books'], key: bookKey }, context)).resolves.toMatchObject({ operation: 'get', groups: [{ collectionSlug: 'books', results: [{ key: bookKey, description: 'A systems guide.' }] }] });
    await expect(service.search({ operation: 'summarize', collectionSlugs: ['documents'], key: documentKey, summary: { topic: 'risks', style: 'brief', language: 'Swedish' } }, context)).resolves.toEqual({ operation: 'summarize', collectionSlug: 'documents', key: documentKey, summary: 'Brief summary.' });
    expect(calls).toEqual([{ tool: 'document.summarize', input: { documentKeys: [documentKey], topic: 'risks', style: 'brief', language: 'Swedish', persist: false } }]);
  });

  test('rejects missing and type-mismatched get results and empty summaries', async () => {
    const resourceKey = newId();
    const missingThread = createAppSearchService({ email: { threadForTool: async () => undefined } as never });
    await expect(missingThread.search({ operation: 'get', collectionSlugs: ['email-messages'], key: resourceKey }, context)).rejects.toThrow('not found');

    const fileAsDocument = createAppSearchService({ executeContent: (async () => ({ results: [{ success: true, data: { document: { key: resourceKey, scopeKey, name: 'Report', extension: 'pdf', isFavorite: false } } }] })) as never });
    await expect(fileAsDocument.search({ operation: 'get', collectionSlugs: ['documents'], key: resourceKey }, context)).rejects.toThrow('not found');

    const emptySummary = createAppSearchService({ executeContent: (async () => ({ results: [{ success: true, data: { text: '' } }] })) as never });
    await expect(emptySummary.search({ operation: 'summarize', collectionSlugs: ['documents'], key: resourceKey }, context)).rejects.toThrow();
  });

  test('uses canonical exact email counts and paginates composite filters', async () => {
    const connectorKey = newId(); const calls: any[] = [];
    const service = createAppSearchService({ email: { overview: async (_actor: unknown, input: any) => {
      calls.push(input);
      return { threads: input.cursor ? [{ key: newId() }] : [{ key: newId() }, { key: newId() }], drafts: [], counts: { all: 12, important: 4, urgent: 1, needsAction: 2, filtered: 3, unread: 5, favorite: 6, trash: 0 }, nextCursor: input.cursor ? null : 'next' };
    } } as never });
    await expect(service.search({ operation: 'count', collectionSlugs: ['email-messages'], filters: { connectorKey, readState: 'unread' } }, context)).resolves.toEqual({ operation: 'count', groups: [{ collectionSlug: 'email-messages', count: 5 }] });
    await expect(service.search({ operation: 'count', collectionSlugs: ['email-messages'], filters: { connectorKey, readState: 'read', emailFacets: ['important'] } }, context)).resolves.toEqual({ operation: 'count', groups: [{ collectionSlug: 'email-messages', count: 3 }] });
    const boundary = '2026-08-01T00:00:00.000Z';
    await expect(service.search({ operation: 'count', collectionSlugs: ['email-messages'], filters: { connectorKey, createdFrom: boundary, createdTo: boundary } }, context)).resolves.toEqual({ operation: 'count', groups: [{ collectionSlug: 'email-messages', count: 3 }] });
    expect(calls.map(({ cursor }) => cursor)).toEqual([undefined, undefined, 'next', undefined, 'next']);
    expect(calls.slice(-2).every(({ createdFrom, createdTo }) => createdFrom === boundary && createdTo === boundary)).toBe(true);
  });

  test('uses the canonical exact filtered draft total beyond the first page', async () => {
    const connectorKey = newId(); const boundary = '2026-08-01T00:00:00.000Z'; const inputs: unknown[] = [];
    const service = createAppSearchService({ email: { listDrafts: async (_actor: unknown, input: unknown) => { inputs.push(input); return { drafts: [], total: 135, offset: 0, limit: 1 }; } } as never });
    await expect(service.search({ operation: 'count', collectionSlugs: ['email-drafts'], filters: { connectorKey, createdFrom: boundary, createdTo: boundary } }, context)).resolves.toEqual({ operation: 'count', groups: [{ collectionSlug: 'email-drafts', count: 135 }] });
    expect(inputs).toEqual([{ connectorKey, createdFrom: boundary, createdTo: boundary, limit: 1 }]);
  });

  test('counts every authorized Gallery image page with collection and date filters', async () => {
    const collectionKey = newId(); const createdFrom = '2026-08-01T00:00:00.000Z'; const createdTo = '2026-08-31T23:59:59.999Z'; const calls: any[] = [];
    const pages = [Array.from({ length: 100 }, () => ({ key: newId(), createdAt: createdFrom })), [...Array.from({ length: 23 }, () => ({ key: newId(), createdAt: createdTo })), { key: newId(), createdAt: '2026-07-31T23:59:59.999Z' }]];
    const service = createAppSearchService({ galleryOverview: (async (input: any) => {
      calls.push(input); const index = input.cursor ? 1 : 0;
      return { collections: [], images: pages[index], nextCursor: index === 0 ? 'next-page' : undefined };
    }) as never });
    await expect(service.search({ operation: 'count', collectionSlugs: ['images'], filters: { collectionKey, createdFrom, createdTo } }, context)).resolves.toEqual({ operation: 'count', groups: [{ collectionSlug: 'images', count: 123 }] });
    expect(calls).toEqual([
      { collectionKey, createdFrom, createdTo, limit: 100 },
      { collectionKey, createdFrom, createdTo, cursor: 'next-page', limit: 100 },
    ]);
  });

  test('exactly sums registered fields across every authorized page without embedding', async () => {
    const collectionKey = newId(); const boundary = '2026-08-01T00:00:00.000Z'; const calls: any[] = []; let embedded = false;
    const service = createAppSearchService({
      executeEmbedding: async () => { embedded = true; return { embedding }; },
      galleryOverview: (async (input: any) => { calls.push(input); return input.cursor
        ? { collections: [], images: [{ key: newId(), sizeBytes: 7, createdAt: boundary }] }
        : { collections: [], images: [{ key: newId(), sizeBytes: 5, createdAt: boundary }], nextCursor: 'next' }; }) as never,
    });
    const output = await service.search({ operation: 'sum', collectionSlugs: ['images'], field: 'sizeBytes', filters: { collectionKey, createdFrom: boundary, createdTo: boundary } }, context);
    expect(output).toEqual({ operation: 'sum', groups: [{ collectionSlug: 'images', field: 'sizeBytes', sum: 12, unit: 'bytes', matchedCount: 2, valueCount: 2 }] });
    expect(appSearchSumOutputSchema.parse(output)).toEqual(output);
    expect(projectAppSearchModelResult(output)).toEqual(output);
    expect(projectAppSearchRetrieval({ operation: 'sum', collectionSlugs: ['images'], field: 'sizeBytes' }, output)).toBeNull();
    expect(calls).toEqual([{ collectionKey, createdFrom: boundary, createdTo: boundary, limit: 100 }, { collectionKey, createdFrom: boundary, createdTo: boundary, cursor: 'next', limit: 100 }]);
    expect(embedded).toBe(false);
  });

  test('sums stored Archive bytes and meaningful book fields with filters', async () => {
    const date = '2026-08-01T00:00:00.000Z';
    const documents = [
      { key: newId(), scopeKey, name: 'Native note', content: 'Text', isFavorite: false, createdAt: date, updatedAt: date },
      { key: newId(), scopeKey, name: 'Stored note', mimeType: 'text/plain', sizeBytes: 11, content: 'Text', isFavorite: false, createdAt: date, updatedAt: date },
      { key: newId(), scopeKey, name: 'File', extension: 'pdf', mimeType: 'application/pdf', sizeBytes: 13, content: 'Text', isFavorite: false, createdAt: date, updatedAt: date },
    ];
    const books = [
      { key: newId(), status: 'ready', isFavorite: true, estimatedMinutes: 20, chapterCount: 3, createdAt: date },
      { key: newId(), status: 'failed', isFavorite: true, estimatedMinutes: 5, chapterCount: 1, createdAt: date },
    ];
    const service = createAppSearchService({ executeContent: (async () => ({ documents })) as never, books: { overview: async () => ({ books }) } as never });
    await expect(service.search({ operation: 'sum', collectionSlugs: ['documents', 'files'], field: 'sizeBytes' }, context)).resolves.toEqual({ operation: 'sum', groups: [
      { collectionSlug: 'documents', field: 'sizeBytes', sum: 11, unit: 'bytes', matchedCount: 2, valueCount: 1 },
      { collectionSlug: 'files', field: 'sizeBytes', sum: 13, unit: 'bytes', matchedCount: 1, valueCount: 1 },
    ] });
    await expect(service.search({ operation: 'sum', collectionSlugs: ['books'], field: 'estimatedMinutes', filters: { status: 'ready', isFavorite: true } }, context)).resolves.toEqual({ operation: 'sum', groups: [
      { collectionSlug: 'books', field: 'estimatedMinutes', sum: 20, unit: 'minutes', matchedCount: 1, valueCount: 1 },
    ] });
  });

  test('rejects malformed or inexact values instead of returning a plausible sum', async () => {
    for (const sizeBytes of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, '12']) {
      const service = createAppSearchService({ galleryOverview: (async () => ({ collections: [], images: [{ key: newId(), sizeBytes }] })) as never });
      await expect(service.search({ operation: 'sum', collectionSlugs: ['images'], field: 'sizeBytes' }, context)).rejects.toThrow('nonnegative safe integer');
    }
    const overflow = createAppSearchService({ galleryOverview: (async () => ({ collections: [], images: [{ sizeBytes: Number.MAX_SAFE_INTEGER }, { sizeBytes: 1 }] })) as never });
    await expect(overflow.search({ operation: 'sum', collectionSlugs: ['images'], field: 'sizeBytes' }, context)).rejects.toThrow('exact numeric range');
  });

  test('filters exact trip counts by registered status and favorite fields', async () => {
    const trips = [
      { key: newId(), name: 'Done', status: 'completed', isFavorite: true, createdAt: '2026-06-01T00:00:00.000Z', updatedAt: '2026-06-02T00:00:00.000Z', places: [], attachments: [] },
      { key: newId(), name: 'Later', status: 'planned', isFavorite: true, createdAt: '2026-08-01T00:00:00.000Z', updatedAt: '2026-08-02T00:00:00.000Z', places: [], attachments: [] },
      { key: newId(), name: 'Old', status: 'completed', isFavorite: false, createdAt: '2025-01-01T00:00:00.000Z', updatedAt: '2025-01-02T00:00:00.000Z', places: [], attachments: [] },
    ];
    const service = createAppSearchService({ travel: { listTrips: async () => ({ trips }) } as never });
    await expect(service.search({ operation: 'count', collectionSlugs: ['trips'], filters: { status: 'completed', isFavorite: true } }, context)).resolves.toEqual({ operation: 'count', groups: [{ collectionSlug: 'trips', count: 1 }] });
    await expect(service.search({ operation: 'list', collectionSlugs: ['trips'], filters: { status: 'completed', createdFrom: '2026-01-01T00:00:00.000Z' } }, context)).resolves.toEqual({ operation: 'list', groups: [{ collectionSlug: 'trips', results: [trips[0]] }] });
  });

  test('applies inclusive date boundaries consistently and excludes undated structured resources', async () => {
    const boundary = '2026-06-01T00:00:00.000Z';
    const book = { key: newId(), title: 'Boundary book', status: 'ready', isFavorite: false, createdAt: boundary };
    const trip = { key: newId(), name: 'Boundary trip', status: 'planned', isFavorite: false, createdAt: boundary };
    const service = createAppSearchService({
      books: { overview: async () => ({ books: [book, { ...book, key: newId(), createdAt: undefined }] }) } as never,
      travel: { listTrips: async () => ({ trips: [trip, { ...trip, key: newId(), createdAt: undefined }] }) } as never,
    });
    await expect(service.search({ operation: 'count', collectionSlugs: ['books', 'trips'], filters: { createdFrom: boundary, createdTo: boundary } }, context)).resolves.toEqual({
      operation: 'count', groups: [{ collectionSlug: 'books', count: 1 }, { collectionSlug: 'trips', count: 1 }],
    });
    const reversed = appSearchInputSchema.safeParse({ operation: 'count', collectionSlugs: ['books'], filters: { createdFrom: '2026-06-02T00:00:00.000Z', createdTo: boundary } });
    expect(reversed.success).toBe(false);
    if (!reversed.success) expect(reversed.error.issues.map((issue) => issue.path.join('.'))).toContain('filters.createdTo');
  });

  test('filters every exhaustive timestamped collection before exact counting', async () => {
    const boundary = '2026-06-01T00:00:00.000Z'; const old = '2026-05-31T23:59:59.999Z';
    const collectionSlugs = ['collections', 'inboxes', 'email-tones', 'places', 'trips', 'books'] as const;
    const values = (kind: string) => [{ key: `${kind}-boundary`, createdAt: boundary }, { key: `${kind}-old`, createdAt: old }];
    const service = createAppSearchService({
      galleryOverview: (async () => ({ collections: values('collection'), images: [], nextCursor: null })) as never,
      email: { overview: async () => ({ accounts: values('inbox'), tones: values('tone') }) } as never,
      travel: { overview: async () => ({ places: values('place') }), listTrips: async () => ({ trips: values('trip') }) } as never,
      books: { overview: async () => ({ books: values('book') }) } as never,
    });
    await expect(service.search({ operation: 'count', collectionSlugs: [...collectionSlugs], filters: { createdFrom: boundary, createdTo: boundary } }, context)).resolves.toEqual({
      operation: 'count', groups: collectionSlugs.map((collectionSlug) => ({ collectionSlug, count: 1 })),
    });
  });

  test('projects every collection into strict compact message-owned identities and labels', () => {
    const date = '2026-08-24T00:00:00.000Z';
    const keyed = (name: string) => ({ key: newId(), scopeKey, name, isFavorite: false, createdAt: date, updatedAt: date, score: 0.8 });
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
    const book = { key: newId(), title: 'Clear Decisions', subtitle: 'Guide', description: 'Description', status: 'ready', isFavorite: false, isExtending: false, estimatedMinutes: 10, chapterCount: 2, progressPercent: 0, createdAt: date, updatedAt: date, score: 0.8 };
    const groups = [
      { collectionSlug: 'folders', results: [folder] }, { collectionSlug: 'documents', results: [document] }, { collectionSlug: 'files', results: [file] },
      { collectionSlug: 'collections', results: [collection] }, { collectionSlug: 'images', results: [image] }, { collectionSlug: 'inboxes', results: [inbox] },
      { collectionSlug: 'email-tones', results: [tone] }, { collectionSlug: 'email-messages', results: [emailMessage] }, { collectionSlug: 'email-drafts', results: [newDraft, replyDraft] },
      { collectionSlug: 'places', results: [place] }, { collectionSlug: 'trips', results: [trip] }, { collectionSlug: 'countries', results: [country] }, { collectionSlug: 'books', results: [book] },
    ];
    const first = projectAppSearchRetrieval({ query: ' find ', collectionSlugs: groups.slice(0, 10).map(({ collectionSlug }) => collectionSlug), limit: 7, filters: { readState: 'unread' } }, { query: 'find', groups: groups.slice(0, 10) })!;
    const second = projectAppSearchRetrieval({ query: 'find', collectionSlugs: groups.slice(10).map(({ collectionSlug }) => collectionSlug) }, { query: 'find', groups: groups.slice(10) })!;
    expect(first).toMatchObject({ query: 'find', limit: 7, filters: { readState: 'unread' } });
    expect(first).not.toHaveProperty('minimumScore');
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

  test('accepts query-free result retrievals and rejects query-free search retrievals', () => {
    const firstKey = newId();
    const retrieval = { source: 'results' as const, limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: 'collections' as const, results: [{ key: firstKey, label: 'City After Rain' }] }] };
    expect(appSearchRetrievalSchema.parse(retrieval)).toEqual(retrieval);
    expect(() => appSearchRetrievalSchema.parse({ limit: 5, minimumScore: 0.55, groups: [{ collectionSlug: 'collections', results: [{ key: firstKey, label: 'X' }] }] })).toThrow('require a query');
    expect(appSearchRetrievalSchema.safeParse({ query: 'roadmap', limit: 5, minimumScore: 0.55, groups: [{ collectionSlug: 'collections', results: [{ key: firstKey, label: 'X' }] }] }).success).toBe(true);
  });

  test('passes dynamic date intervals but no score cutoff to ranked image search', async () => {
    const inputs: any[] = [];
    const collectionKey = newId();
    const service = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      gallerySearch: (async (input: any) => {
        inputs.push(input);
        return { images: [] };
      }) as never,
    });
    await service.search({ query: 'dog', collectionSlugs: ['images'], filters: { createdFrom: '2026-08-01T00:00:00.000Z', createdTo: '2026-09-01T00:00:00.000Z' }, recordHistory: false }, context);
    expect(inputs[0]).toMatchObject({ createdFrom: '2026-08-01T00:00:00.000Z', createdTo: '2026-09-01T00:00:00.000Z' });
    expect(inputs[0]).not.toHaveProperty('threshold');
    await service.search({ query: 'dog', collectionSlugs: ['images'], recordHistory: false }, context);
    expect(inputs[1]).not.toHaveProperty('createdFrom');
    expect(inputs[1]).not.toHaveProperty('createdTo');
    expect(inputs[1]).not.toHaveProperty('threshold');
    await service.search({ query: 'ornage', collectionSlugs: ['images'], filters: { collectionKey }, recordHistory: false }, context);
    expect(inputs[2]).toMatchObject({ query: 'ornage', collectionKey, limit: 10, recordHistory: false });
    expect(inputs[2]).not.toHaveProperty('threshold');
  });

  test('forwards normalized creation ranges to every timestamped semantic adapter', async () => {
    const calls = new Map<string, any>(); const connectorKey = newId(); const boundary = '2026-08-01T00:00:00.000Z';
    const service = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      executeContent: (async (_tool: string, input: unknown) => { calls.set('content', input); return { folders: [], documents: [] }; }) as never,
      gallerySearch: (async (input: unknown) => { calls.set('images', input); return { images: [] }; }) as never,
      galleryCollectionSearch: (async (input: unknown) => { calls.set('collections', input); return { collections: [] }; }) as never,
      email: {
        overview: async () => ({ accounts: [{ key: newId(), connectorKey, name: 'Work', email: 'work@example.com' }] }),
        searchInboxes: async (_actor: unknown, input: unknown) => { calls.set('inboxes', input); return { inboxes: [] }; },
        searchTones: async (_actor: unknown, input: unknown) => { calls.set('email-tones', input); return { tones: [] }; },
        searchMessages: async (_actor: unknown, input: unknown) => { calls.set('email-messages', input); return { threads: [] }; },
        searchDrafts: async (_actor: unknown, input: unknown) => { calls.set('email-drafts', input); return { drafts: [] }; },
      } as never,
      travel: {
        searchPlaces: async (input: unknown) => { calls.set('places', input); return { places: [] }; },
        searchTrips: async (input: unknown) => { calls.set('trips', input); return { trips: [] }; },
      } as never,
      books: { search: async (input: unknown) => { calls.set('books', input); return { books: [] }; } } as never,
    });
    const filters = { createdFrom: '2026-08-01T02:00:00+02:00', createdTo: boundary };
    await service.search({ query: 'recent', collectionSlugs: ['folders', 'documents', 'files', 'collections', 'images', 'inboxes', 'email-tones', 'email-messages', 'email-drafts', 'places'], filters, recordHistory: false }, context);
    await service.search({ query: 'recent travel books', collectionSlugs: ['trips', 'books'], filters, recordHistory: false }, context);
    for (const slug of ['content', 'collections', 'images', 'inboxes', 'email-tones', 'email-messages', 'email-drafts', 'places', 'trips', 'books']) {
      expect(calls.get(slug), `${slug} input`).toMatchObject({ createdFrom: boundary, createdTo: boundary });
    }
  });

  test('reads the top three matched Archive resources through the canonical content runtime', async () => {
    const date = '2026-08-24T00:00:00.000Z'; const query = `canonical evidence ${newId()}`;
    const documents = Array.from({ length: 4 }, (_, index) => ({ documentKey: newId(), scopeKey, name: `Plan ${index}`, isFavorite: false, createdAt: date, updatedAt: date, score: 1 - index / 10 }));
    const calls: Array<{ tool: string; input: any; suppliedContext: unknown }> = [];
    const service = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      executeContent: (async (tool: string, input: any, suppliedContext: unknown) => {
        calls.push({ tool, input, suppliedContext });
        if (tool === 'content.search') return { query, folders: [], documents };
        return { results: input.documentKeys.map((documentKey: string) => ({ success: true, data: { document: { key: documentKey, scopeKey, name: 'Plan', isFavorite: false, createdAt: date, updatedAt: date }, content: `Private roadmap evidence for ${documentKey}` } })) };
      }) as never,
    });
    const output = await service.search({ query, collectionSlugs: ['documents'], limit: 4, recordHistory: false }, context);
    expect(calls.map(({ tool }) => tool)).toEqual(['content.search', 'document.find']);
    expect(calls[1]!.input).toEqual({ documentKeys: documents.slice(0, 3).map(({ documentKey }) => documentKey), include: ['content'] });
    expect(calls[1]!.suppliedContext).toBe(context);
    expect(output.groups[0]!.results.slice(0, 3).every((result) => 'content' in result)).toBe(true);
    expect(output.groups[0]!.results[3]).not.toHaveProperty('content');
  });

  test('reads matched email threads and audio-book chapters through canonical services', async () => {
    const date = '2026-08-24T00:00:00.000Z'; const connectorKey = newId(); const inboxKey = newId(); const threadKey = newId(); const bookKey = newId();
    const email = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      email: {
        overview: async () => ({ accounts: [{ key: inboxKey, connectorKey, name: 'Work', email: 'work@example.com' }] }),
        searchMessages: async () => ({ threads: [{ key: threadKey, subject: 'Launch', summary: 'Summary', intent: 'Review', priority: 'normal', state: 'informational', lastMessageAt: date, unread: false, isRead: true, isFavorite: false, inboxCategory: 'Important', createdAt: date, updatedAt: date, score: 0.9 }] }),
        threadForTool: async () => ({ messages: [{ from: 'lead@example.com', sentAt: date, subject: 'Launch', body: 'The launch code is cobalt.' }], truncated: false }),
      } as never,
    });
    const emailOutput = await email.search({ query: 'launch code', collectionSlugs: ['email-messages'], recordHistory: false }, context);
    expect(emailOutput.groups[0]!.results[0]).toMatchObject({ key: threadKey, content: expect.stringContaining('cobalt'), contentTruncated: false });

    const books = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      books: {
        search: async () => ({ books: [{ key: bookKey, title: 'Systems', subtitle: 'A guide', description: 'Systems thinking', status: 'ready', isFavorite: false, isExtending: false, estimatedMinutes: 20, chapterCount: 1, progressPercent: 0, createdAt: date, updatedAt: date, score: 0.8 }] }),
        detail: async () => ({ book: {}, chapters: [{ key: newId(), title: 'Feedback', description: 'Loops', content: 'Causal loops amplify change.', position: 1, estimatedMinutes: 5 }] }),
      } as never,
    });
    const bookOutput = await books.search({ query: 'causal loops', collectionSlugs: ['books'], recordHistory: false }, context);
    expect(bookOutput.groups[0]!.results[0]).toMatchObject({ key: bookKey, content: expect.stringContaining('amplify change') });
  });

  test('projects bounded readable evidence while redacting model-irrelevant private fields', () => {
    const result = projectAppSearchModelResult({ query: 'details', groups: [
      { collectionSlug: 'email-drafts', results: [{ key: 'draft', subject: 'Launch', finalContent: 'Final private draft', generatedContent: 'Old draft', bcc: ['hidden@example.com'] }] },
      { collectionSlug: 'email-tones', results: [{ key: 'tone', name: 'Direct', instruction: 'Use direct language.' }] },
      { collectionSlug: 'trips', results: [{ key: 'trip', name: 'Nordic', places: [{ name: 'Oslo', summary: 'First stop' }] }] },
      { collectionSlug: 'images', results: [{ key: 'image', caption: 'A red dog', url: 'https://signed.example/private', storageKey: 'private/image' }] },
    ] }) as any;
    expect(result.groups.map(({ examples }: any) => examples[0]?.content)).toEqual(['Final private draft', 'Use direct language.', 'Oslo: First stop', undefined]);
    expect(JSON.stringify(result)).not.toMatch(/hidden@example|signed\.example|storageKey|Old draft|"key"|connectorKey/);
  });

  test('keeps bounded public navigation context needed to explain where a match lives', () => {
    const folder = { key: newId(), name: 'Project Atlas' }; const collection = { key: newId(), name: 'Coastal Days' };
    const inbox = { key: newId(), connectorKey: newId(), name: 'Work' }; const trip = { key: newId(), name: 'Nordic Summer' };
    const result = projectAppSearchModelResult({ query: 'where', groups: [
      { collectionSlug: 'documents', results: [{ key: newId(), name: 'Research Note', folder, sizeBytes: 1_200 }] },
      { collectionSlug: 'images', results: [{ key: newId(), caption: 'Lighthouse', collections: [collection] }] },
      { collectionSlug: 'email-messages', results: [{ key: newId(), subject: 'Launch', inbox }] },
      { collectionSlug: 'places', results: [{ key: newId(), name: 'Stockholm', trips: [trip] }] },
    ] }) as any;
    expect(result.groups.map(({ examples }: any) => examples[0])).toEqual([
      expect.objectContaining({ folder: { name: folder.name }, sizeBytes: 1_200 }),
      expect.objectContaining({ collections: [{ name: collection.name }] }),
      expect.objectContaining({ inbox: { name: inbox.name } }),
      expect.objectContaining({ trips: [{ name: trip.name }] }),
    ]);
    expect(JSON.stringify(result)).not.toMatch(/"key"|connectorKey/);
  });

  test('projects matched images as one collection pill per accessible collection and keeps uncollected images', () => {
    const collected = { key: newId(), filename: 'dog.jpg', caption: 'Dog at the shore', imageCaptionKey: null, mimeType: 'image/jpeg', sizeBytes: 1, width: 1, height: 1, city: null, country: null, countryCode: null, latitude: null, longitude: null, locationSource: null, origin: 'uploaded' as const, mutationPolicy: 'user' as const, isFavorite: false, createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', url: 'https://example.test/dog.jpg', score: 0.9, collections: [{ key: newId(), name: 'Coastal Days' }, { key: newId(), name: 'Dogs' }] };
    const uncollected = { ...collected, key: newId(), filename: 'stray.jpg', caption: '   ', collections: [] };
    const retrieval = projectAppSearchRetrieval({ query: 'dog', collectionSlugs: ['images'], limit: 10 }, { query: 'dog', groups: [{ collectionSlug: 'images', results: [collected, { ...collected, key: newId(), filename: 'dog-2.jpg', caption: 'Another dog' }, uncollected] }] })!;
    expect(retrieval).toEqual({
      query: 'dog', limit: 10, searchCollectionSlugs: ['images'],
      groups: [
        { collectionSlug: 'collections', results: [{ key: collected.collections[0]!.key, label: 'Coastal Days' }, { key: collected.collections[1]!.key, label: 'Dogs' }] },
        { collectionSlug: 'images', results: [{ key: uncollected.key, label: 'stray.jpg' }] },
      ],
    });
  });

  test('does not let one requested image fan out into multiple visible collection retrievals', () => {
    const date = '2026-08-24T00:00:00.000Z';
    const collections = Array.from({ length: 9 }, (_, index) => ({ key: newId(), name: `Collection ${index + 1}` }));
    const images = collections.map((collection, index) => ({ key: newId(), filename: `${index}.jpg`, caption: `Image ${index}`, imageCaptionKey: null, mimeType: 'image/jpeg', sizeBytes: 1, width: 1, height: 1, city: null, country: null, countryCode: null, latitude: null, longitude: null, locationSource: null, origin: 'uploaded' as const, mutationPolicy: 'user' as const, isFavorite: false, createdAt: date, updatedAt: date, url: `https://example.test/${index}.jpg`, score: 0.9, collections: [collection] }));
    const retrieval = projectAppSearchRetrieval({ query: 'these images', collectionSlugs: ['images'], limit: 1 }, { query: 'these images', groups: [{ collectionSlug: 'images', results: images }] })!;
    expect(retrieval.limit).toBe(1);
    expect(retrieval.groups).toEqual([{ collectionSlug: 'collections', results: [{ key: collections[0]!.key, label: 'Collection 1' }] }]);
  });

  test('projects nested Archive matches to one containing-folder pill and keeps root resources direct', () => {
    const folderKey = newId(); const date = '2026-08-24T00:00:00.000Z';
    const nestedDocument = { key: newId(), scopeKey, folderKey, folder: { key: folderKey, name: 'Project Atlas' }, name: 'Roadmap', isFavorite: false, createdAt: date, updatedAt: date, score: 0.9 };
    const nestedFile = { ...nestedDocument, key: newId(), name: 'Budget', extension: 'pdf' };
    const rootDocument = { key: newId(), scopeKey, name: 'Root note', isFavorite: false, createdAt: date, updatedAt: date, score: 0.8 };
    const rootFile = { key: newId(), scopeKey, name: 'Root file', extension: 'pdf', isFavorite: false, createdAt: date, updatedAt: date, score: 0.8 };
    const retrieval = projectAppSearchRetrieval(
      { query: 'atlas', collectionSlugs: ['folders', 'documents', 'files'] },
      { query: 'atlas', groups: [
        { collectionSlug: 'folders', results: [{ key: folderKey, scopeKey, name: 'Project Atlas', isFavorite: false, createdAt: date, updatedAt: date, score: 0.95 }] },
        { collectionSlug: 'documents', results: [nestedDocument, rootDocument] },
        { collectionSlug: 'files', results: [nestedFile, rootFile] },
      ] },
    )!;
    expect(retrieval.searchCollectionSlugs).toEqual(['folders', 'documents', 'files']);
    expect(retrieval.groups).toEqual([
      { collectionSlug: 'folders', results: [{ key: folderKey, label: 'Project Atlas', destinationCollectionSlug: 'documents' }] },
      { collectionSlug: 'documents', results: [{ key: rootDocument.key, label: 'Root note' }] },
      { collectionSlug: 'files', results: [{ key: rootFile.key, label: 'Root file' }] },
    ]);
  });

  test('projects Signal children to their inbox and Compass places to every containing trip', () => {
    const inbox = { key: newId(), connectorKey: newId(), name: 'Work' };
    const date = '2026-08-24T00:00:00.000Z';
    const message = { key: newId(), subject: 'Launch', summary: 'Summary', intent: 'Review', priority: 'normal', state: 'informational', lastMessageAt: date, unread: false, isRead: true, isFavorite: false, inboxCategory: 'Important', createdAt: date, updatedAt: date, score: 0.9, inbox };
    const trip = { key: newId(), name: 'Nordic summer' };
    const place = { key: newId(), kind: 'place', name: 'Stockholm', summary: 'City', countryCode: 'SE', latitude: 59.3, longitude: 18.1, status: 'wishlist', isFavorite: false, createdAt: date, trips: [trip] };
    const standalone = { ...place, key: newId(), name: 'Oslo', countryCode: 'NO', trips: undefined };
    const retrieval = projectAppSearchRetrieval(
      { query: 'summer', collectionSlugs: ['email-messages', 'places'], filters: { connectorKey: inbox.connectorKey } },
      { query: 'summer', groups: [{ collectionSlug: 'email-messages', results: [message] }, { collectionSlug: 'places', results: [place, standalone] }] },
    )!;
    expect(retrieval.groups).toEqual([
      { collectionSlug: 'inboxes', results: [{ key: inbox.key, destinationKey: inbox.connectorKey, destinationCollectionSlug: 'email-messages', label: 'Work' }] },
      { collectionSlug: 'trips', results: [{ key: trip.key, label: 'Nordic summer' }] },
      { collectionSlug: 'places', results: [{ key: standalone.key, label: 'Oslo' }] },
    ]);
  });

  test('bounds persisted results and normalizes unsafe labels without failing a successful search', () => {
    const date = '2026-08-24T00:00:00.000Z';
    const results = Array.from({ length: 50 }, (_, index) => ({ key: newId(), scopeKey, name: index === 0 ? '   ' : 'x'.repeat(300), isFavorite: false, createdAt: date, updatedAt: date, score: 0.8 }));
    const retrieval = projectAppSearchRetrieval({ query: 'many', collectionSlugs: ['folders', 'documents', 'files'], limit: 50 }, { query: 'many', groups: [
      { collectionSlug: 'folders', results }, { collectionSlug: 'documents', results }, { collectionSlug: 'files', results },
    ] })!;
    expect(retrieval.groups.flatMap(({ results: items }) => items)).toHaveLength(MAX_APP_SEARCH_RETRIEVAL_RESULTS);
    expect(retrieval.groups[0]!.results[0]!.label).toBe('Resource');
    expect(retrieval.groups[0]!.results[1]!.label).toHaveLength(200);
  });

  test('caps fan-out projections per group while retaining the global result budget', () => {
    const date = '2026-08-24T00:00:00.000Z';
    const images = Array.from({ length: 50 }, (_, index) => ({
      key: newId(), filename: `${index}.jpg`, caption: `Image ${index}`, imageCaptionKey: null, mimeType: 'image/jpeg', sizeBytes: 1, width: 1, height: 1,
      city: null, country: null, countryCode: null, latitude: null, longitude: null, locationSource: null, origin: 'uploaded' as const, mutationPolicy: 'user' as const,
      isFavorite: false, createdAt: date, updatedAt: date, url: `https://example.test/${index}.jpg`, score: 0.8,
      collections: Array.from({ length: 3 }, (_, collectionIndex) => ({ key: `${index}-${collectionIndex}`, name: `Collection ${index}-${collectionIndex}` })),
    }));
    const folders = Array.from({ length: 50 }, (_, index) => ({ key: newId(), scopeKey, name: `Folder ${index}`, isFavorite: false, createdAt: date, updatedAt: date, score: 0.7 }));
    const retrieval = projectAppSearchRetrieval(
      { query: 'many', collectionSlugs: ['images', 'folders'], limit: 50 },
      { query: 'many', groups: [{ collectionSlug: 'images', results: images }, { collectionSlug: 'folders', results: folders }] },
    )!;
    expect(retrieval.groups.map(({ collectionSlug, results }) => [collectionSlug, results.length])).toEqual([['collections', 50], ['folders', 50]]);
    expect(retrieval.groups.flatMap(({ results }) => results)).toHaveLength(MAX_APP_SEARCH_RETRIEVAL_RESULTS);
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
    let contentInput: any;
    const service = createAppSearchService({
      executeEmbedding: async () => { embeddingCalls += 1; return { embedding }; },
      executeContent: (async (tool: string, input: unknown, _context: unknown, dependencies: any) => {
        if (tool === 'document.find') return { results: [] };
        contentInput = input;
        await arrive('content', dependencies.queryEmbedding);
        return { folders: [], documents: [{ documentKey: newId(), scopeKey, name: 'Plan', isFavorite: false, createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', score: 0.8 }], cached: false, query: 'roadmap' };
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
    expect(contentInput).toMatchObject({ query: 'roadmap', minimumScore: -1, limit: 10, recordHistory: false });
    expect(seenEmbeddings).toHaveLength(3);
    expect(seenEmbeddings.every((value) => value === seenEmbeddings[0])).toBe(true);
    expect(seenEmbeddings[0]).toEqual(embedding);
    expect(events.slice(0, 3).sort()).toEqual(['content:start', 'email:start', 'gallery:start']);
    expect(events.at(-1)).toBe('history');
    expect(JSON.stringify(result)).not.toMatch(/embedding|organizationKey|initialSyncCompleted/);
    expect(result.groups[2]).toEqual({ collectionSlug: 'inboxes', results: [{ key: expect.any(String), connectorKey: expect.any(String), provider: 'gmail', email: 'work@example.com', name: 'Work', isFavorite: false, status: 'active', syncEnabled: true, syncStatus: 'idle', createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', score: 0.75, tags: [] }] });
    expect(result.groups[1]).toMatchObject({ collectionSlug: 'images', results: [{ origin: 'generated' }] });
  });

  test('requests enough Archive candidates when documents and files are searched together', async () => {
    let received: any;
    const service = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      executeContent: async (_tool, input) => { received = input; return { query: 'plan', folders: [], documents: [], cached: false } as never; },
    });
    await service.search({ query: 'plan', collectionSlugs: ['documents', 'files'], limit: 50, recordHistory: false }, context);
    expect(received).toMatchObject({ minimumScore: -1, limit: 100 });
  });

  test('forwards Archive hierarchy and creation filters to deterministic document lists', async () => {
    const folderKey = newId(); const boundary = '2026-08-01T00:00:00.000Z'; let received: any;
    const service = createAppSearchService({ executeContent: (async (tool: string, input: unknown) => { received = { tool, input }; return { documents: [] }; }) as never });
    await service.search({ operation: 'list', collectionSlugs: ['documents'], filters: { folderKey, includeDescendants: true, createdFrom: boundary, createdTo: boundary } }, context);
    expect(received).toEqual({ tool: 'document.list', input: { scopeKey, folderKey, includeDescendants: true, createdFrom: boundary, createdTo: boundary, cursor: undefined, limit: 100 } });
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

  test('searches messages across authorized inboxes and honors an optional connector filter', async () => {
    const connectorKey = newId();
    const inboxKey = newId();
    let received: any;
    const service = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      email: { overview: async () => ({ accounts: [{ key: inboxKey, connectorKey, name: 'Work', email: 'work@example.com' }] }), searchMessages: async (actor: unknown, input: unknown, options: unknown) => {
        received = { actor, input, options };
        return { threads: [{ key: newId(), subject: 'Roadmap review', summary: 'Review it', intent: 'Review', priority: 'high', state: 'needs_action', lastMessageAt: '2026-08-24T00:00:00.000Z', unread: true, isRead: false, isFavorite: true, inboxCategory: 'Important', createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', score: 0.82 }] };
      } } as never,
    });
    const all = await service.search({ query: 'message roadmap', collectionSlugs: ['email-messages'], recordHistory: false }, context);
    expect(all.groups[0]).toMatchObject({ results: [{ inbox: { key: inboxKey, connectorKey } }] });
    const result = await service.search({ query: 'message roadmap', collectionSlugs: ['email-messages'], recordHistory: false, filters: { connectorKey, readState: 'unread', emailFacets: ['important', 'favorite'] } }, context);
    expect(received.input).toMatchObject({ connectorKey, readState: 'unread', facets: ['important', 'favorite'], recordHistory: false, minimumScore: -1 });
    expect(received.options.queryEmbedding).toEqual(embedding);
    expect(result.groups[0]).toMatchObject({ collectionSlug: 'email-messages', results: [{ subject: 'Roadmap review', score: 0.82 }] });
  });

  test('searches drafts across authorized inboxes and honors an optional connector filter', async () => {
    const connectorKey = newId();
    const inboxKey = newId();
    let received: any;
    const draftKey = newId();
    const service = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      email: { overview: async () => ({ accounts: [{ key: inboxKey, connectorKey, name: 'Work', email: 'work@example.com' }] }), searchDrafts: async (actor: unknown, input: unknown, options: unknown) => {
        received = { actor, input, options };
        return { drafts: [{ key: draftKey, variant: 'new', connectorKey, to: ['person@example.com'], subject: 'Roadmap follow-up', generatedContent: 'Here is the roadmap.', status: 'generated', createdAt: '2026-08-24T00:00:00.000Z', updatedAt: '2026-08-24T00:00:00.000Z', score: 0.91 }] };
      } } as never,
    });
    const all = await service.search({ query: 'roadmap', collectionSlugs: ['email-drafts'], recordHistory: false }, context);
    expect(all.groups[0]).toMatchObject({ results: [{ inbox: { key: inboxKey, connectorKey } }] });
    const result = await service.search({ query: 'roadmap', collectionSlugs: ['email-drafts'], recordHistory: false, filters: { connectorKey } }, context);
    expect(received.input).toMatchObject({ connectorKey, query: 'roadmap', recordHistory: false, minimumScore: -1 });
    expect(received.options.queryEmbedding).toEqual(embedding);
    expect(result.groups[0]).toMatchObject({ collectionSlug: 'email-drafts', results: [{ key: draftKey, subject: 'Roadmap follow-up', score: 0.91 }] });
  });

  test('searches all authorized inboxes once and merges message scores deterministically', async () => {
    const firstConnector = newId(); const secondConnector = newId(); let overviewCalls = 0; const searched: string[] = [];
    const date = '2026-08-24T00:00:00.000Z';
    const message = (key: string, score: number) => ({ key, subject: key, summary: 'Summary', intent: 'Review', priority: 'normal', state: 'informational', lastMessageAt: date, unread: false, isRead: true, isFavorite: false, inboxCategory: 'Important', createdAt: date, updatedAt: date, score });
    const service = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      email: {
        overview: async () => { overviewCalls += 1; return { accounts: [{ key: 'first-inbox', connectorKey: firstConnector, name: 'First', email: 'first@example.com' }, { key: 'second-inbox', connectorKey: secondConnector, name: 'Second', email: 'second@example.com' }] }; },
        searchMessages: async (_actor: unknown, input: any) => { searched.push(input.connectorKey); return { threads: input.connectorKey === firstConnector ? [message('b', 0.8), message('top', 0.9)] : [message('a', 0.8)] }; },
      } as never,
    });
    const result = await service.search({ query: 'deterministic merge', collectionSlugs: ['email-messages'], limit: 3, recordHistory: false }, context);
    expect(overviewCalls).toBe(1);
    expect(searched.sort()).toEqual([firstConnector, secondConnector].sort());
    expect(result.groups[0]?.results.map((item: any) => item.key)).toEqual(['top', 'a', 'b']);

    searched.length = 0;
    const absentConnector = newId();
    const empty = await service.search({ query: 'connector unavailable', collectionSlugs: ['email-messages'], filters: { connectorKey: absentConnector }, recordHistory: false }, context);
    expect(empty.groups[0]?.results).toEqual([]);
    expect(searched).toEqual([]);
  });

  test('searches books through the canonical book service with trusted scope and shared embedding', async () => {
    let received: any;
    const bookKey = newId(); const date = '2026-08-24T00:00:00.000Z';
    const service = createAppSearchService({
      executeEmbedding: async () => ({ embedding }),
      books: { search: async (input: unknown, actorKey: string, options: unknown) => {
        received = { input, actorKey, options };
        return { books: [{ key: bookKey, title: 'Clear decisions', subtitle: 'A practical guide', description: 'Make better decisions.', status: 'ready', isFavorite: false, isExtending: false, estimatedMinutes: 30, chapterCount: 4, progressPercent: 25, createdAt: date, updatedAt: date, score: 0.88 }] };
      } } as never,
    });
    const result = await service.search({ query: 'decisions', collectionSlugs: ['books'], recordHistory: false }, context);
    expect(received).toEqual({ input: { organizationKey, scopeKey, query: 'decisions', minimumScore: -1, limit: 10 }, actorKey: userKey, options: { queryEmbedding: embedding } });
    expect(result.groups).toEqual([{ collectionSlug: 'books', results: [{ key: bookKey, title: 'Clear decisions', subtitle: 'A practical guide', description: 'Make better decisions.', status: 'ready', isFavorite: false, isExtending: false, estimatedMinutes: 30, chapterCount: 4, progressPercent: 25, createdAt: date, updatedAt: date, score: 0.88, tags: [] }] }]);
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
    expect(received.input).toEqual({ query: 'road', minimumScore: -1, limit: 10 });
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
