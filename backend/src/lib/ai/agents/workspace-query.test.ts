import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { CoreChatInput } from '@/lib/ai/actions';
import { coreAgent, executeCoreAgent } from './core';
import { agentQueryInputSchema, queryWorkspace } from './workspace-query';
import { appSearchRetrievalSchema, type AppSearchRetrieval } from '@/lib/app-search/service';

const teamKey = newId(), scopeKey = newId(), userKey = newId(), collectionKey = newId(), documentKey = newId(), inboxKey = newId(), connectorKey = newId();
const tripKey = newId(), placeKey = newId();
const memoryKey = newId(), bookKey = newId(), chapterKey = newId();
const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId(), userId: userKey, teamKey, status: 'active' } } } as any;

function environment() {
  const calls: any[] = [];
  let recent: AppSearchRetrieval[] = [];
  const search = async (input: any) => {
    calls.push(input);
    const slug = input.collectionSlugs[0];
    if (input.operation === 'get') return { operation: 'get', groups: [{ collectionSlug: slug, results: [slug === 'collections' ? { key: collectionKey, name: 'Summer' } : slug === 'inboxes' ? { key: inboxKey, name: 'Work', connectorKey } : slug === 'trips' ? { key: tripKey, name: 'Nordic route' } : slug === 'places' ? { key: placeKey, name: 'Stockholm' } : slug === 'books' ? { key: bookKey, title: 'A Clear Path', chapters: [{ key: chapterKey, title: 'First step', content: 'Think clearly.' }] } : { key: documentKey, name: 'Itinerary', content: 'Train to Stockholm on Friday.' }] }] };
    if (input.operation === 'count') return { operation: 'count', groups: [{ collectionSlug: slug, count: 2 }] };
    if (input.operation === 'sum') return { operation: 'sum', groups: [{ collectionSlug: slug, field: input.field, sum: 3_145_728, unit: 'bytes', matchedCount: 2, valueCount: 2 }] };
    return { operation: 'list', groups: [{ collectionSlug: slug, results: [slug === 'email-messages' ? { key: newId(), subject: 'Trip confirmation', summary: 'Your train ticket.' } : { key: newId(), title: 'A Clear Path', description: 'A book about better decisions.' }] }] };
  };
  const find = async (name: string) => name === 'nostalgia' ? [{ source: 'imageCollectionMemories', key: memoryKey, label: 'Train journey' }] : name === 'first step' ? [{ source: 'bookChapters', key: chapterKey, parentKey: bookKey, label: 'First step' }] : name === 'journey' ? [{ source: 'documents', key: documentKey, label: 'Itinerary' }, { source: 'trips', key: tripKey, label: 'Nordic route' }] : name === 'Summer' ? [{ source: 'collections', key: collectionKey, label: 'Summer' }] : name === 'Work' ? [{ source: 'emailInboxes', key: inboxKey, label: 'Work' }] : name === 'Nordic route' ? [{ source: 'trips', key: tripKey, label: 'Nordic route' }] : name === 'Stockholm' ? [{ source: 'places', key: placeKey, label: 'Stockholm' }] : [{ source: 'documents', key: documentKey, label: 'Itinerary' }];
  const gallery = { listMemories: async ({ collectionKey: selected }: any) => { expect(selected).toBe(collectionKey); return { memories: [{ key: newId(), collectionKey, text: 'A train journey through Sweden.', createdAt: '2026-09-25T00:00:00.000Z' }] }; }, listHighlights: async () => ({ highlights: [] }), listSubjects: async () => ({ subjects: [] }), readMemory: async () => ({ memory: { key: memoryKey, text: 'A train journey through Sweden.', createdAt: '2026-09-25T00:00:00.000Z' } }) };
  const travel = { listTripGuides: async () => ({ guides: [{ name: 'Rail guide', content: 'Take the train.' }] }), listPlaceReferences: async ({ kind }: any) => ({ references: kind === 'restaurants' ? [{ name: 'Old town dining', content: 'Try the market.' }] : [] }) };
  return { calls, search, find, gallery, query: (input: unknown, onEvidence?: (refs: AppSearchRetrieval[]) => void) => queryWorkspace(input, context, { search: search as never, find: find as never, gallery: gallery as never, travel: travel as never, recent, onEvidence: (refs) => { recent = refs; onEvidence?.(refs); } }), refs: () => recent };
}

describe('isolated current-scope workspace query', () => {
  test('rejects model-supplied identity, scope and arbitrary database selectors', () => {
    expect(() => agentQueryInputSchema.parse({ requests: [{ operation: 'list', resource: 'images', scopeKey }] })).toThrow('Unrecognized key');
    expect(() => agentQueryInputSchema.parse({ requests: [{ operation: 'list', resource: 'authSessions' }] })).toThrow();
    expect(agentQueryInputSchema.parse({ requests: [{ operation: 'search', resource: 'workspace', query: 'Pier Seven' }] }).requests[0]?.resource).toBe('workspace');
  });

  test('rejects inactive membership before discovery or canonical reads', async () => {
    const f = environment();
    await expect(queryWorkspace({ requests: [{ operation: 'discover', resource: 'workspace', query: 'journey' }] }, { ...context, principal: { ...context.principal, userTeam: { ...context.principal.userTeam, status: 'suspended' } } }, { find: f.find as never, search: f.search as never })).rejects.toThrow('Active membership');
    expect(f.calls).toHaveLength(0);
  });

  test('resolves a parent once, keeps a trusted reference and reauthorizes every follow-up', async () => {
    const f = environment();
    const first = await f.query({ requests: [{ operation: 'count', resource: 'images', parent: { resource: 'collections', name: 'Summer' } }] });
    expect(first.results[0]).toMatchObject({ evidence: { groups: [{ count: 2 }] } });
    expect(f.refs()[0]?.groups[0]?.results[0]).toMatchObject({ key: collectionKey, label: 'Summer' });
    const second = await f.query({ requests: [{ operation: 'sum', resource: 'images', parent: { resource: 'collections', recent: true } }] });
    expect(second.results[0]).toMatchObject({ evidence: { groups: [{ sum: 3_145_728, megabytes: 3.145728, mebibytes: 3 }] } });
    expect(f.calls).toContainEqual(expect.objectContaining({ operation: 'sum', collectionSlugs: ['images'], field: 'sizeBytes', filters: { collectionKey } }));
    expect(f.calls.filter(({ operation }) => operation === 'get' && f.calls.length)).toHaveLength(2);
    const third = await f.query({ requests: [{ operation: 'list', resource: 'memories', parent: { resource: 'collections', recent: true } }] });
    expect(third.results[0]).toMatchObject({ items: [{ text: 'A train journey through Sweden.' }] });
    expect(JSON.stringify(third)).not.toContain(collectionKey);
  });

  test('lists and counts Gallery artifacts without requiring a named collection', async () => {
    const f = environment();
    const input = { requests: [{ operation: 'count', resource: 'memories' }, { operation: 'list', resource: 'highlights' }] };
    const result = await queryWorkspace(input, context, {
      search: (async (request: any) => request.collectionSlugs[0] === 'collections' ? { operation: 'list', groups: [{ collectionSlug: 'collections', results: [{ key: collectionKey }] }] } : f.search(request)) as never,
      gallery: { listMemories: f.gallery.listMemories, listHighlights: async () => ({ highlights: [{ key: newId(), createdAt: '2026-09-25T00:00:00.000Z', images: [] }] }) } as never,
    });
    expect(result.results).toMatchObject([{ resource: 'memories', count: 1, status: 'complete' }, { resource: 'highlights', items: [{ images: [] }] }]);
  });

  test('handles an exact count and an unrelated audiobook list in one batch', async () => {
    const f = environment();
    const answer = await f.query({ requests: [{ operation: 'count', resource: 'images' }, { operation: 'list', resource: 'books' }] });
    expect(answer.results).toMatchObject([{ evidence: { groups: [{ count: 2 }] } }, { evidence: { groups: [{ examples: [{ label: 'A Clear Path' }] }] } }]);
  });

  test('sends document, book and image references to the conversation side channel without exposing keys to Core', async () => {
    const imageKey = newId(); const emitted: AppSearchRetrieval[][] = [];
    const rows: Record<string, Array<Record<string, unknown>>> = {
      books: [{ key: bookKey, title: 'A Clear Path' }],
      images: [{ key: imageKey, filename: 'boat.png', caption: 'A blue boat beside a lake.' }],
      documents: [{ key: documentKey, name: 'Itinerary', content: 'Train to Stockholm on Friday.' }],
    };
    const result = await queryWorkspace({ requests: [{ operation: 'list', resource: 'books' }, { operation: 'list', resource: 'images' }, { operation: 'read', resource: 'documents', query: 'Itinerary' }] }, context, {
      find: async () => [{ source: 'documents', key: documentKey, label: 'Itinerary' }],
      search: (async (input: any) => ({ operation: input.operation ?? 'list', groups: [{ collectionSlug: input.collectionSlugs[0], results: rows[input.collectionSlugs[0]] ?? [] }] })) as never,
      onEvidence: (retrievals) => emitted.push(retrievals), expandRelated: false,
    });
    expect(emitted).toHaveLength(1);
    const groups = emitted[0]!.flatMap(({ groups }) => groups);
    expect(groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ collectionSlug: 'documents', results: [expect.objectContaining({ key: documentKey, label: 'Itinerary' })] }),
      expect.objectContaining({ collectionSlug: 'books', results: [expect.objectContaining({ key: bookKey, label: 'A Clear Path' })] }),
      expect.objectContaining({ collectionSlug: 'images', results: [expect.objectContaining({ key: imageKey, label: 'A blue boat beside a lake.' })] }),
    ]));
    for (const key of [documentKey, bookKey, imageKey]) expect(JSON.stringify(result)).not.toContain(key);
  });

  test('persists usable inbox and message references with an authorized connector destination', async () => {
    const threadKey = newId(); const emitted: AppSearchRetrieval[][] = [];
    await queryWorkspace({ requests: [{ operation: 'list', resource: 'email-messages', parent: { resource: 'inboxes', name: 'Work' } }] }, context, {
      find: async () => [{ source: 'emailInboxes', key: inboxKey, label: 'Work' }],
      search: (async (input: any) => ({ operation: input.operation, groups: [{ collectionSlug: input.collectionSlugs[0], results: input.operation === 'get' ? [{ key: inboxKey, name: 'Work', connectorKey }] : [{ key: threadKey, subject: 'Train booking', inbox: { key: inboxKey, name: 'Work', connectorKey } }] }] })) as never,
      onEvidence: (retrievals) => emitted.push(retrievals), expandRelated: false,
    });
    const groups = emitted[0]!.flatMap(({ groups }) => groups);
    expect(groups).toEqual(expect.arrayContaining([
      expect.objectContaining({ collectionSlug: 'email-messages', results: [expect.objectContaining({ key: threadKey, destinationKey: connectorKey })] }),
      expect.objectContaining({ collectionSlug: 'inboxes', results: [expect.objectContaining({ key: inboxKey, destinationKey: connectorKey })] }),
    ]));
  });

  test('persists a specific image pill ahead of an album pill when the question names the depicted object', async () => {
    const imageKey = newId(), otherKey = newId(); const emitted: AppSearchRetrieval[][] = [];
    await queryWorkspace({ requests: [{ operation: 'list', resource: 'images', parent: { resource: 'collections', name: 'Summer' } }] }, context, {
      message: 'Which image in Summer features the red kite?',
      find: async () => [{ source: 'collections', key: collectionKey, label: 'Summer' }],
      search: (async (input: any) => ({ operation: input.operation, groups: [{ collectionSlug: input.collectionSlugs[0], results: input.operation === 'get' ? [{ key: collectionKey, name: 'Summer' }] : [{ key: otherKey, filename: 'boat.png', caption: 'A boat.', collections: [{ key: collectionKey, name: 'Summer' }] }, { key: imageKey, filename: 'kite.png', caption: 'A red kite.', collections: [{ key: collectionKey, name: 'Summer' }] }] }] })) as never,
      onEvidence: (retrievals) => emitted.push(retrievals), expandRelated: false,
    });
    expect(emitted[0]?.[0]?.groups[0]).toMatchObject({ collectionSlug: 'images', results: [{ key: imageKey, destinationKey: collectionKey }] });
    expect(emitted[0]?.flatMap(({ groups }) => groups).some(({ collectionSlug, results }) => collectionSlug === 'collections' && results.some(({ key }) => key === collectionKey))).toBe(true);
  });

  test('discovers across app boundaries and hydrates only through authorized getters', async () => {
    const f = environment();
    const result = await f.query({ requests: [{ operation: 'discover', resource: 'workspace', query: 'journey' }] });
    expect(result.results[0]).toMatchObject({ status: 'complete', matches: [{ resource: 'documents', record: { content: expect.stringContaining('Stockholm') } }, { resource: 'trips', record: { name: 'Nordic route' } }] });
    expect(f.calls.map(({ operation }) => operation)).toEqual(['get', 'get']);
    expect(JSON.stringify(result)).not.toContain(documentKey);
  });

  test('discovers a named document when the model combined its title and subject into one nonmatching phrase', async () => {
    const searches: string[] = [];
    const result = await queryWorkspace({ requests: [{ operation: 'search', resource: 'workspace', query: 'Harbor Ledger Pier Seven' }] }, context, {
      find: async (phrase: string) => { searches.push(phrase); return phrase === 'Harbor Ledger' || phrase === 'Pier Seven' ? [{ source: 'documents', key: documentKey, label: 'Harbor Ledger' }] : []; },
      search: (async (input: any) => ({ groups: [{ collectionSlug: 'documents', results: [{ key: input.key, name: 'Harbor Ledger', content: 'A blue boat at Pier Seven.' }] }] })) as never,
      expandRelated: false,
    });
    expect(searches).toEqual(expect.arrayContaining(['Harbor Ledger Pier Seven', 'Harbor Ledger', 'Pier Seven']));
    expect(result.results[0]).toMatchObject({ status: 'partial', matches: [{ resource: 'documents', record: { name: 'Harbor Ledger', content: expect.stringContaining('Pier Seven') } }] });
  });

  test('keeps communication evidence in a bounded cross-resource search even after many content hits', async () => {
    const threadKey = newId();
    const hits = [...Array.from({ length: 12 }, (_, index) => ({ source: 'documents' as const, key: newId(), label: `Stockholm note ${index}` })), { source: 'emailMessages' as const, key: threadKey, label: 'Rail booking confirmation' }, { source: 'emailThreads' as const, key: threadKey, label: 'Rail booking confirmation' }];
    const result = await queryWorkspace({ requests: [{ operation: 'search', resource: 'workspace', query: 'Stockholm', limit: 3 }] }, context, {
      find: async () => hits,
      search: (async (input: any) => ({ groups: [{ collectionSlug: input.collectionSlugs[0], results: [input.collectionSlugs[0] === 'email-messages' ? { thread: { key: threadKey, subject: 'Rail booking confirmation' }, messages: [{ from: 'rail@example.test', body: 'Stockholm on Friday.' }] } : { key: input.key, name: 'Stockholm note', content: 'Train from Stockholm.' }] }] })) as never,
      expandRelated: false,
    });
    expect(result.results[0]).toMatchObject({ status: 'partial' });
    expect((result.results[0] as { matches: unknown[] }).matches[1]).toMatchObject({ resource: 'email-messages', record: { thread: { subject: 'Rail booking confirmation' }, messages: [{ from: 'rail@example.test' }] } });
  });

  test('persists a single discovered parent as a reauthorized conversation reference', async () => {
    const f = environment();
    const found = await f.query({ requests: [{ operation: 'discover', resource: 'workspace', query: 'Summer' }] });
    expect(found.results[0]).toMatchObject({ matches: [{ resource: 'collections', record: { name: 'Summer' } }] });
    expect(f.refs()[0]?.groups[0]?.results[0]).toMatchObject({ key: collectionKey, label: 'Summer' });
    const next = await f.query({ requests: [{ operation: 'count', resource: 'images', parent: { resource: 'collections', recent: true } }] });
    expect(next.results[0]).toMatchObject({ evidence: { groups: [{ count: 2 }] } });
  });

  test('hydrates linked memories and book chapters without exposing their identifiers', async () => {
    const f = environment();
    const memory = await f.query({ requests: [{ operation: 'discover', resource: 'workspace', query: 'nostalgia' }] });
    const chapter = await f.query({ requests: [{ operation: 'discover', resource: 'workspace', query: 'first step' }] });
    expect(memory.results[0]).toMatchObject({ matches: [{ resource: 'memories', record: { text: 'A train journey through Sweden.' } }] });
    expect(chapter.results[0]).toMatchObject({ matches: [{ resource: 'book-chapters', record: { content: 'Think clearly.' } }] });
    expect(JSON.stringify({ memory, chapter })).not.toMatch(new RegExp(`${memoryKey}|${chapterKey}`));
  });

  test('does not let an inaccessible name collision hide the accessible record', async () => {
    const f = environment(); const privateKey = newId();
    const output = await queryWorkspace({ requests: [{ operation: 'read', resource: 'documents', query: 'Itinerary' }] }, context, {
      find: async () => [{ source: 'documents', key: privateKey, label: 'Itinerary' }, { source: 'documents', key: documentKey, label: 'Itinerary' }],
      search: (async (input: any) => { if (input.key === privateKey) throw new Error('Forbidden'); return f.search(input); }) as never,
    });
    expect(output.results[0]).toMatchObject({ status: 'partial', evidence: { record: { name: 'Itinerary' } } });
    expect(JSON.stringify(output)).not.toContain(privateKey);
  });

  test('finds and hydrates a named document through its canonical authorized get', async () => {
    const f = environment();
    const output = await f.query({ requests: [{ operation: 'read', resource: 'documents', query: 'Itinerary' }] });
    expect(output.results[0]).toMatchObject({ evidence: { record: { name: 'Itinerary', content: expect.stringContaining('Stockholm') } } });
    expect(f.calls).toContainEqual(expect.objectContaining({ operation: 'get', collectionSlugs: ['documents'], key: documentKey }));
  });

  test('resolves an inbox by name but lists messages using its authorized connector', async () => {
    const f = environment();
    await f.query({ requests: [{ operation: 'list', resource: 'email-messages', parent: { resource: 'inboxes', name: 'Work' } }] });
    expect(f.calls).toContainEqual(expect.objectContaining({ operation: 'list', collectionSlugs: ['email-messages'], filters: { connectorKey } }));
    expect(f.refs().flatMap(({ groups }) => groups).find(({ collectionSlug }) => collectionSlug === 'inboxes')?.results[0]).toMatchObject({ key: inboxKey, label: 'Work', destinationKey: connectorKey });
  });

  test('normalizes a model-supplied collection label and repairs an omitted parent from a trusted recent reference', async () => {
    const f = environment();
    const found = await f.query({ requests: [{ operation: 'count', resource: 'images', parent: { resource: 'collections', name: 'collections/Summer' } }] });
    expect(found.results[0]).toMatchObject({ evidence: { groups: [{ count: 2 }] } });
    const missing = await f.query({ requests: [{ operation: 'list', resource: 'images', parent: { resource: 'collections' } }] });
    expect(missing.results[0]).toMatchObject({ status: 'complete', within: { resource: 'collections', name: 'Summer' } });
  });

  test('uses the actual folder relation even when the model mislabels a named folder as a collection', async () => {
    const f = environment(); const folderKey = newId();
    const result = await queryWorkspace({ requests: [{ operation: 'list', resource: 'documents', parent: { resource: 'collections', name: 'Travel Notes' } }] }, context, {
      find: async () => [{ source: 'folders', key: folderKey, label: 'Travel Notes' }],
      search: (async (input: any) => input.operation === 'get' ? { groups: [{ results: [{ key: folderKey, name: 'Travel Notes' }] }] } : f.search(input)) as never,
    });
    expect(result.results[0]).toMatchObject({ status: 'complete', within: { resource: 'folders', name: 'Travel Notes' } });
    expect(f.calls).toContainEqual(expect.objectContaining({ collectionSlugs: ['documents'], filters: { folderKey, includeDescendants: true } }));
  });

  test('defaults a book sum to listening minutes and accepts a self-named trip read', async () => {
    const f = environment();
    await f.query({ requests: [{ operation: 'sum', resource: 'books' }] });
    expect(f.calls).toContainEqual(expect.objectContaining({ operation: 'sum', collectionSlugs: ['books'], field: 'estimatedMinutes' }));
    const trip = await f.query({ requests: [{ operation: 'read', resource: 'trips', parent: { resource: 'trips', name: 'trips/Nordic route' } }] });
    expect(trip.results[0]).toMatchObject({ evidence: { record: { name: 'Nordic route' } } });
  });

  test('follows a trip and place to their authorized guides and references', async () => {
    const f = environment();
    const guides = await f.query({ requests: [{ operation: 'list', resource: 'trip-guides', parent: { resource: 'trips', name: 'Nordic route' } }] });
    expect(guides.results[0]).toMatchObject({ items: [{ name: 'Rail guide', content: 'Take the train.' }] });
    const places = await f.query({ requests: [{ operation: 'list', resource: 'place-references', parent: { resource: 'places', name: 'Stockholm' } }] });
    expect(places.results[0]).toMatchObject({ items: [{ name: 'Old town dining', content: 'Try the market.' }] });
    expect(f.calls).toContainEqual(expect.objectContaining({ operation: 'get', collectionSlugs: ['trips'], key: tripKey }));
    expect(f.calls).toContainEqual(expect.objectContaining({ operation: 'get', collectionSlugs: ['places'], key: placeKey }));
  });

  test('reads both documents named in the trusted question when model read requests omit titles', async () => {
    const secondKey = newId();
    const rows = [{ key: documentKey, name: 'Train Notes', content: 'Stockholm on Friday.' }, { key: secondKey, name: 'Harbor Ledger', content: 'Pier Seven in Stockholm.' }];
    const result = await queryWorkspace({ requests: [{ operation: 'read', resource: 'documents' }, { operation: 'read', resource: 'documents' }] }, context, {
      message: 'What place do Train Notes and Harbor Ledger both mention?',
      search: (async (input: any) => ({ groups: [{ collectionSlug: 'documents', results: input.operation === 'get' ? rows.filter(({ key }) => key === input.key) : rows }] })) as never,
      expandRelated: false,
    });
    expect(result.results[0]).toMatchObject({ evidence: { records: [{ name: 'Train Notes', content: expect.stringContaining('Stockholm') }, { name: 'Harbor Ledger', content: expect.stringContaining('Stockholm') }] } });
    expect(JSON.stringify(result)).not.toContain(secondKey);
  });

  test('repairs an untitled book read despite an unrelated parent selector', async () => {
    const row = { key: bookKey, title: 'Quiet Astronomy', description: 'A calm introduction to the night sky.', audience: 'Beginners' };
    const result = await queryWorkspace({ requests: [{ operation: 'read', resource: 'books', parent: { resource: 'collections' } }] }, context, {
      message: 'Tell me about the audiobook Quiet Astronomy.',
      search: (async () => ({ groups: [{ collectionSlug: 'books', results: [row] }] })) as never,
      expandRelated: false,
    });
    expect(result.results[0]).toMatchObject({ status: 'complete', evidence: { record: { title: 'Quiet Astronomy', description: expect.stringContaining('night sky'), audience: 'Beginners' } } });
  });

  test('reads a named document even when the model mistakes its title for a folder name', async () => {
    const folderKey = newId();
    const output = await queryWorkspace({ requests: [{ operation: 'read', resource: 'documents', parent: { resource: 'folders', name: 'Harbor Ledger' } }] }, context, {
      message: 'What does Harbor Ledger say about Pier Seven?',
      find: async () => [{ source: 'documents', key: documentKey, label: 'Harbor Ledger' }],
      search: (async (input: any) => ({ groups: [{ collectionSlug: input.collectionSlugs[0], results: input.collectionSlugs[0] === 'folders' ? [{ key: folderKey, name: 'Travel Notes' }] : [{ key: documentKey, name: 'Harbor Ledger', content: 'A blue boat at Pier Seven.' }] }] })) as never,
      expandRelated: false,
    });
    expect(output.results[0]).toMatchObject({ evidence: { record: { name: 'Harbor Ledger', content: expect.stringContaining('Pier Seven') } } });
  });

  test('does not let an unspecified folder block a named document in a mixed email comparison', async () => {
    const output = await queryWorkspace({ requests: [{ operation: 'read', resource: 'documents', query: 'Train Notes', parent: { resource: 'folders' } }] }, context, {
      message: 'Compare the booking email with Train Notes.',
      search: (async (input: any) => ({ groups: [{ collectionSlug: input.collectionSlugs[0], results: input.collectionSlugs[0] === 'folders' ? [{ key: newId(), name: 'Travel Notes' }, { key: newId(), name: 'Research Folder' }] : [{ key: documentKey, name: 'Train Notes', content: 'Friday at 09:15.' }] }] })) as never,
      expandRelated: false,
    });
    expect(output.results[0]).toMatchObject({ evidence: { record: { name: 'Train Notes', content: 'Friday at 09:15.' } } });
  });

  test('does not treat a weak title-token match as the sole document for cross-resource discovery', async () => {
    const output = await queryWorkspace({ requests: [{ operation: 'read', resource: 'documents' }] }, context, {
      message: 'Find everything relevant to Pier Seven across my notes, photos, and books.',
      search: (async (input: any) => ({ query: input.query, groups: [{ collectionSlug: 'documents', results: input.operation === 'list' ? [{ key: newId(), name: 'Train Notes' }, { key: documentKey, name: 'Harbor Ledger' }] : [{ key: documentKey, name: 'Harbor Ledger', content: 'A blue boat at Pier Seven.' }] }] })) as never,
      expandRelated: false,
    });
    expect(output.results[0]).toMatchObject({ status: 'partial', evidence: { groups: [{ examples: [{ label: 'Harbor Ledger', content: expect.stringContaining('Pier Seven') }] }] } });
  });

  test('uses a linked collection and title evidence to select the readable sign image', async () => {
    const signKey = newId(), boatKey = newId();
    const result = await queryWorkspace({ requests: [{ operation: 'read', resource: 'images', parent: { resource: 'collections', name: 'City Nights' } }] }, context, {
      message: 'What words appear on the sign in my City Nights image?',
      find: async () => [{ source: 'collections', key: collectionKey, label: 'City Nights' }],
      search: (async (input: any) => ({ groups: [{ collectionSlug: input.collectionSlugs[0], results: input.collectionSlugs[0] === 'collections' ? [{ key: collectionKey, name: 'City Nights' }] : input.operation === 'get' ? [{ key: signKey, caption: 'A sign reading KUST 42.' }] : [{ key: boatKey, caption: 'A blue boat.' }, { key: signKey, caption: 'A sign reading KUST 42.' }] }] })) as never,
      expandRelated: false,
    });
    expect(result.results[0]).toMatchObject({ evidence: { record: { caption: 'A sign reading KUST 42.' } } });
    expect(JSON.stringify(result)).not.toContain(signKey);
  });

  test('hydrates a collection detail with its authorized image captions before Core answers', async () => {
    const f = environment();
    const output = await queryWorkspace({ requests: [{ operation: 'read', resource: 'collections', query: 'Summer' }] }, context, {
      find: f.find as never,
      search: (async (input: any) => ({ groups: [{ collectionSlug: input.collectionSlugs[0], results: input.collectionSlugs[0] === 'collections' ? [{ key: collectionKey, name: 'Summer', count: 2 }] : [{ key: newId(), caption: 'A sign reading KUST 42.' }] }] })) as never,
      expandRelated: false,
    });
    expect(output.results[0]).toMatchObject({ evidence: { record: { name: 'Summer', images: [{ caption: 'A sign reading KUST 42.' }] } } });
  });

  test('includes an authorized named email thread when the model only searched related notes', async () => {
    const threadKey = newId();
    const output = await queryWorkspace({ requests: [{ operation: 'search', resource: 'documents', query: 'Train Notes' }] }, context, {
      message: 'Compare the booking email with Train Notes: do their departure times match?',
      find: async () => [],
      search: (async (input: any) => {
        const slug = input.collectionSlugs[0];
        return { operation: input.operation ?? 'search', groups: [{ collectionSlug: slug, results: slug === 'inboxes' ? [{ key: inboxKey, name: 'Work', connectorKey }]
          : slug === 'email-messages' ? [{ key: threadKey, subject: 'Rail booking confirmation', messages: [{ from: 'rail@example.test', body: 'Friday at 09:15.' }] }]
          : slug === 'documents' ? [{ key: documentKey, name: 'Train Notes', content: 'Friday at 09:15.' }] : [] }] };
      }) as never,
    });
    expect(output.related).toMatchObject([{ resource: 'email-messages', record: { subject: 'Rail booking confirmation', messages: [{ from: 'rail@example.test' }] } }]);
  });

  test('infers the single authorized inbox and hydrates the named email thread without a model key', async () => {
    const threadKey = newId();
    const result = await queryWorkspace({ requests: [{ operation: 'read', resource: 'email-messages' }] }, context, {
      message: 'Who sent the rail booking confirmation?',
      search: (async (input: any) => ({ groups: [{ collectionSlug: input.collectionSlugs[0], results: input.collectionSlugs[0] === 'inboxes' ? [{ key: inboxKey, name: 'Work Mail', connectorKey }] : input.operation === 'get' ? [{ key: threadKey, subject: 'Rail booking confirmation', messages: [{ from: 'rail@example.test', body: 'Friday at 09:15.' }] }] : [{ key: threadKey, subject: 'Rail booking confirmation' }, { key: newId(), subject: 'Gallery share' }] }] })) as never,
      expandRelated: false,
    });
    expect(result.results[0]).toMatchObject({ evidence: { record: { subject: 'Rail booking confirmation', messages: [{ from: 'rail@example.test' }] } } });
  });

  test('keeps successful batch evidence when another resource read fails', async () => {
    const result = await queryWorkspace({ requests: [{ operation: 'sum', resource: 'tags' }, { operation: 'list', resource: 'books' }] }, context, {
      search: (async (input: any) => { if (input.collectionSlugs[0] === 'tags') throw new Error('Unsupported sum'); return { operation: 'list', groups: [{ collectionSlug: 'books', results: [{ key: bookKey, title: 'Quiet Astronomy' }] }] }; }) as never,
      expandRelated: false,
    });
    expect(result.results).toMatchObject([{ resource: 'tags', status: 'unavailable' }, { resource: 'books', evidence: { groups: [{ examples: [{ label: 'Quiet Astronomy' }] }] } }]);
  });

  test('includes authorized trip attachment names alongside a model query for a named trip', async () => {
    const folderKey = newId();
    const result = await queryWorkspace({ requests: [{ operation: 'search', resource: 'folders', query: 'Nordic route' }] }, context, {
      message: 'Which folder and photo collection are attached to Nordic route?',
      search: (async (input: any) => {
        const slug = input.collectionSlugs[0];
        const rows = slug === 'trips' ? [{ key: tripKey, name: 'Nordic route', attachments: [{ type: 'folder', key: folderKey }, { type: 'collection', key: collectionKey }] }]
          : slug === 'folders' ? [{ key: folderKey, name: 'Travel Notes' }] : slug === 'collections' ? [{ key: collectionKey, name: 'City Nights' }] : [];
        return { groups: [{ collectionSlug: slug, results: input.operation === 'get' ? rows.filter((item) => item.key === input.key) : rows }] };
      }) as never,
      find: async () => [],
      travel: { listTripGuides: async () => ({ guides: [{ key: newId(), name: 'Nordic route guide', content: 'Friday train at 09:15.' }] }) } as never,
    });
    expect(result.related?.[0]).toMatchObject({ resource: 'trips', record: { name: 'Nordic route', attachments: [{ type: 'folder', name: 'Travel Notes' }, { type: 'collection', name: 'City Nights' }] } });
    expect(result.related).toContainEqual(expect.objectContaining({ resource: 'trip-guides', items: [{ name: 'Nordic route guide', content: 'Friday train at 09:15.' }] }));
    expect(JSON.stringify(result)).not.toContain(folderKey);
  });

  test('scripted Core model uses one query call per turn and exports a readable transcript', async () => {
    const f = environment();
    const turns = [
      { question: 'How many images are in Summer?', requests: [{ operation: 'count', resource: 'images', parent: { resource: 'collections', name: 'Summer' } }], answer: 'Summer has 2 images.' },
      { question: 'How many MB is this?', requests: [{ operation: 'sum', resource: 'images', field: 'sizeBytes', parent: { resource: 'collections', recent: true } }], answer: 'The images in Summer use 3.15 MB in total.' },
      { question: 'Which memories are in this collection?', requests: [{ operation: 'list', resource: 'memories', parent: { resource: 'collections', recent: true } }], answer: 'Summer has a memory about a train journey through Sweden.' },
      { question: 'How many images and which audio books do we have?', requests: [{ operation: 'count', resource: 'images' }, { operation: 'list', resource: 'books' }], answer: 'There are 2 images. Your audiobook is A Clear Path.' },
      { question: 'What does the document Itinerary say?', requests: [{ operation: 'read', resource: 'documents', query: 'Itinerary' }], answer: 'Itinerary says train to Stockholm on Friday.' },
      { question: 'Which emails are in the Work inbox?', requests: [{ operation: 'list', resource: 'email-messages', parent: { resource: 'inboxes', name: 'Work' } }], answer: 'Work contains Trip confirmation.' },
      { question: 'Find anything about journey.', requests: [{ operation: 'discover', resource: 'workspace', query: 'journey' }], answer: 'I found Itinerary and Nordic route.' },
    ] as const;
    const lines = ['# Isolated Core query fixture', '', 'These answers use a scripted provider and dummy canonical services, not a live model or user database.', ''];
    for (const [index, turn] of turns.entries()) {
      let executions = 0;
      const output = await executeCoreAgent({ message: turn.question, systemPrompt: coreAgent.systemPrompt, currentDate: '2026-09-25T00:00:00.000Z', requestKey: `fixture-${index}` }, { toolContext: context }, {
        tools: {
          names: ['agent.query', 'app.generate-image'], definitions: [{ name: 'agent.query', description: 'Workspace query', inputSchema: { type: 'object', additionalProperties: false } }, { name: 'app.generate-image', description: 'Generate image', inputSchema: { type: 'object', additionalProperties: false } }],
          execute: async (_name, args, dependencies) => { executions++; return f.query(args, dependencies.onEvidence); },
        },
        stream: async function* (_team: string, input: CoreChatInput) {
          if (input.tools?.length) yield { type: 'tool-call' as const, toolCall: { id: `query-${index}`, name: 'agent.query', arguments: { requests: turn.requests } } };
          else {
            const evidence = (input.messages.find((message) => message.role === 'tool')?.content[0] as any)?.result?.result;
            expect(evidence?.results).toHaveLength(turn.requests.length);
            const answer = index === 0 ? `Summer has ${evidence.results[0].evidence.groups[0].count} images.`
              : index === 1 ? `The images in Summer use ${(evidence.results[0].evidence.groups[0].sum / 1_000_000).toFixed(2)} MB in total.`
              : index === 2 ? `Summer has a memory about ${String(evidence.results[0].items[0].text).replace('A train journey through Sweden.', 'a train journey through Sweden.')}`
              : index === 3 ? `There are ${evidence.results[0].evidence.groups[0].count} images. Your audiobook is ${evidence.results[1].evidence.groups[0].examples[0].label}.`
              : index === 4 ? `${evidence.results[0].evidence.record.name} says ${evidence.results[0].evidence.record.content.replace('Train', 'train')}`
              : index === 5 ? `Work contains ${evidence.results[0].evidence.groups[0].examples[0].label}.`
              : `I found ${evidence.results[0].matches.map(({ record }: any) => record.name).join(' and ')}.`;
            yield { type: 'text-delta' as const, text: answer };
          }
          yield { type: 'done' as const };
        },
      });
      expect(output.message).toBe(turn.answer);
      expect(executions).toBe(1);
      lines.push(`User: ${turn.question}`, `Core (scripted): ${output.message}`, '');
    }
    expect(lines.join('\n').trim()).toBe((await Bun.file(new URL('./workspace-query-transcript.txt', import.meta.url)).text()).trim());
  });
});
