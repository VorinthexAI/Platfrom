import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools';
import type { ConversationRepository } from './repository';
import { conversationReferenceContext, createConversationService, estimateConservativeTokens, trimConversationQueryResults } from './service';
import {
  agentQueryInputSchema, conversationImageTurnInputSchema, conversationListInputSchema, conversationMessageDeleteInputSchema, conversationMessageListInputSchema, conversationModelSendInputSchema, conversationSearchInputSchema,
  conversationMessageSchema, conversationSendInputSchema, encodeCursor, projectConversationMessage, type ConversationMessage,
} from './schemas';

const organizationKey = newId(), scopeKey = newId(), userKey = newId(), conversationKey = newId();
const at = '2026-09-01T10:00:00.000Z';
const owner = { organizationKey, scopeKey, userKey };
const context = { organizationKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userOrganization: { key: newId(), organizationId: organizationKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const message = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  key: newId(), conversationKey, organizationKey, scopeKey, userKey, turnKey: 'request-1', requestHash: 'a'.repeat(64), type: 'TEXT',
  role: 'ASSISTANT', status: 'COMPLETED', content: 'answer', retrievals: [], createdAt: at, completedAt: at, ...overrides,
});

type RepositoryOverrides = Partial<ConversationRepository> & { first?: boolean; recent?: ConversationMessage[] };
function repositoryMock(overrides: RepositoryOverrides = {}) {
  const pending = message({ status: 'PENDING', content: 'Pending', completedAt: undefined }); let failed = 0;
  const repository = {
    beginTurn: async (_owner: typeof owner, _conversationKey: string, user: ConversationMessage, assistant: ConversationMessage) => ({ state: 'created' as const, user, assistant: { ...assistant, key: pending.key }, first: overrides.first ?? false }),
    latestCompletedMessages: async () => overrides.recent ?? [], setMessageEmbedding: async () => true,
    completeTurn: async (_owner: typeof owner, _conversation: string, _key: string, content: string, embedding: number[], retrievals: any[], completedAt: string, generatedName?: string) => ({ message: { ...pending, status: 'COMPLETED' as const, content, embedding, retrievals, completedAt }, nameApplied: Boolean(generatedName) }),
    failTurn: async () => { failed += 1; }, ...overrides,
  } as unknown as ConversationRepository;
  return { repository, failed: () => failed };
}

describe('private conversations', () => {
  test('keeps agent.query strict and rejects forged trusted selectors before embedding', async () => {
    expect(agentQueryInputSchema.parse({ query: 'history' })).toEqual({ query: 'history', limit: 20 });
    expect(() => agentQueryInputSchema.parse({ query: 'x', limit: 21 })).toThrow();
    for (const forged of ['conversationKey', 'organizationKey', 'scopeKey', 'userKey']) expect(() => agentQueryInputSchema.parse({ query: 'x', [forged]: newId() })).toThrow('Unrecognized key');
    expect(() => conversationSendInputSchema.parse({ conversationKey, message: 'x', requestKey: 'r', extra: true })).toThrow('Unrecognized key');
    expect(() => conversationModelSendInputSchema.parse({ conversationKey, message: 'x', requestKey: 'forged' })).toThrow('Unrecognized key');
    expect(() => conversationMessageDeleteInputSchema.parse({ conversationKey, messageKey: newId(), userKey })).toThrow('Unrecognized key');
    expect(projectConversationMessage(message({ embedding: [1] }))).not.toHaveProperty('embedding');
    const { retrievals: _retrievals, ...legacy } = message();
    expect(conversationMessageSchema.parse(legacy)).toHaveProperty('retrievals', []);
    expect(() => conversationMessageSchema.parse({ ...message(), unexpected: true })).toThrow('Unrecognized key');
    expect(() => conversationImageTurnInputSchema.parse({ conversationKey, prompt: 'x', requestKey: 'r', count: 2 })).toThrow('Unrecognized key');
    expect(() => conversationMessageSchema.parse({ ...message(), type: 'TEXT', imageKey: newId() })).toThrow('Text messages cannot reference');
    expect(() => conversationMessageSchema.parse({ ...message(), type: 'IMAGE' })).toThrow('require an image reference');
    expect(conversationMessageSchema.parse({ ...message(), type: 'IMAGE', imageKey: newId(), embedding: undefined }).type).toBe('IMAGE');
    let embeds = 0;
    await expect(createConversationService({ repository: {} as ConversationRepository, embed: async () => { embeds += 1; return [1]; } }).query({ ...context, organizationKey: newId() }, { query: 'secret' })).rejects.toThrow('Membership does not belong');
    expect(embeds).toBe(0);
  });

  test('deletes the canonical paired turn with trusted ownership', async () => {
    const selectedMessageKey = newId(), pairedMessageKey = newId(); const calls: unknown[] = [];
    const repository = { deleteMessageTurn: async (...args: unknown[]) => { calls.push(args); return [selectedMessageKey, pairedMessageKey]; } } as unknown as ConversationRepository;
    await expect(createConversationService({ repository, now: () => at }).deleteMessage({ conversationKey, messageKey: selectedMessageKey }, context)).resolves.toEqual({ deletedKeys: [selectedMessageKey, pairedMessageKey] });
    expect(calls).toEqual([[owner, conversationKey, selectedMessageKey, at]]);
    const missing = createConversationService({ repository: { deleteMessageTurn: async () => null } as unknown as ConversationRepository });
    await expect(missing.deleteMessage({ conversationKey, messageKey: selectedMessageKey }, context)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('embeds agent.query only when called and performs owner-wide top-20 retrieval', async () => {
    const seen: unknown[] = [];
    const repository = { semanticMessages: async (...args: unknown[]) => { seen.push(args); return []; } } as unknown as ConversationRepository;
    expect(await createConversationService({ repository, embed: async (input) => { seen.push(input); return [0.25]; } }).query(context, { query: ' prior ' })).toEqual({ messages: [] });
    expect(seen).toEqual([{ text: 'prior', purpose: 'query', signal: undefined, timeoutMs: undefined }, [owner, [0.25], 20]]);
  });

  test('orders and conservatively bounds semantic results', () => {
    const retrieval = { query: 'roadmap', limit: 1, minimumScore: 0.55, groups: [{ collectionSlug: 'documents' as const, results: [{ key: newId(), label: 'Roadmap' }] }] };
    const rows = [{ message: message({ content: 'old', retrievals: [retrieval], createdAt: '2026-01-01T00:00:00.000Z' }), similarity: 0.8 }, { message: message({ content: 'new', createdAt: '2026-02-01T00:00:00.000Z' }), similarity: 0.9 }];
    expect(trimConversationQueryResults(rows).messages.map(({ content }) => content)).toEqual(['old', 'new']);
    expect(trimConversationQueryResults(rows).messages[0]!.retrievals).toEqual([retrieval]);
    expect(trimConversationQueryResults(rows, 1, (value) => value.includes('old') ? 2 : 1).messages.map(({ content }) => content)).toEqual(['new']);
    expect(estimateConservativeTokens('abc')).toBe(3); expect(estimateConservativeTokens('😀')).toBe(4);
  });

  test('projects retrievals into ordered typed references without leaking search filters', () => {
    const first = newId(), second = newId();
    const references = conversationReferenceContext([{ query: 'resa', limit: 2, filters: { isFavorite: true }, groups: [{ collectionSlug: 'trips', results: [{ key: first, label: 'Japan' }, { key: second, label: 'Italy', destinationKey: newId(), destinationCollectionSlug: 'places' }] }] }]);
    expect(references).toEqual([{ query: 'resa', references: [
      { ordinal: 1, collectionSlug: 'trips', key: first, label: 'Japan' },
      expect.objectContaining({ ordinal: 2, collectionSlug: 'trips', key: second, label: 'Italy', destinationCollectionSlug: 'places' }),
    ] }]);
    expect(JSON.stringify(references)).not.toContain('isFavorite');
  });

  test('delegates latest 50 completed prior messages to Core with current message separate', async () => {
    const prior = Array.from({ length: 55 }, (_, index) => message({ role: index % 2 ? 'ASSISTANT' : 'USER', content: `prior-${index}`, createdAt: new Date(Date.UTC(2026, 0, index + 1)).toISOString() }));
    let startedUser: ConversationMessage | undefined; let request: any; let execution: any;
    const { repository } = repositoryMock({ beginTurn: async (_owner, _conversation, user, assistant) => { startedUser = user; return { state: 'created', user, assistant, first: false }; }, latestCompletedMessages: async () => [...prior, startedUser!] });
    await createConversationService({ repository, embed: async () => [1], core: async (input, suppliedExecution) => { request = input; execution = suppliedExecution; return { message: 'answer', tools: [] }; } }).turn({ conversationKey, message: 'CURRENT', requestKey: 'history' }, context, () => {});
    expect(request.message).toBe('CURRENT'); expect(request.context).toHaveLength(50);
    expect(request.context.map((item: { content: string }) => item.content)).toEqual(prior.slice(-50).map(({ content }) => content));
    expect(JSON.stringify(request.context)).not.toContain('CURRENT');
    expect(execution.currentConversationKey).toBe(conversationKey);
  });

  test('routes one selected generated image directly to an image-only turn', async () => {
    const referenceImageKey = newId(); const pairs: ConversationMessage[][] = []; const events: any[] = [];
    const { repository } = repositoryMock({ beginImageTurn: async (_owner, _conversation, user, assistant) => { pairs.push([user, assistant]); return { state: 'created', user, assistant }; } });
    await createConversationService({ repository, enqueueImageJob: async () => undefined, core: async () => { throw new Error('Core must not produce text for an explicit image edit.'); } }).turn({ conversationKey, message: 'Make the sky blue', requestKey: 'edit-image', referenceImageKeys: [referenceImageKey] }, context, (event) => { events.push(event); });
    expect(JSON.parse(pairs[0]![1]!.content).referenceImageKeys).toEqual([referenceImageKey]);
    expect(events.map(({ type }) => type)).toEqual(['start', 'done']);
    expect(events.at(-1)?.message).toMatchObject({ type: 'IMAGE', role: 'ASSISTANT', status: 'PENDING' });
    expect(() => conversationSendInputSchema.parse({ conversationKey, message: 'x', requestKey: 'too-many', referenceImageKeys: [newId(), newId()] })).toThrow();
  });

  test('finishes a Core image request with only the enqueued image turn', async () => {
    const imageUser = message({ key: newId(), type: 'IMAGE', role: 'USER', content: 'Draw Earth', imageKey: undefined });
    const imageAssistant = message({ key: newId(), type: 'IMAGE', status: 'PENDING', content: '{}', imageKey: undefined, completedAt: undefined });
    const deleted: string[] = []; const events: any[] = [];
    const { repository } = repositoryMock({ deleteMessageTurn: async (_owner, _conversationKey, messageKey) => { deleted.push(messageKey); return [newId(), messageKey]; } });
    await createConversationService({
      repository,
      embed: async () => [1],
      core: async (_request, execution) => {
        execution.onDelta?.('I have initiated generation.');
        execution.onToolSucceeded?.('conversation.image.enqueue', { prompt: 'Draw Earth' }, { user: projectConversationMessage(imageUser), assistant: projectConversationMessage(imageAssistant), replayed: false });
        return { message: 'I have initiated generation.', tools: [{ slug: 'conversation.image.enqueue', status: 'succeeded' as const }] };
      },
    }).turn({ conversationKey, message: 'Draw Earth', requestKey: 'core-image' }, context, (event) => { events.push(event); });
    expect(events.map(({ type }) => type)).toEqual(['start', 'done']);
    expect(events.at(-1)?.message).toEqual(projectConversationMessage(imageAssistant));
    expect(deleted).toHaveLength(1);
  });

  test('persists concurrent image pairs without waiting for generation and replays idempotently', async () => {
    const jobs: any[] = []; const pairs: ConversationMessage[][] = [];
    const repository = {
      beginImageTurn: async (_owner: unknown, _key: string, user: ConversationMessage, assistant: ConversationMessage) => { pairs.push([user, assistant]); return { state: 'created' as const, user, assistant }; },
    } as unknown as ConversationRepository;
    const service = createConversationService({ repository, now: () => at, enqueueImageJob: async (job) => { jobs.push(job); } });
    const [first, second] = await Promise.all([
      service.enqueueImageTurn({ conversationKey, prompt: 'One', requestKey: 'image-1' }, context),
      service.enqueueImageTurn({ conversationKey, prompt: 'Two', requestKey: 'image-2' }, context),
    ]);
    expect(pairs).toHaveLength(2); expect(jobs).toHaveLength(2);
    expect([first.assistant.status, second.assistant.status]).toEqual(['PENDING', 'PENDING']);
    expect(pairs.flat().every(({ type }) => type === 'IMAGE')).toBe(true);
    expect(jobs.map(({ input }) => input.prompt)).toEqual(['One', 'Two']);

    const replay = createConversationService({ repository: { beginImageTurn: async () => ({ state: 'replay', user: pairs[0]![0]!, assistant: { ...pairs[0]![1]!, status: 'COMPLETED', imageKey: newId(), completedAt: at } }) } as unknown as ConversationRepository, enqueueImageJob: async () => { throw new Error('must not enqueue'); } });
    await expect(replay.enqueueImageTurn({ conversationKey, prompt: 'One', requestKey: 'image-1' }, context)).resolves.toMatchObject({ replayed: true, assistant: { status: 'COMPLETED', type: 'IMAGE' } });
  });

  test('claims transient attachments for Core without persisting or embedding their content and releases them after the turn', async () => {
    const imageKey = newId(), documentKey = newId(), released: string[] = []; let request: any; let startedUser: ConversationMessage | undefined;
    const { repository } = repositoryMock({ beginTurn: async (_owner, _conversation, user, assistant) => { startedUser = user; return { state: 'created', user, assistant, first: false }; } });
    const records = new Map([
      [imageKey, { key: imageKey, status: 'claimed', result: { kind: 'image', filename: 'photo.png', mimeType: 'image/png', sizeBytes: 3, storageKey: 'temporary/image' } }],
      [documentKey, { key: documentKey, status: 'claimed', result: { kind: 'document', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 5, content: 'private attachment text' } }],
    ]);
    const embeds: string[] = [];
    await createConversationService({
      repository,
      embed: async ({ text }) => { embeds.push(text); return [1]; },
      claimAttachment: async (rawInput, selectedOwner) => { const { attachmentKey } = rawInput as { attachmentKey: string }; expect(selectedOwner).toEqual(owner); return records.get(attachmentKey) as never; },
      releaseAttachment: async (record) => { released.push(record.key); },
      attachmentStorage: { download: async () => ({ bytes: new Uint8Array([1, 2, 3]), sizeBytes: 3, mimeType: 'image/png' }) },
      core: async (input) => { request = input; return { message: 'answer', tools: [] }; },
    }).turn({ conversationKey, message: 'Use these', requestKey: 'attachments', attachmentKeys: [imageKey, documentKey] }, context, () => {});
    expect(request.attachments).toEqual([
      { kind: 'image', filename: 'photo.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
      { kind: 'document', filename: 'notes.txt', mimeType: 'text/plain', text: 'private attachment text' },
    ]);
    expect(startedUser!.content).toBe('Use these');
    expect(embeds).toEqual(['Use these', 'answer']);
    expect(released).toEqual([imageKey, documentKey]);
  });

  test('keeps the newest recent context within the aggregate bound and orders a turn user-first', async () => {
    const large = Array.from({ length: 3 }, (_, index) => message({ role: index % 2 ? 'ASSISTANT' : 'USER', content: `${index}:${'x'.repeat(99_990)}`, createdAt: new Date(Date.UTC(2026, 7, index + 1)).toISOString() }));
    let request: any; let startedAssistant: ConversationMessage | undefined;
    const { repository } = repositoryMock({
      beginTurn: async (_owner, _conversation, user, assistant) => { startedAssistant = assistant; return { state: 'created', user, assistant, first: false }; },
      latestCompletedMessages: async () => large,
    });
    await createConversationService({ repository, now: () => at, embed: async () => [1], core: async (input) => { request = input; return { message: 'answer', tools: [] }; } }).turn({ conversationKey, message: 'question', requestKey: 'bounded-context' }, context, () => {});
    expect(request.context).toHaveLength(2);
    expect(request.context.map((item: { content: string }) => item.content[0])).toEqual(['1', '2']);
    expect(startedAssistant!.createdAt).toBe('2026-09-01T10:00:00.001Z');
  });

  test('streams Core deltas, applies first name, persists both embeddings, and preserves done SSE', async () => {
    const embeddings: unknown[] = []; const events: any[] = []; let savedName: string | undefined;
    const { repository } = repositoryMock({ first: true, completeTurn: async (_owner, _conversation, _key, content, embedding, _retrievals, _completed, name) => { savedName = name; return { message: message({ content, embedding }), nameApplied: true }; } });
    await createConversationService({
      repository, now: () => at, embed: async (input) => { embeddings.push(input); return [1]; },
      core: async (request, execution) => { expect(request).toMatchObject({ currentDate: at, generateName: true, requestKey: 'first' }); await execution.onDelta?.('Hello '); await execution.onDelta?.('there'); return { message: 'Hello there', name: 'Introductions', tools: [] }; },
    }).turn({ conversationKey, message: 'Hello', requestKey: 'first' }, context, (event) => { events.push(event); });
    expect(events.map(({ type }) => type)).toEqual(['start', 'delta', 'delta', 'done']);
    expect(savedName).toBe('Introductions'); expect(embeddings.map((input: any) => input.text)).toEqual(['Hello', 'Hello there']);
  });

  test('captures every successful resource tool as a result retrieval on the assistant message', async () => {
    const collectionKey = newId(); const folderKey = newId(); const deletedKey = newId(); let persisted: unknown[] = []; const events: any[] = [];
    const { repository } = repositoryMock({ completeTurn: async (_owner, _conversation, _key, content, embedding, retrievals, completedAt) => { persisted = retrievals; return { message: message({ content, embedding, retrievals, completedAt }), nameApplied: false }; } });
    await createConversationService({
      repository, now: () => at, embed: async () => [1],
      core: async (_request, execution) => {
        execution.onToolSucceeded?.('collection.list', { limit: 3 }, { collections: [{ key: collectionKey, name: 'City After Rain' }], images: [{ key: newId(), filename: 'not-a-collection.jpg' }], nextCursor: null });
        execution.onToolSucceeded?.('folder.create', { name: 'Research' }, { key: folderKey, name: 'Research' });
        execution.onToolSucceeded?.('folder.delete', {}, { deletedKey });
        return { message: 'Here are your collections', tools: [] };
      },
    }).turn({ conversationKey, message: 'Visa mig 3 collections', requestKey: 'list-capture' }, context, (event) => { events.push(event); });
    expect(persisted).toEqual([
      { source: 'results', limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: 'collections', results: [{ key: collectionKey, label: 'City After Rain' }] }] },
      { source: 'results', limit: 10, minimumScore: 0.55, groups: [{ collectionSlug: 'folders', results: [{ key: folderKey, label: 'Research' }] }] },
    ]);
    expect(JSON.stringify(persisted)).not.toContain(deletedKey);
    expect(events.at(-1)).toMatchObject({ type: 'done', message: { retrievals: persisted } });
  });

  test('captures at most four retrievals per turn regardless of how many resource tools succeed', async () => {
    let persisted: unknown[] = [];
    const { repository } = repositoryMock({ completeTurn: async (_owner, _conversation, _key, content, embedding, retrievals, completedAt) => { persisted = retrievals; return { message: message({ content, embedding, retrievals, completedAt }), nameApplied: false }; } });
    await createConversationService({
      repository, now: () => at, embed: async () => [1],
      core: async (_request, execution) => {
        for (let index = 0; index < 6; index += 1) execution.onToolSucceeded?.('folder.create', { name: `Folder ${index}` }, { key: newId(), name: `Folder ${index}` });
        return { message: 'Created several folders', tools: [] };
      },
    }).turn({ conversationKey, message: 'Create folders', requestKey: 'cap' }, context, () => {});
    expect(persisted).toHaveLength(4);
  });

  test('captures successful app.search projections atomically and exposes them in done and replay messages', async () => {    const resultKey = newId(); let persisted: unknown[] = []; const events: any[] = [];
    const { repository } = repositoryMock({ completeTurn: async (_owner, _conversation, _key, content, embedding, retrievals, completedAt) => { persisted = retrievals; return { message: message({ content, embedding, retrievals, completedAt }), nameApplied: false }; } });
    await createConversationService({
      repository, now: () => at, embed: async () => [1],
      core: async (_request, execution) => {
        execution.onToolSucceeded?.('app.search', { query: ' roadmap ', collectionSlugs: ['folders'], limit: 3 }, { query: 'roadmap', groups: [{ collectionSlug: 'folders', results: [{ key: resultKey, scopeKey, name: 'Roadmap', isFavorite: false, createdAt: at, updatedAt: at, score: 0.9 }] }] });
        execution.onToolSucceeded?.('folder.list', {}, { folders: [] });
        return { message: 'Found it', tools: [] };
      },
    }).turn({ conversationKey, message: 'Find roadmap', requestKey: 'retrieval' }, context, (event) => { events.push(event); });
    expect(persisted).toEqual([{ query: 'roadmap', limit: 3, searchCollectionSlugs: ['folders'], groups: [{ collectionSlug: 'folders', results: [{ key: resultKey, label: 'Roadmap' }] }] }]);
    expect(events.at(-1)).toMatchObject({ type: 'done', replayed: false, message: { retrievals: persisted } });

    const replayEvents: any[] = [];
    await createConversationService({ repository: { beginTurn: async () => ({ state: 'replay', user: message({ role: 'USER' }), assistant: message({ content: 'Found it', retrievals: persisted as never }), first: false }) } as unknown as ConversationRepository }).turn({ conversationKey, message: 'Find roadmap', requestKey: 'retrieval' }, context, (event) => { replayEvents.push(event); });
    expect(replayEvents.at(-1)).toMatchObject({ type: 'done', replayed: true, message: { retrievals: persisted } });
  });

  test('keeps a completed agent answer successful when semantic indexing fails', async () => {
    const events: any[] = []; let completedEmbedding: number[] | undefined | null = null;
    const { repository, failed } = repositoryMock({
      setMessageEmbedding: async () => { throw new Error('user indexing unavailable'); },
      completeTurn: async (_owner, _conversation, _key, content, embedding, _retrievals, completedAt) => { completedEmbedding = embedding; return { message: message({ content, embedding, completedAt }), nameApplied: false }; },
    });
    await createConversationService({ repository, embed: async () => { throw new Error('indexing unavailable'); }, core: async (_request, execution) => { await execution.onDelta?.('answer'); return { message: 'answer', tools: [] }; } }).turn({ conversationKey, message: 'question', requestKey: 'index-failure' }, context, (event) => { events.push(event); });
    expect(events.map(({ type }) => type)).toEqual(['start', 'delta', 'done']);
    expect(completedEmbedding).toBeUndefined();
    expect(failed()).toBe(0);
  });

  test('replays idempotently and completes a fallback after retrying Core failures', async () => {
    const replayEvents: any[] = [];
    await createConversationService({ repository: { beginTurn: async () => ({ state: 'replay', user: message({ role: 'USER' }), assistant: message({ content: 'Already done' }), first: false }) } as unknown as ConversationRepository }).turn({ conversationKey, message: 'again', requestKey: 'request-1' }, context, (event) => { replayEvents.push(event); });
    expect(replayEvents.at(-1)).toMatchObject({ type: 'done', replayed: true, message: { content: 'Already done' } });
    const events: any[] = []; let attempts = 0;
    const { repository, failed } = repositoryMock({ completeTurn: async (_owner, _conversation, _key, content, embedding, retrievals, completedAt) => ({ message: message({ content, embedding, retrievals, completedAt }), nameApplied: false }) });
    await createConversationService({ repository, embed: async () => [1], core: async () => { attempts += 1; throw new Error('agent failed'); } }).turn({ conversationKey, message: 'x', requestKey: 'failed' }, context, (event) => { events.push(event); });
    expect(attempts).toBe(2);
    expect(failed()).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: 'done', message: { status: 'COMPLETED', content: 'I could not complete that request reliably. Please try again.' } });
  });

  test('preserves an exact app.search count when both agent continuations fail', async () => {
    const events: any[] = []; let attempts = 0; const embedded: string[] = [];
    const { repository } = repositoryMock();
    await createConversationService({
      repository,
      embed: async ({ text }) => { embedded.push(text); return [1]; },
      core: async (_request, execution) => {
        attempts += 1;
        execution.onToolSucceeded?.('app.search', { operation: 'count', collectionSlugs: ['trips'] }, { operation: 'count', groups: [{ collectionSlug: 'trips', count: 4 }] });
        throw new Error('malformed continuation');
      },
    }).turn({ conversationKey, message: 'hur många resor har vi', requestKey: 'count-fallback' }, context, (event) => { events.push(event); });
    expect(attempts).toBe(2);
    expect(embedded).toEqual(['hur många resor har vi']);
    expect(events.at(-1)).toMatchObject({ type: 'done', message: { status: 'COMPLETED', content: '4' } });
  });

  test('preserves an exact app.search sum when both agent continuations fail', async () => {
    const events: any[] = []; const { repository } = repositoryMock();
    await createConversationService({
      repository, embed: async () => [1],
      core: async (_request, execution) => {
        execution.onToolSucceeded?.('app.search', { operation: 'sum', collectionSlugs: ['images'], field: 'sizeBytes' }, { operation: 'sum', groups: [{ collectionSlug: 'images', field: 'sizeBytes', sum: 1_500_000_000, unit: 'bytes', matchedCount: 20, valueCount: 20 }] });
        throw new Error('malformed continuation');
      },
    }).turn({ conversationKey, message: 'how many GB of images', requestKey: 'sum-fallback' }, context, (event) => { events.push(event); });
    expect(events.at(-1)).toMatchObject({ type: 'done', message: { status: 'COMPLETED', content: '20 matching resources; 1500000000 bytes' } });
  });

  test('preserves compound aggregate evidence after another successful read-only lookup', async () => {
    const events: any[] = []; const { repository } = repositoryMock(); const collectionKey = newId();
    await createConversationService({
      repository, embed: async () => [1],
      core: async (_request, execution) => {
        execution.onToolSucceeded?.('web.search', { query: 'Core' }, { text: 'Core' });
        execution.onToolSucceeded?.('app.search', { operation: 'count', collectionSlugs: ['images'], filters: { collectionKey }, limit: 10 }, { operation: 'count', groups: [{ collectionSlug: 'images', count: 20 }] });
        execution.onToolSucceeded?.('app.search', { operation: 'sum', collectionSlugs: ['images'], field: 'sizeBytes', filters: { collectionKey }, limit: 10 }, { operation: 'sum', groups: [{ collectionSlug: 'images', field: 'sizeBytes', sum: 1_500_000_000, unit: 'bytes', matchedCount: 20, valueCount: 20 }] });
        throw new Error('malformed continuation');
      },
    }).turn({ conversationKey, message: 'Hur många bilder och hur många MB?', requestKey: 'compound-fallback' }, context, (event) => { events.push(event); });
    expect(events.at(-1)).toMatchObject({ type: 'done', message: { status: 'COMPLETED', content: '20 matching resources; 1500000000 bytes' } });
  });

  test('does not emit partial text from a failed agent attempt before retrying', async () => {
    const events: any[] = []; let attempts = 0;
    const { repository } = repositoryMock();
    await createConversationService({
      repository, embed: async () => [1],
      core: async (_request, execution) => {
        attempts += 1;
        await execution.onDelta?.(attempts === 1 ? 'discarded partial' : 'final answer');
        if (attempts === 1) throw new Error('malformed trailing output');
        return { message: 'final answer', tools: [] };
      },
    }).turn({ conversationKey, message: 'question', requestKey: 'retry-deltas' }, context, (event) => { events.push(event); });
    expect(events.filter(({ type }) => type === 'delta').map(({ text }) => text)).toEqual(['final answer']);
    expect(events.at(-1)).toMatchObject({ type: 'done', message: { content: 'final answer' } });
  });

  test('records search history and paginates list/search/messages', async () => {
    let records = 0; const listInputs: unknown[] = []; const firstKey = newId();
    const rows = [{ key: firstKey, ...owner, name: 'First', isFavorite: true, createdAt: at, updatedAt: at }, { key: newId(), ...owner, name: 'Second', isFavorite: true, createdAt: at, updatedAt: '2026-08-31T10:00:00.000Z' }];
    const older = message({ createdAt: '2026-08-30T10:00:00.000Z' }), newer = message({ createdAt: '2026-08-31T10:00:00.000Z' });
    const repository = { list: async (_owner: unknown, input: unknown) => { listInputs.push(input); return rows; }, listMessages: async () => [older, newer] } as unknown as ConversationRepository;
    const service = createConversationService({ repository, userSearches: { record: async () => { records += 1; return {} as never; } } as never });
    const first = await service.list({ favoriteOnly: true, limit: 1 }, context);
    await service.search({ query: 'first', favoriteOnly: true, limit: 1, cursor: first.nextCursor, recordHistory: true }, context); await service.search({ query: 'private', recordHistory: false }, context);
    expect(records).toBe(1); expect(listInputs[1]).toMatchObject({ favoriteOnly: true, cursor: { key: firstKey } });
    const page = await service.messages({ conversationKey, limit: 1, cursor: encodeCursor({ createdAt: at, key: newId() }) }, context);
    expect(page.items[0]!.key).toBe(newer.key); expect(page.nextCursor).not.toBeNull();
    expect(conversationListInputSchema.parse({})).toEqual({ limit: 25, favoriteOnly: false }); expect(conversationSearchInputSchema.parse({ query: 'roadmap' })).toMatchObject({ recordHistory: true }); expect(conversationMessageListInputSchema.parse({ conversationKey })).toMatchObject({ limit: 10 });
  });

  test('propagates AbortSignal through Core and both embeddings', async () => {
    const controller = new AbortController(); const signals: unknown[] = []; const { repository } = repositoryMock();
    await createConversationService({ repository, router: { signal: controller.signal }, core: async (_request, _context, deps) => { signals.push(deps?.router?.signal); return { message: 'answer', tools: [] }; }, embed: async ({ signal }) => { signals.push(signal); return [1]; } }).turn({ conversationKey, message: 'next', requestKey: 'signal' }, context, () => {});
    expect(signals).toEqual([controller.signal, controller.signal, controller.signal]);
  });
});
