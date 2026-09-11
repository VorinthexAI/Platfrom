import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools';
import type { ConversationRepository } from './repository';
import { conversationReferenceContext, createConversationService } from './service';
import {
  conversationImageTurnInputSchema, conversationListInputSchema, conversationMessageDeleteInputSchema, conversationMessageListInputSchema, conversationModelSendInputSchema, conversationSearchInputSchema,
  conversationMessageSchema, conversationSendInputSchema, encodeCursor, projectConversationMessage, type ConversationMessage,
} from './schemas';

const teamKey = newId(), scopeKey = newId(), userKey = newId(), conversationKey = newId();
const at = '2026-09-01T10:00:00.000Z';
const owner = { teamKey, scopeKey, userKey };
const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId(), teamKey: teamKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;
const message = (overrides: Partial<ConversationMessage> = {}): ConversationMessage => ({
  key: newId(), conversationKey, teamKey, scopeKey, userKey, turnKey: 'request-1', requestHash: 'a'.repeat(64), type: 'TEXT',
  role: 'ASSISTANT', status: 'COMPLETED', content: 'answer', attachments: [], retrievals: [], createdAt: at, completedAt: at, ...overrides,
  attachmentStatus: overrides.attachmentStatus ?? (overrides.attachments?.length ? 'COMPLETED' : overrides.pendingAttachmentKeys?.length ? 'PENDING' : 'NONE'),
});

type RepositoryOverrides = Partial<ConversationRepository> & { first?: boolean; recent?: ConversationMessage[] };
function repositoryMock(overrides: RepositoryOverrides = {}) {
  const pending = message({ status: 'PENDING', content: 'Pending', completedAt: undefined }); let failed = 0; let begunUser: ConversationMessage | undefined;
  const repository = {
    beginTurn: async (_owner: typeof owner, _conversationKey: string, user: ConversationMessage, assistant: ConversationMessage) => { begunUser = user; return { state: 'created' as const, user, assistant: { ...assistant, key: pending.key }, first: overrides.first ?? false }; },
    latestCompletedMessages: async () => overrides.recent ?? [], semanticMessages: async () => [], setMessageEmbedding: async () => true,
    setMessageAttachments: async (_owner: typeof owner, _conversationKey: string, _messageKey: string, attachments: ConversationMessage['attachments']) => begunUser ? { ...begunUser, attachments } : null,
    failMessageAttachments: async () => true,
    completeTurn: async (_owner: typeof owner, _conversation: string, _key: string, content: string, embedding: number[], retrievals: any[], completedAt: string, generatedName?: string) => ({ message: { ...pending, status: 'COMPLETED' as const, content, embedding, retrievals, completedAt }, nameApplied: Boolean(generatedName) }),
    failTurn: async () => { failed += 1; }, ...overrides,
  } as unknown as ConversationRepository;
  return { repository, failed: () => failed };
}

describe('private conversations', () => {
  test('keeps public conversation inputs strict and embedding state private', async () => {
    expect(() => conversationSendInputSchema.parse({ conversationKey, message: 'x', requestKey: 'r', extra: true })).toThrow('Unrecognized key');
    expect(() => conversationModelSendInputSchema.parse({ conversationKey, message: 'x', requestKey: 'forged' })).toThrow('Unrecognized key');
    expect(() => conversationMessageDeleteInputSchema.parse({ conversationKey, messageKey: newId(), userKey })).toThrow('Unrecognized key');
    expect(projectConversationMessage(message({ embedding: [1], embeddingProvider: 'provider', embeddingModel: 'model', embeddingDimensions: 1 }))).not.toHaveProperty('embedding');
    expect(projectConversationMessage(message({ embedding: [1], embeddingProvider: 'provider', embeddingModel: 'model', embeddingDimensions: 1 }))).not.toHaveProperty('embeddingProvider');
    expect(projectConversationMessage(message({ role: 'USER', pendingAttachmentKeys: [newId()], attachmentStatus: 'PENDING' }))).toMatchObject({ attachmentStatus: 'PENDING' });
    expect(projectConversationMessage(message({ role: 'USER', pendingAttachmentKeys: [newId()], attachmentStatus: 'PENDING' }))).not.toHaveProperty('pendingAttachmentKeys');
    expect(projectConversationMessage(message({ type: 'IMAGE', content: '{"prompt":"private enhanced prompt"}', imageStatusText: 'I am creating your white sports car now.', status: 'PENDING', completedAt: undefined }))).toMatchObject({ content: 'I am creating your white sports car now.' });
    expect(projectConversationMessage(message({ type: 'IMAGE', content: '{"prompt":"legacy private prompt"}', status: 'PENDING', completedAt: undefined }))).toMatchObject({ content: 'Image generation is in progress.' });
    const { retrievals: _retrievals, ...legacy } = message();
    expect(conversationMessageSchema.parse(legacy)).toHaveProperty('retrievals', []);
    expect(() => conversationMessageSchema.parse({ ...message(), unexpected: true })).toThrow('Unrecognized key');
    expect(() => conversationImageTurnInputSchema.parse({ conversationKey, prompt: 'x', requestKey: 'r', count: 2 })).toThrow('Unrecognized key');
    expect(() => conversationMessageSchema.parse({ ...message(), type: 'TEXT', imageKey: newId() })).toThrow('Text messages cannot reference');
    const attachment = { key: newId(), kind: 'document' as const, filename: 'notes.txt', mimeType: 'text/plain' as const, sizeBytes: 4 };
    expect(conversationMessageSchema.parse({ ...message({ role: 'USER' }), attachments: [attachment], attachmentStatus: 'COMPLETED' }).attachments).toEqual([attachment]);
    expect(() => conversationMessageSchema.parse({ ...message(), attachments: [attachment] })).toThrow('Attachments belong only');
    expect(() => conversationMessageSchema.parse({ ...message({ type: 'IMAGE', role: 'USER', imageKey: undefined, embedding: undefined }), attachments: [attachment] })).toThrow('Attachments belong only');
    expect(() => conversationMessageSchema.parse({ ...message({ role: 'USER' }), attachments: [{ ...attachment, storageKey: 'private' }] })).toThrow('Unrecognized key');
    expect(() => conversationMessageSchema.parse({ ...message(), type: 'IMAGE' })).toThrow('require an image reference');
    expect(conversationMessageSchema.parse({ ...message(), type: 'IMAGE', imageKey: newId(), embedding: undefined }).type).toBe('IMAGE');
  });

  test('deletes the canonical paired turn with trusted ownership', async () => {
    const selectedMessageKey = newId(), pairedMessageKey = newId(); const calls: unknown[] = [];
    const repository = { deleteMessageTurn: async (...args: unknown[]) => { calls.push(args); return [selectedMessageKey, pairedMessageKey]; } } as unknown as ConversationRepository;
    await expect(createConversationService({ repository, now: () => at }).deleteMessage({ conversationKey, messageKey: selectedMessageKey }, context)).resolves.toEqual({ deletedKeys: [selectedMessageKey, pairedMessageKey] });
    expect(calls).toEqual([[owner, conversationKey, selectedMessageKey, at]]);
    const missing = createConversationService({ repository: { deleteMessageTurn: async () => null } as unknown as ConversationRepository });
    await expect(missing.deleteMessage({ conversationKey, messageKey: selectedMessageKey }, context)).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });

  test('projects retrievals into ordered typed references without leaking search filters', () => {
    const first = newId(), second = newId();
    const references = conversationReferenceContext([{ query: 'resa', limit: 2, filters: { isFavorite: true }, groups: [{ collectionSlug: 'trips', results: [{ key: first, label: 'Japan' }, { key: second, label: 'Italy', destinationKey: newId(), destinationCollectionSlug: 'places' }] }] }]);
    expect(references).toEqual([{ query: 'resa', references: [
      { ordinal: 1, collectionSlug: 'trips', label: 'Japan' },
      { ordinal: 2, collectionSlug: 'trips', label: 'Italy', destinationCollectionSlug: 'places' },
    ] }]);
    expect(JSON.stringify(references)).not.toContain(first);
    expect(JSON.stringify(references)).not.toContain(second);
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

  test('awaits one user embedding and reuses its exact vector for one scoped recall outside Core retries', async () => {
    const recent = message({ key: newId(), role: 'USER', content: 'recent', createdAt: '2026-08-31T10:00:00.000Z', completedAt: '2026-08-31T10:00:00.000Z' });
    const recalledReference = { query: 'roadmap', limit: 1, minimumScore: 0.55, filters: { isFavorite: true }, groups: [{ collectionSlug: 'documents' as const, results: [{ key: newId(), label: 'Roadmap' }] }] };
    const recalled = Array.from({ length: 22 }, (_, index) => message({ key: newId(), conversationKey: newId(), content: `recalled-${index}`, retrievals: index === 0 ? [recalledReference] : [], createdAt: new Date(Date.UTC(2026, 6, index + 1)).toISOString(), completedAt: new Date(Date.UTC(2026, 6, index + 1)).toISOString() }));
    const future = message({ key: newId(), conversationKey: newId(), content: 'future', createdAt: '2026-09-02T00:00:00.000Z', completedAt: '2026-09-02T00:00:00.000Z' });
    const vector = [0.25]; const embeddings: unknown[] = []; const requests: any[] = []; let indexedVector: number[] | undefined; let queriedVector: number[] | undefined; let semanticCalls = 0;
    let currentUser: ConversationMessage | undefined;
    const { repository } = repositoryMock({
      first: true,
      beginTurn: async (_owner, _conversation, user, assistant) => { currentUser = user; return { state: 'created', user, assistant, first: true }; },
      latestCompletedMessages: async (_owner, _conversation, before, limit) => { expect({ before, limit }).toEqual({ before: at, limit: 50 }); return [recent]; },
      setMessageEmbedding: async (_owner, _conversation, _key, embedding) => { indexedVector = embedding; throw new Error('index unavailable'); },
      semanticMessages: async (_owner, embedding, input) => {
        semanticCalls += 1; queriedVector = embedding;
        expect(input).toEqual({ before: at, excludedKeys: [currentUser!.key, recent.key], limit: 20 });
        return [{ message: recent, similarity: 1 }, { message: currentUser!, similarity: 1 }, { message: future, similarity: 1 }, ...recalled.map((item, index) => ({ message: item, similarity: 0.9 - index / 100 }))];
      },
    });
    await createConversationService({
      repository,
      now: () => at,
      embed: async (input) => { embeddings.push(input); return vector; },
      core: async (request) => { requests.push(request); throw new Error('retry'); },
    }).turn({ conversationKey, message: 'CURRENT TITLE ONLY', requestKey: 'automatic-recall' }, context, () => {});
    expect(embeddings).toEqual([{ text: 'CURRENT TITLE ONLY', purpose: 'document', signal: undefined, timeoutMs: undefined }]);
    expect(indexedVector).toBe(vector); expect(queriedVector).toBe(vector); expect(semanticCalls).toBe(1); expect(requests).toHaveLength(2);
    expect(requests[0].context.map((item: { content: string }) => item.content)).toEqual(['recent']);
    expect(requests[0].recalledContext).toHaveLength(20);
    expect(requests[0].recalledContext.map((item: { content: string }) => item.content)).not.toContain('recent');
    expect(requests[0].recalledContext.map((item: { content: string }) => item.content)).not.toContain('future');
    expect(requests[0].recalledContext[0].content).toContain('Roadmap');
    expect(requests[0].recalledContext[0].content).not.toContain('isFavorite');
    expect(requests[0].message).toBe('CURRENT TITLE ONLY');
    expect(requests[1].recalledContext).toEqual(requests[0].recalledContext);
  });

  test('fails open when semantic retrieval fails after successful user indexing', async () => {
    const events: any[] = []; const indexedKeys: string[] = []; let currentUserKey = '';
    const { repository } = repositoryMock({
      beginTurn: async (_owner, _conversation, user, assistant) => { currentUserKey = user.key; return { state: 'created', user, assistant, first: false }; },
      setMessageEmbedding: async (_owner, _conversation, messageKey) => { indexedKeys.push(messageKey); return true; },
      semanticMessages: async () => { throw new Error('semantic unavailable'); },
    });
    await createConversationService({ repository, embed: async () => [1], core: async (request: any) => { expect(request.recalledContext).toEqual([]); return { message: 'answer', tools: [] }; } }).turn({ conversationKey, message: 'question', requestKey: 'recall-failure' }, context, (event) => { events.push(event); });
    expect(indexedKeys.filter((key) => key === currentUserKey)).toHaveLength(1);
    expect(events.at(-1)).toMatchObject({ type: 'done', message: { content: 'answer' } });
  });

  test('starts semantic recall before the indexing write resolves', async () => {
    let releaseIndex!: () => void; let indexingFinished = false; let recallSawPendingIndex = false;
    const indexingGate = new Promise<void>((resolve) => { releaseIndex = resolve; });
    const { repository } = repositoryMock({
      setMessageEmbedding: async () => { await indexingGate; indexingFinished = true; return true; },
      semanticMessages: async () => { recallSawPendingIndex = !indexingFinished; releaseIndex(); return []; },
    });
    await createConversationService({ repository, embed: async () => [1], core: async () => ({ message: 'answer', tools: [] }) }).turn({ conversationKey, message: 'parallel recall', requestKey: 'parallel-recall' }, context, () => {});
    expect(recallSawPendingIndex).toBe(true); expect(indexingFinished).toBe(true);
  });

  test('routes a selected-image edit through Core so it receives a confirmation', async () => {
    const referenceImageKey = newId(); const events: any[] = []; let systemPrompt = '';
    const imageUser = message({ key: newId(), type: 'IMAGE', role: 'USER', content: 'Make the sky blue', imageKey: undefined });
    const imageAssistant = message({ key: newId(), type: 'IMAGE', status: 'PENDING', content: '{}', imageKey: undefined, completedAt: undefined });
    const { repository } = repositoryMock({
      setImageStatusText: async (_owner, _conversationKey, _messageKey, statusText) => ({ ...imageAssistant, imageStatusText: statusText }),
      deleteMessageTurn: async (_owner, _conversationKey, messageKey) => [newId(), messageKey],
    });
    await createConversationService({ repository, embed: async () => [1], core: async (request: any, execution) => {
      systemPrompt = request.systemPrompt;
      execution.onToolSucceeded?.('app.generate-image', { prompt: 'Make the sky blue' }, { user: projectConversationMessage(imageUser), assistant: projectConversationMessage(imageAssistant), replayed: false });
      await execution.onDelta?.('I will edit the image and make the sky blue.');
      return { message: 'I will edit the image and make the sky blue.', tools: [] };
    } }).turn({ conversationKey, message: 'Make the sky blue', requestKey: 'edit-image', referenceImageKeys: [referenceImageKey] }, context, (event) => { events.push(event); });
    expect(systemPrompt).toContain('image editing context');
    expect(events.map(({ type }) => type)).toEqual(['start', 'delta', 'done']);
    expect(events.at(-1)?.message).toMatchObject({ type: 'IMAGE', role: 'ASSISTANT', status: 'PENDING', content: 'I will edit the image and make the sky blue.' });
    expect(() => conversationSendInputSchema.parse({ conversationKey, message: 'x', requestKey: 'too-many', referenceImageKeys: [newId(), newId()] })).toThrow();
  });

  test('finishes a Core image request with only the enqueued image turn', async () => {
    const imageUser = message({ key: newId(), type: 'IMAGE', role: 'USER', content: 'Draw Earth', imageKey: undefined });
    const imageAssistant = message({ key: newId(), type: 'IMAGE', status: 'PENDING', content: '{}', imageKey: undefined, completedAt: undefined });
    const deleted: string[] = []; const events: any[] = [];
    const statusTexts: string[] = [];
    const { repository } = repositoryMock({
      setImageStatusText: async (_owner, _conversationKey, _messageKey, statusText) => { statusTexts.push(statusText); return { ...imageAssistant, imageStatusText: statusText }; },
      deleteMessageTurn: async (_owner, _conversationKey, messageKey) => { deleted.push(messageKey); return [newId(), messageKey]; },
    });
    await createConversationService({
      repository,
      embed: async () => [1],
      core: async (_request, execution) => {
        execution.onToolSucceeded?.('app.generate-image', { prompt: 'Draw Earth' }, { user: projectConversationMessage(imageUser), assistant: projectConversationMessage(imageAssistant), replayed: false });
        execution.onDelta?.('I have initiated generation.');
        return { message: 'I am creating Earth from orbit now.', tools: [{ slug: 'app.generate-image', status: 'succeeded' as const }] };
      },
    }).turn({ conversationKey, message: 'Draw Earth', requestKey: 'core-image' }, context, (event) => { events.push(event); });
    expect(events.map(({ type }) => type)).toEqual(['start', 'delta', 'done']);
    expect(events[1]).toMatchObject({ type: 'delta', text: 'I have initiated generation.' });
    expect(statusTexts).toEqual(['I am creating Earth from orbit now.']);
    expect(events.at(-1)?.message).toEqual(projectConversationMessage({ ...imageAssistant, imageStatusText: statusTexts[0] }));
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

  test('keeps the original user request while queuing an enhanced image prompt', async () => {
    const pairs: ConversationMessage[][] = []; const jobs: any[] = [];
    const repository = { beginImageTurn: async (_owner: unknown, _key: string, user: ConversationMessage, assistant: ConversationMessage) => { pairs.push([user, assistant]); return { state: 'created' as const, user, assistant }; } } as unknown as ConversationRepository;
    const result = await createConversationService({ repository, now: () => at, enqueueImageJob: async (job) => { jobs.push(job); } }).enqueueImageTurn({ conversationKey, prompt: 'A detailed cinematic white sports car prompt', userMessage: 'generate a white car', requestKey: 'enhanced-image' }, context);
    expect(pairs[0]![0]!.content).toBe('generate a white car');
    expect(jobs[0]!.input.prompt).toBe('A detailed cinematic white sports car prompt');
    expect(result.user.content).toBe('generate a white car');
    expect(result.assistant.content).toBe('Image generation is in progress.');
    expect(JSON.stringify(result)).not.toContain('cinematic');
  });

  test('durably queues trusted staged references without exposing them in assistant content', async () => {
    const stagedKey = newId(); let pair: ConversationMessage[] = []; let queued: any;
    const repository = { beginImageTurn: async (_owner: unknown, _key: string, user: ConversationMessage, assistant: ConversationMessage) => { pair = [user, assistant]; return { state: 'created' as const, user, assistant }; } } as unknown as ConversationRepository;
    const result = await createConversationService({ repository, now: () => at, enqueueImageJob: async (job) => { queued = job; } }).enqueueImageTurn({ conversationKey, prompt: 'Edit this upload', requestKey: 'staged-edit' }, context, [stagedKey]);
    expect(pair[1]?.imageReferenceArtifactKeys).toEqual([stagedKey]);
    expect(pair[1]?.content).not.toContain(stagedKey);
    expect(result.assistant).not.toHaveProperty('imageReferenceArtifactKeys');
    expect(JSON.stringify(result)).not.toContain(stagedKey);
    expect(queued.stagedImageArtifactKeys).toEqual([stagedKey]);
  });

  test('prepares and queues attachments before Core without waiting for durable persistence', async () => {
    const imageKey = newId(), documentKey = newId(), order: string[] = []; let request: any; let startedUser: ConversationMessage | undefined; const queued: any[] = [];
    const assuredContext = { ...context, teamAssurance: { teamMembershipKey: context.principal.kind === 'member' ? context.principal.userTeam.key : '', teamMfaVersion: 4 } };
    const { repository } = repositoryMock({
      beginTurn: async (_owner, _conversation, user, assistant) => { startedUser = user; return { state: 'created', user, assistant, first: false }; },
    });
    const records = new Map([
      [imageKey, { key: imageKey, kind: 'image', status: 'claimed', result: { kind: 'image', filename: 'photo.png', mimeType: 'image/png', sizeBytes: 3, storageKey: 'temporary/image' } }],
      [documentKey, { key: documentKey, kind: 'document', status: 'claimed', result: { kind: 'document', filename: 'notes.txt', mimeType: 'text/plain', sizeBytes: 5, content: 'private attachment text' } }],
    ]);
    const embeds: string[] = [];
    await createConversationService({
      repository,
      embed: async ({ text }) => { embeds.push(text); return [1]; },
      attachmentArtifacts: { readClaimed: async (selectedOwner) => { expect(selectedOwner).toEqual(owner); return [...records.values()] as never; } },
      attachmentStorage: { download: async () => ({ bytes: new Uint8Array([1, 2, 3]), sizeBytes: 3, mimeType: 'image/png' }) },
      prepareAttachments: async () => { order.push('prepare'); return [{ kind: 'image', filename: 'photo.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }, { kind: 'document', filename: 'notes.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('private attachment text') }]; },
      enqueueAttachmentJob: async (job) => { order.push('enqueue'); queued.push(job); },
      core: async (input) => { order.push('core'); request = input; return { message: 'answer', tools: [] }; },
    }).turn({ conversationKey, message: 'Use these', requestKey: 'attachments', attachmentKeys: [imageKey, documentKey] }, assuredContext, (event) => { if (event.type === 'start') { order.push('start'); expect(event.userMessage).toMatchObject({ attachments: [], attachmentStatus: 'PENDING' }); expect(event.userMessage).not.toHaveProperty('pendingAttachmentKeys'); } });
    expect(request.attachments).toEqual([
      { kind: 'image', filename: 'photo.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) },
      { kind: 'document', filename: 'notes.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('private attachment text') },
    ]);
    expect(startedUser!.content).toBe('Use these');
    expect(embeds).toEqual(['Use these', 'answer']);
    expect(queued).toEqual([{ schemaVersion: 1, artifactKey: imageKey, userMessageKey: startedUser!.key }, { schemaVersion: 1, artifactKey: documentKey, userMessageKey: startedUser!.key }]);
    expect(startedUser!.pendingAttachmentKeys).toEqual([imageKey, documentKey]);
    expect(startedUser!.attachmentStatus).toBe('PENDING');
    expect(order).toEqual(['prepare', 'enqueue', 'enqueue', 'start', 'core']);
  });

  test('does not retry a failed Core execution with an uploaded image', async () => {
    const imageKey = newId(); let attempts = 0;
    const { repository } = repositoryMock();
    const record = { key: imageKey, status: 'claimed', result: { kind: 'image', filename: 'dog.png', mimeType: 'image/png', sizeBytes: 3, storageKey: 'temporary/image' } };
    const events: any[] = [];
    await createConversationService({
      repository, embed: async () => [1],
      attachmentArtifacts: { readClaimed: async () => [record] as never },
      attachmentStorage: { download: async () => ({ bytes: new Uint8Array([1, 2, 3]), sizeBytes: 3, mimeType: 'image/png' }) },
      prepareAttachments: async () => [{ kind: 'image', filename: 'dog.png', mimeType: 'image/png', bytes: new Uint8Array([1, 2, 3]) }],
      enqueueAttachmentJob: async () => undefined,
      core: async () => { attempts += 1; throw new Error('vision failed'); },
    }).turn({ conversationKey, message: 'Vad är detta för hundras?', requestKey: 'image-failure', attachmentKeys: [imageKey] }, context, (event) => { events.push(event); });
    expect(attempts).toBe(1);
    expect(events.at(-1)).toMatchObject({ type: 'done', message: { content: 'I could not complete that request reliably. Please try again.' } });
  });

  test('preserves the Core response when initial durable queue admission fails', async () => {
    const attachmentKey = newId(); const events: any[] = [];
    const { repository } = repositoryMock();
    await createConversationService({
      repository, embed: async () => [1],
      attachmentArtifacts: { readClaimed: async () => [{ key: attachmentKey }] as never },
      prepareAttachments: async () => [{ kind: 'document', filename: 'notes.txt', mimeType: 'text/plain', bytes: new TextEncoder().encode('abc') }],
      enqueueAttachmentJob: async () => { throw new Error('redis unavailable'); },
      core: async (request: any) => { expect(request.attachments).toHaveLength(1); return { message: 'answer from attachment', tools: [] }; },
    }).turn({ conversationKey, message: 'Use this', requestKey: 'queue-failure', attachmentKeys: [attachmentKey] }, context, (event) => { events.push(event); });
    expect(events.at(-1)).toMatchObject({ type: 'done', message: { content: 'answer from attachment' } });
  });

  test('keeps the newest recent context within the aggregate bound and orders a turn user-first', async () => {
    const large = Array.from({ length: 3 }, (_, index) => message({ role: index % 2 ? 'ASSISTANT' : 'USER', content: `${index}:${'x'.repeat(99_990)}`, createdAt: new Date(Date.UTC(2026, 7, index + 1)).toISOString() }));
    const recalled = message({ conversationKey: newId(), content: `old:${'y'.repeat(99_990)}`, createdAt: '2026-01-01T00:00:00.000Z', completedAt: '2026-01-01T00:00:00.000Z' });
    let request: any; let startedAssistant: ConversationMessage | undefined;
    const { repository } = repositoryMock({
      beginTurn: async (_owner, _conversation, user, assistant) => { startedAssistant = assistant; return { state: 'created', user, assistant, first: false }; },
      latestCompletedMessages: async () => large,
      semanticMessages: async () => [{ message: recalled, similarity: 1 }],
    });
    await createConversationService({ repository, now: () => at, embed: async () => [1], core: async (input) => { request = input; return { message: 'answer', tools: [] }; } }).turn({ conversationKey, message: 'question', requestKey: 'bounded-context' }, context, () => {});
    expect(request.context).toHaveLength(2);
    expect(request.recalledContext).toEqual([]);
    expect(Buffer.byteLength(JSON.stringify({ context: request.context, recalledContext: request.recalledContext }), 'utf8')).toBeLessThanOrEqual(250_000);
    expect(request.context.map((item: { content: string }) => item.content[0])).toEqual(['1', '2']);
    expect(startedAssistant!.createdAt).toBe('2026-09-01T10:00:00.001Z');
  });

  test('streams Core deltas, applies first name, persists both embeddings, and preserves done SSE', async () => {
    const embeddings: unknown[] = []; const events: any[] = []; let savedName: string | undefined;
    const { repository } = repositoryMock({ first: true, completeTurn: async (_owner, _conversation, _key, content, embedding, _retrievals, _completed, name) => { savedName = name; return { message: message({ content, embedding }), nameApplied: true }; } });
    await createConversationService({
      repository, now: () => at, embed: async (input) => { embeddings.push(input); return [1]; },
      core: async (request, execution) => {
        expect(request).toMatchObject({ currentDate: at, generateName: true, requestKey: 'first' });
        await execution.onDelta?.('Hello ');
        expect(events.map(({ type }) => type)).toEqual(['start', 'delta']);
        await execution.onDelta?.('there');
        return { message: 'Hello there', name: 'Introductions', tools: [] };
      },
    }).turn({ conversationKey, message: 'Hello', requestKey: 'first' }, context, (event) => { events.push(event); });
    expect(events.map(({ type }) => type)).toEqual(['start', 'delta', 'delta', 'done']);
    expect(savedName).toBe('Introductions'); expect(embeddings.map((input: any) => input.text)).toEqual(['Hello', 'Hello there']);
    expect(events.at(-1)?.message).not.toHaveProperty('paths');
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
    const durableAttachment = { key: newId(), kind: 'document' as const, filename: 'notes.txt', mimeType: 'text/plain' as const, sizeBytes: 4 };
    await createConversationService({ repository: { beginTurn: async () => ({ state: 'replay', user: message({ role: 'USER', attachments: [durableAttachment] }), assistant: message({ content: 'Already done' }), first: false }) } as unknown as ConversationRepository, attachmentArtifacts: { readClaimed: async () => { throw new Error('replay must not reclaim'); } } }).turn({ conversationKey, message: 'again', requestKey: 'request-1', attachmentKeys: [newId()] }, context, (event) => { replayEvents.push(event); });
    expect(replayEvents[0]).toMatchObject({ type: 'start', userMessage: { attachments: [durableAttachment] } });
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
        execution.onToolSucceeded?.('agent.guide', { mode: 'explain' }, { guides: [] });
        execution.onToolSucceeded?.('app.search', { operation: 'count', collectionSlugs: ['images'], filters: { collectionKey }, limit: 10 }, { operation: 'count', groups: [{ collectionSlug: 'images', count: 20 }] });
        execution.onToolSucceeded?.('app.search', { operation: 'sum', collectionSlugs: ['images'], field: 'sizeBytes', filters: { collectionKey }, limit: 10 }, { operation: 'sum', groups: [{ collectionSlug: 'images', field: 'sizeBytes', sum: 1_500_000_000, unit: 'bytes', matchedCount: 20, valueCount: 20 }] });
        throw new Error('malformed continuation');
      },
    }).turn({ conversationKey, message: 'Hur många bilder och hur många MB?', requestKey: 'compound-fallback' }, context, (event) => { events.push(event); });
    expect(events.at(-1)).toMatchObject({ type: 'done', message: { status: 'COMPLETED', content: '20 matching resources; 1500000000 bytes' } });
  });

  test('keeps visible partial text and does not retry after streaming starts', async () => {
    const events: any[] = []; let attempts = 0;
    const { repository } = repositoryMock();
    await createConversationService({
      repository, embed: async () => [1],
      core: async (_request, execution) => {
        attempts += 1;
        await execution.onDelta?.('visible partial');
        throw new Error('malformed trailing output');
      },
    }).turn({ conversationKey, message: 'question', requestKey: 'retry-deltas' }, context, (event) => { events.push(event); });
    expect(attempts).toBe(1);
    expect(events.filter(({ type }) => type === 'delta').map(({ text }) => text)).toEqual(['visible partial']);
    expect(events.at(-1)).toMatchObject({ type: 'done', message: { content: 'visible partial' } });
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
