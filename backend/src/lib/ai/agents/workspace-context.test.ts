import { afterAll, describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { executeAction } from '@/lib/ai/router';
import { decisionOutputSchema } from '@/lib/ai/actions/decide';
import { gatherWorkspaceContext } from './workspace-context';

const folderKey = newId(), documentKey = newId(), bookKey = newId(), inboxKey = newId(), collectionKey = newId(), tripKey = newId(), placeKey = newId();
const userKey = newId(), teamKey = newId(), scopeKey = newId();
const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey, name: 'Oscar', email: 'user@example.test', countryCode: 'SE' }, userTeam: { key: newId(), teamKey, userId: userKey, status: 'active' } } } as any;
const documents = [{ key: documentKey, name: 'Scanned document', folderKey, content: 'The complete extracted scan says the appointment is on Thursday.', storageKey: 'private/scan', tags: [{ key: newId(), name: 'Work' }] }];

function fixture(modes: Record<string, string>, options: { fail?: string; empty?: string; large?: boolean; invalidDecision?: boolean } = {}) {
  const calls: any[] = [];
  const search = async (input: any) => {
    calls.push(input);
    const slug = input.collectionSlugs[0];
    if (options.fail === slug) throw new Error('private failure');
    if (input.operation === 'count') return { operation: 'count', groups: [{ collectionSlug: slug, count: slug === 'documents' ? 1 : 0 }] };
    if (input.operation === 'get') {
      const rows = slug === 'books' ? [{ key: bookKey, title: 'Clear Decisions', description: 'Making sound choices.', chapters: [{ key: newId(), title: 'First chapter', content: options.large ? 'A'.repeat(20_000) : 'Deep book content about evidence.' }] }]
        : slug === 'documents' || slug === 'files' ? documents : slug === 'email-messages' ? [{ key: newId(), subject: 'Agenda', messages: [{ key: newId(), body: 'Meeting at noon' }] }] : [{ key: folderKey, name: 'Personal' }];
      return { operation: 'get', groups: [{ collectionSlug: slug, results: rows }] };
    }
    const rows = options.empty === slug ? [] : slug === 'folders' ? [{ key: folderKey, name: 'Personal' }]
      : slug === 'inboxes' ? [{ key: newId(), name: 'Work', connectorKey: inboxKey }]
      : slug === 'collections' ? [{ key: collectionKey, name: 'Coastal Days' }]
      : slug === 'images' ? [{ key: newId(), caption: 'Lighthouse at sunset' }]
      : slug === 'books' ? [{ key: bookKey, title: 'Clear Decisions' }]
      : slug === 'trips' ? [{ key: tripKey, name: 'Nordic Summer', places: [{ name: 'Stockholm', summary: 'A stop' }] }]
      : slug === 'places' ? [{ key: placeKey, name: 'Stockholm', summary: 'Capital city' }]
      : slug === 'documents' ? documents.map(({ content: _content, ...item }) => item)
      : slug === 'email-messages' ? [{ key: newId(), subject: 'Agenda' }]
      : slug === 'email-drafts' ? [{ key: newId(), subject: 'Reply', generatedContent: 'Draft reply text.', connectorKey: inboxKey }]
      : slug === 'tag-assignments' ? [{ key: newId(), tag: { key: newId(), name: 'Work' }, target: { key: documentKey, type: 'document', label: 'Scan' } }]
      : [];
    return { ...(input.query ? { query: input.query } : { operation: 'list' }), groups: [{ collectionSlug: slug, results: rows }] };
  };
  const decide = async (_state: string, questions: Record<string, unknown>) => options.invalidDecision ? { answers: {} }
    : { answers: Object.fromEntries(Object.keys(questions).map((name) => [name, { type: 'choice', choice: modes[name] ?? 'skip' }])) };
  return { calls, dependencies: { decide, search: search as never, billing: async () => ({ microSparkBalance: 500, microSparkDebt: 0, storage: { bytes: '42', estimatedMonthlyMicroSparks: '2' }, transactions: [{ key: newId(), kind: 'purchase', microSparks: 500 }] }), referrals: async () => ({ code: { key: newId(), code: 'ABCDEF012345' }, attributionCount: 1 }), subscription: async () => ({ key: newId(), status: 'active', cancelAtPeriodEnd: false, currentPeriodEnd: '2026-10-01T00:00:00.000Z' }) } as any };
}

describe('one-pass workspace evidence', () => {
  test('rejects inactive or mismatched membership before classifier or data access', async () => {
    const f = fixture({ documents: 'inspect' });
    await expect(gatherWorkspaceContext('my docs', { ...context, principal: { ...context.principal, userTeam: { ...context.principal.userTeam, status: 'inactive' } } }, f.dependencies)).rejects.toThrow('active authorized');
    expect(f.calls).toHaveLength(0);
  });
  test('resolves a named folder and reads full documents and files internally', async () => {
    const f = fixture({ folders: 'inspect' });
    const result = await gatherWorkspaceContext('What is in my Personal folder?', context, f.dependencies);
    expect(f.calls).toContainEqual(expect.objectContaining({ operation: 'get', collectionSlugs: ['documents'], key: documentKey }));
    expect(f.calls).toContainEqual(expect.objectContaining({ collectionSlugs: ['documents'], filters: { folderKey, includeDescendants: true } }));
    expect(result.sections.documents?.items[0]).toMatchObject({ name: 'Scanned document', content: expect.stringContaining('Thursday') });
  });
  test('never includes resource, nested tag, storage, user, or scope keys in Core context', async () => {
    const f = fixture({ folders: 'inspect' });
    const { navigation, ...modelContext } = await gatherWorkspaceContext('Personal folder', context, f.dependencies);
    const result = JSON.stringify(modelContext);
    for (const value of [folderKey, documentKey, scopeKey, userKey, 'private/scan', documents[0]!.tags[0]!.key]) expect(result).not.toContain(value);
    expect(JSON.stringify(navigation)).toContain(documentKey);
  });
  test('fetches real chapter content, not just an audiobook title', async () => {
    const f = fixture({ books: 'inspect' });
    const result = await gatherWorkspaceContext('What is the Clear Decisions audiobook about?', context, f.dependencies);
    expect(result.sections.books?.items[0]).toMatchObject({ title: 'Clear Decisions', chapters: [{ title: 'First chapter', content: expect.stringContaining('evidence') }] });
  });
  test('reads saved document summaries and historic version content through canonical Content', async () => {
    const f = fixture({ documents: 'inspect' });
    const requests: string[] = [];
    f.dependencies.executeContent = async (name: string) => {
      requests.push(name);
      if (name === 'document.list-summaries') return { results: [{ success: true, data: { summaries: [{ key: newId(), summary: 'Saved summary of the scan.' }] } }] };
      if (name === 'document.list-versions') return { results: [{ success: true, data: { versions: [{ key: newId(), version: 2 }] } }] };
      return { results: [{ success: true, data: { version: { key: newId(), version: 2, content: 'Earlier document content.' } } }] };
    };
    const result = await gatherWorkspaceContext('What was the saved summary and version of Scanned document?', context, f.dependencies);
    expect(result.sections.documents?.items[0]).toMatchObject({ summaries: [{ summary: 'Saved summary of the scan.' }], versions: [{ version: 2, content: 'Earlier document content.' }] });
    expect(requests).toEqual(['document.list-summaries', 'document.list-versions', 'document.find-version']);
    expect(JSON.stringify(result.sections)).not.toContain(documentKey);
  });
  test('reads persisted travel guide and place reference content under its parent resource', async () => {
    const f = fixture({ trips: 'inspect', places: 'inspect' });
    f.dependencies.travel = {
      listTripGuides: async () => ({ guides: [{ key: newId(), name: 'Nordic route', content: 'Take the train via Stockholm.' }] }),
      listPlaceReferences: async (input: { kind: string }) => ({ references: input.kind === 'restaurants' ? [{ key: newId(), name: 'Stockholm dining', content: 'Visit the old market.' }] : [] }),
    };
    const result = await gatherWorkspaceContext('What does my Nordic Summer trip guide say and what restaurant references are saved for Stockholm?', context, f.dependencies);
    expect(result.sections.trips?.items[0]).toMatchObject({ guides: [{ content: 'Take the train via Stockholm.' }] });
    expect(result.sections.places?.items[0]).toMatchObject({ references: [{ content: 'Visit the old market.' }] });
  });
  test('reads email message body via the authorized detail operation', async () => {
    const f = fixture({ 'email-messages': 'inspect', 'email-drafts': 'inspect' });
    const result = await gatherWorkspaceContext('What does the Agenda email say?', context, f.dependencies);
    expect(result.sections['email-messages']?.items[0]).toMatchObject({ messages: [{ body: 'Meeting at noon' }] });
    expect(result.sections['email-drafts']?.items[0]).toMatchObject({ subject: 'Reply', generatedContent: 'Draft reply text.' });
  });
  test('reads authorized highlights, memories, and subjects with navigable references', async () => {
    const highlightKey = newId(), memoryKey = newId(), subjectKey = newId();
    const f = fixture({ highlights: 'inspect', memories: 'inspect', subjects: 'inspect' });
    f.dependencies.gallery = {
      listHighlights: async () => ({ highlights: [{ key: highlightKey, collectionKey, createdAt: '2026-09-24T00:00:00.000Z', images: [{ key: newId(), caption: 'Sunset over the sea', url: 'https://signed.example/image' }] }] }),
      listMemories: async () => ({ memories: [{ key: memoryKey, text: 'We watched the sunset together.', image: { key: newId(), url: 'https://signed.example/memory' }, createdAt: '2026-09-24T00:00:00.000Z' }] }),
      listSubjects: async () => ({ subjects: [{ key: subjectKey, name: 'Family', description: 'Portraits of family', imageCount: 3 }] }),
    };
    const result = await gatherWorkspaceContext('Tell me about my highlights, memories, and subjects in Coastal Days album', context, f.dependencies);
    expect(result.sections.highlights?.items[0]).toMatchObject({ images: [{ caption: 'Sunset over the sea' }] });
    expect(result.sections.memories?.items[0]).toMatchObject({ text: 'We watched the sunset together.', collectionName: 'Coastal Days' });
    expect(result.sections.subjects?.items[0]).toMatchObject({ name: 'Family', imageCount: 3 });
    expect(result.navigation?.flatMap(({ groups }) => groups.map(({ collectionSlug }) => collectionSlug))).toEqual(expect.arrayContaining(['highlights', 'memories', 'subjects']));
    expect(JSON.stringify(result.sections)).not.toMatch(new RegExp(`${highlightKey}|${memoryKey}|${subjectKey}|${collectionKey}|signed\\.example`));
    expect(result.navigation?.find(({ groups }) => groups[0]?.collectionSlug === 'memories')?.groups[0]?.results[0]).toMatchObject({ key: memoryKey, destinationKey: collectionKey });
  });
  test('uses canonical Gallery totals for memories and highlights without fabricating a count', async () => {
    const f = fixture({ highlights: 'inspect', memories: 'inspect' });
    f.dependencies.gallery = { listHighlights: async () => ({ highlights: [{ key: newId(), collectionKey, images: [], createdAt: '2026-09-24T00:00:00.000Z' }] }), listMemories: async () => ({ memories: [{ key: newId(), text: 'A memory', createdAt: '2026-09-24T00:00:00.000Z' }] }) };
    const result = await gatherWorkspaceContext('How many highlights and memories in Coastal Days collection?', context, f.dependencies);
    expect(result.sections.highlights).toMatchObject({ total: 1, coverage: 'complete' });
    expect(result.sections.memories).toMatchObject({ total: 1, coverage: 'complete' });
  });
  test('resolves an inbox internally before reading its messages', async () => {
    const f = fixture({ inboxes: 'inspect' });
    const result = await gatherWorkspaceContext('What emails are in my Work inbox?', context, f.dependencies);
    expect(f.calls).toContainEqual(expect.objectContaining({ collectionSlugs: ['email-messages'], filters: { connectorKey: inboxKey } }));
    expect(result.sections['email-messages']?.items[0]).toMatchObject({ messages: [{ body: 'Meeting at noon' }] });
    expect(JSON.stringify(result.sections)).not.toContain(inboxKey);
  });
  test('resolves an album internally and marks captions as partial visual evidence', async () => {
    const f = fixture({ collections: 'inspect' });
    const result = await gatherWorkspaceContext('What images are in my Coastal Days album?', context, f.dependencies);
    expect(f.calls).toContainEqual(expect.objectContaining({ collectionSlugs: ['images'], filters: { collectionKey } }));
    expect(result.sections.images).toMatchObject({ coverage: 'partial', items: [{ caption: 'Lighthouse at sunset' }] });
    expect(JSON.stringify(result.sections)).not.toContain(collectionKey);
  });
  test('reads the authenticated account balance and storage usage without ledger IDs', async () => {
    const f = fixture({ billing: 'inspect' });
    const result = await gatherWorkspaceContext('What is my Sparks balance?', context, f.dependencies);
    expect(result.sections.billing?.items[0]).toMatchObject({ sparkBalance: 0.0005, storage: { bytes: '42' } });
    expect(JSON.stringify(result)).not.toContain('"key"');
  });
  test('reads referrals through the canonical account service', async () => {
    const f = fixture({ referrals: 'inspect', 'tag-assignments': 'inspect' });
    const result = await gatherWorkspaceContext('My referral rewards?', context, f.dependencies);
    expect(result.sections.referrals?.items[0]).toMatchObject({ code: { code: 'ABCDEF012345' }, attributionCount: 1 });
    expect(result.sections['tag-assignments']?.items[0]).toMatchObject({ tag: { name: 'Work' }, target: { type: 'document', label: 'Scan' } });
    expect(JSON.stringify(result.sections['tag-assignments'])).not.toContain(documentKey);
    expect(result.navigation?.flatMap(({ groups }) => groups).find(({ collectionSlug }) => collectionSlug === 'documents')?.results[0]).toMatchObject({ key: documentKey, label: 'Scan' });
  });
  test('reads current subscription state without exposing subscription identifiers', async () => {
    const f = fixture({ subscription: 'inspect' });
    const result = await gatherWorkspaceContext('What is my subscription?', context, f.dependencies);
    expect(result.sections.subscription?.items[0]).toMatchObject({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
    expect(JSON.stringify(result.sections.subscription)).not.toContain('"key"');
  });
  test('reads completed messages from a prior authorized chat without returning chat or message keys', async () => {
    const earlierKey = newId(), currentKey = newId();
    const f = fixture({ conversations: 'inspect' });
    f.dependencies.currentConversationKey = currentKey;
    f.dependencies.conversations = {
      list: async () => ({ items: [{ key: currentKey, name: 'Current', updatedAt: '2026-09-25T00:00:00.000Z' }, { key: earlierKey, name: 'Summer plans', updatedAt: '2026-09-23T00:00:00.000Z' }], nextCursor: null }),
      messages: async ({ conversationKey }: { conversationKey: string }) => { expect(conversationKey).toBe(earlierKey); return { items: [{ key: newId(), role: 'USER', status: 'COMPLETED', content: 'We planned a trip to Stockholm.', createdAt: '2026-09-23T00:00:00.000Z' }], nextCursor: null }; },
    };
    const result = await gatherWorkspaceContext('What did we discuss in the Summer plans chat?', context, f.dependencies);
    expect(result.sections.conversations?.items[0]).toMatchObject({ name: 'Summer plans', messages: [{ content: 'We planned a trip to Stockholm.' }] });
    expect(JSON.stringify(result.sections)).not.toMatch(new RegExp(`${earlierKey}|${currentKey}`));
    expect(result.navigation).toBeUndefined();
  });
  test('reads saved email reply notes, image prompts, and authorized workspace names', async () => {
    const f = fixture({ 'email-reply-notes': 'inspect', 'image-generations': 'inspect', scopes: 'inspect' });
    f.dependencies.email = { listReplyContext: async () => [{ key: newId(), name: 'Polite replies', text: 'Keep responses warm and concise.' }] };
    f.dependencies.generations = { listHistory: async () => ({ generations: [{ key: newId(), prompt: 'A mountain at sunrise', usageCount: 2, generatedAt: '2026-09-24T00:00:00.000Z' }] }) };
    f.dependencies.scopes = { list: async () => ({ scopes: [{ key: newId(), name: 'Personal', role: 'owner' }] }) };
    const result = await gatherWorkspaceContext('What are my saved reply notes, generated image prompts and workspaces?', context, f.dependencies);
    expect(result.sections['email-reply-notes']?.items[0]).toMatchObject({ text: 'Keep responses warm and concise.' });
    expect(result.sections['image-generations']?.items[0]).toMatchObject({ prompt: 'A mountain at sunrise', usageCount: 2 });
    expect(result.sections.scopes?.items[0]).toMatchObject({ name: 'Personal', role: 'owner' });
    expect(JSON.stringify(result.sections)).not.toContain('"key"');
  });
  test('projects account profile without leaking identity selectors', async () => {
    const f = fixture({ profile: 'inspect' });
    const result = await gatherWorkspaceContext('What account am I using?', context, f.dependencies);
    expect(result.sections.profile?.items[0]).toEqual({ name: 'Oscar', email: 'user@example.test', countryCode: 'SE' });
  });
  test('uses exact canonical count for a folder rather than inferring from matches', async () => {
    const f = fixture({ folders: 'count' });
    const result = await gatherWorkspaceContext('How many documents in Personal folder?', context, f.dependencies);
    expect(result.sections.documents?.total).toBe(1);
    expect(result.sections.files?.total).toBe(0);
    expect(f.calls).toContainEqual(expect.objectContaining({ operation: 'count', collectionSlugs: ['documents'], filters: { folderKey, includeDescendants: true } }));
  });
  test('combines multiple areas in a single context without model follow-up', async () => {
    const f = fixture({ books: 'inspect', folders: 'inspect', billing: 'inspect' });
    const result = await gatherWorkspaceContext('Personal folder, Clear Decisions and Sparks', context, f.dependencies);
    expect(result.coverage.requested).toEqual(expect.arrayContaining(['folders', 'documents', 'files', 'books', 'billing']));
    expect(result.sections.books?.items).toHaveLength(1);
  });
  test('repairs Jev omissions when a question explicitly names a book and Sparks', async () => {
    const f = fixture({ folders: 'inspect', collections: 'inspect', profile: 'inspect' });
    const result = await gatherWorkspaceContext('Tell me about Clear Decisions audiobook and my Sparks', context, f.dependencies);
    expect(result.coverage.requested).toEqual(expect.arrayContaining(['books', 'billing']));
    expect(result.sections.books?.items[0]).toMatchObject({ chapters: [{ content: expect.stringContaining('evidence') }] });
    expect(result.sections.billing?.items[0]).toMatchObject({ sparkBalance: 0.0005 });
  });
  test('marks failed sources unavailable instead of claiming that no data exists', async () => {
    const f = fixture({ books: 'inspect' }, { fail: 'books' });
    const result = await gatherWorkspaceContext('My audiobook', context, f.dependencies);
    expect(result.sections.books).toMatchObject({ items: [], coverage: 'unavailable' });
  });
  test('marks empty semantic discovery as incomplete, not an exact zero', async () => {
    const f = fixture({ books: 'inspect' }, { empty: 'books' });
    const result = await gatherWorkspaceContext('A book about evidence', context, f.dependencies);
    expect(result.sections.books?.coverage).toBe('partial');
    expect(result.sections.books?.total).toBeUndefined();
  });
  test('does not turn a weak semantic match into an unrelated navigation pill', async () => {
    const f = fixture({ documents: 'inspect' });
    const original = f.dependencies.search;
    f.dependencies.search = async (input: any, ...args: any[]) => {
      const output = await original(input, ...args);
      return input.collectionSlugs[0] === 'documents' && input.query ? { ...output, groups: [{ collectionSlug: 'documents', results: [{ key: documentKey, name: 'Unrelated note', score: 0.1 }] }] } : output;
    };
    const result = await gatherWorkspaceContext('What is my Sparks balance?', context, f.dependencies);
    expect(result.sections.documents?.coverage).toBe('partial');
    expect(result.navigation?.flatMap(({ groups }) => groups).some(({ collectionSlug }) => collectionSlug === 'documents')).not.toBe(true);
  });
  test('does not count an unrelated folder when the requested name cannot be resolved', async () => {
    const f = fixture({ folders: 'count' });
    const result = await gatherWorkspaceContext('How many documents in Unknown folder?', context, f.dependencies);
    expect(result.sections.documents).toMatchObject({ coverage: 'unavailable' });
    expect(f.calls.some((call) => call.operation === 'count' && call.collectionSlugs[0] === 'documents')).toBe(false);
  });
  test('marks truncated chapter content as partial', async () => {
    const f = fixture({ books: 'inspect' }, { large: true });
    const result = await gatherWorkspaceContext('Clear Decisions', context, f.dependencies);
    expect(result.sections.books?.coverage).toBe('partial');
    expect(JSON.stringify(result).length).toBeLessThan(20_000);
  });
  test('falls back to bounded discovery if Jev returns an incomplete plan', async () => {
    const f = fixture({}, { invalidDecision: true });
    const result = await gatherWorkspaceContext('Find my documents', context, f.dependencies);
    expect(result.coverage.requested).toEqual(expect.arrayContaining(['documents', 'files']));
  });
  test('uses recent conversation context to resolve an audiobook mentioned in a previous turn', async () => {
    const f = fixture({ books: 'inspect' });
    await gatherWorkspaceContext('What is this audiobook about?', context, f.dependencies, ['I bought Clear Decisions.']);
    expect(f.calls).toContainEqual(expect.objectContaining({ collectionSlugs: ['books'], operation: 'get', key: bookKey }));
  });
});

// Opt-in, real-provider timing checks: the default suite remains deterministic.
// Run with an existing OPENROUTER_API_KEY; never print or persist the credential.
const liveDecision = process.env.OPENROUTER_API_KEY ? test : test.skip;
const decisionLatencyMs: number[] = [];
afterAll(() => {
  if (!decisionLatencyMs.length) return;
  const sorted = [...decisionLatencyMs].sort((a, b) => a - b);
  console.info('Jev workspace decision latency', { samples: sorted.length, p50Ms: sorted[Math.floor((sorted.length - 1) * 0.5)], p95Ms: sorted[Math.ceil(sorted.length * 0.95) - 1] });
});

for (const { question, expected } of [
  { question: 'What files and documents are in my Personal folder?', expected: ['folders', 'documents', 'files'] },
  { question: 'What is the Clear Decisions audiobook about, and what is my Sparks balance?', expected: ['books', 'billing'] },
  { question: 'What emails are in my Work inbox?', expected: ['email-messages'] },
  { question: 'Hur många dokument finns i min Personal mapp?', expected: ['documents'] },
  { question: 'What highlights and memories are in my Coastal Days album?', expected: ['highlights', 'memories'] },
]) {
  liveDecision(`Jev routes and times: ${question}`, async () => {
    const f = fixture({}); let decisions = 0;
    f.dependencies.gallery = { listHighlights: async () => ({ highlights: [] }), listMemories: async () => ({ memories: [] }), listSubjects: async () => ({ subjects: [] }) };
    f.dependencies.conversations = { list: async () => ({ items: [], nextCursor: null }), messages: async () => ({ items: [], nextCursor: null }) };
    f.dependencies.email = { listReplyContext: async () => [] };
    f.dependencies.generations = { listHistory: async () => ({ generations: [] }) };
    f.dependencies.scopes = { list: async () => ({ scopes: [] }) };
    const result = await gatherWorkspaceContext(question, context, { ...f.dependencies, decide: async (state, questions) => {
      const started = performance.now();
      const response = await executeAction({ mode: 'auto', teamKey, actionSlug: 'decide' }, { state, questions }, { timeoutMs: 2_000 });
      decisionLatencyMs.push(Math.round(performance.now() - started));
      decisions++;
      return decisionOutputSchema.parse(response.output);
    } });
    expect(decisions).toBe(1);
    expect(result.coverage.requested).toEqual(expect.arrayContaining(expected));
  }, 10_000);
}
