import { afterAll, describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { executeAction } from '@/lib/ai/router';
import { decisionOutputSchema } from '@/lib/ai/actions/decide';
import { gatherWorkspaceContext } from './workspace-context';

const folderKey = newId(), documentKey = newId(), bookKey = newId(), inboxKey = newId(), collectionKey = newId();
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
  test('reads email message body via the authorized detail operation', async () => {
    const f = fixture({ 'email-messages': 'inspect', 'email-drafts': 'inspect' });
    const result = await gatherWorkspaceContext('What does the Agenda email say?', context, f.dependencies);
    expect(result.sections['email-messages']?.items[0]).toMatchObject({ messages: [{ body: 'Meeting at noon' }] });
    expect(result.sections['email-drafts']?.items[0]).toMatchObject({ subject: 'Reply', generatedContent: 'Draft reply text.' });
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
  });
  test('reads current subscription state without exposing subscription identifiers', async () => {
    const f = fixture({ subscription: 'inspect' });
    const result = await gatherWorkspaceContext('What is my subscription?', context, f.dependencies);
    expect(result.sections.subscription?.items[0]).toMatchObject({ status: 'active', currentPeriodEnd: '2026-10-01T00:00:00.000Z' });
    expect(JSON.stringify(result.sections.subscription)).not.toContain('"key"');
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
]) {
  liveDecision(`Jev routes and times: ${question}`, async () => {
    const f = fixture({}); let decisions = 0;
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
