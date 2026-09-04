import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embeddings';
import { newId } from '@/lib/ids';
import { decodeEmailCursor, emailMessageKey, emailSubscriptionDraftKey, emailThreadKey, encodeEmailCursor, createEmailRepository, EmailRepositoryError } from './repository';

const scopeKey = newId();
const accountKey = newId();
const embedding = Array(EMBEDDING_DIMENSIONS).fill(0);
const at = '2026-08-25T12:00:00.000Z';

const thread = {
  key: emailThreadKey(scopeKey, accountKey, 'provider-thread'), scopeKey, accountKey,
  providerThreadId: 'provider-thread', subject: 'Roadmap', summary: 'Review the roadmap', intent: 'Review',
  priority: 'high' as const, state: 'needs_action' as const, lastMessageAt: at, unread: true,
  inInbox: true, isFavorite: true, inboxCategory: 'Important' as const, embedding, createdAt: at, updatedAt: at,
};
const message = {
  key: emailMessageKey(scopeKey, accountKey, 'provider-message'), scopeKey, accountKey, threadKey: thread.key,
  providerMessageId: 'provider-message', from: 'sender@example.com', to: ['recipient@example.com'], subject: 'Roadmap',
  body: 'Please review the roadmap.', summary: 'Review requested', replyDepth: 0, unread: true,
  direction: 'inbound' as const, sentAt: at, hasAttachments: false, attachmentAvailability: 'none' as const,
  inboxCategory: 'Important' as const, embedding, createdAt: at, updatedAt: at,
};
const arango = <T extends { key: string }>(value: T) => ({ ...value, _key: value.key, key: undefined });
const cursor = (nextValue?: unknown, allValues: unknown[] = []) => ({ next: async () => nextValue, all: async () => allValues });

describe('canonical email repository identity', () => {
  test('uses deterministic dedicated-record keys', () => {
    expect(emailThreadKey(scopeKey, accountKey, 'provider-thread')).toBe(emailThreadKey(scopeKey, accountKey, 'provider-thread'));
    expect(emailMessageKey(scopeKey, accountKey, 'provider-message')).not.toBe(emailThreadKey(scopeKey, accountKey, 'provider-message'));
    expect(emailSubscriptionDraftKey(scopeKey, message.key)).toBe(emailSubscriptionDraftKey(scopeKey, message.key));
  });

  test('round-trips strict thread cursors and rejects cross-thread reuse', () => {
    const encoded = encodeEmailCursor({ v: 2, threadKey: thread.key, sentAt: at, providerMessageId: message.providerMessageId, key: message.key });
    expect(decodeEmailCursor(encoded, thread.key)).toMatchObject({ threadKey: thread.key, key: message.key });
    expect(() => decodeEmailCursor(encoded, newId())).toThrow(EmailRepositoryError);
  });
});

describe('canonical email persistence', () => {
  test('persists canonical records before creating independent ordinary Archive copies', async () => {
    const calls: Array<{ query: string; bindVars: Record<string, any> }> = [];
    const database = { query: async (query: string, bindVars: Record<string, any>) => {
      calls.push({ query, bindVars });
      if (query.includes('IN emailThreads RETURN NEW')) return cursor(bindVars.value);
      if (query.includes('IN folders')) return cursor({ _key: bindVars.key, scopeKey });
      return cursor();
    } };
    const threadArchiveRepresentation = { content: 'sender@example.com\n\nRoadmap\n\nLatest thread message.', embedding, contentChunks: ['Latest thread message.'], chunkEmbeddings: [embedding], semanticChunkCount: 1, semanticContentHash: 'a'.repeat(64) };
    const messageArchiveRepresentation = { content: 'sender@example.com\n\nRoadmap\n\nPlease review the roadmap.', embedding, contentChunks: ['Please review the roadmap.'], chunkEmbeddings: [embedding], semanticChunkCount: 1, semanticContentHash: 'b'.repeat(64) };
    const stored = await createEmailRepository(database as never).syncThread({
      thread: { ...thread, key: undefined, createdAt: undefined, updatedAt: undefined, archiveRepresentation: threadArchiveRepresentation } as never,
      messages: [{ ...message, key: undefined, threadKey: undefined, createdAt: undefined, updatedAt: undefined, archiveRepresentation: messageArchiveRepresentation } as never],
    });
    expect(stored.key).toBe(thread.key);
    expect(calls.some(({ query }) => query.includes('IN emailThreads'))).toBe(true);
    expect(calls.some(({ query }) => query.includes('IN emailMessages'))).toBe(true);
    const archive = calls.find(({ query }) => query.includes('IN documents'));
    expect(archive?.query).toContain('UPDATE MERGE(value');
    expect(archive?.bindVars.values).toHaveLength(2);
    expect(archive?.bindVars.values.every((value: Record<string, unknown>) => value.mutationPolicy === 'user')).toBe(true);
    expect(archive?.bindVars.values.every((value: Record<string, unknown>) => value._key !== thread.key && value._key !== message.key)).toBe(true);
    expect(archive?.bindVars.values.map((value: Record<string, unknown>) => value.content)).toEqual([threadArchiveRepresentation.content, messageArchiveRepresentation.content]);
    expect(archive?.bindVars.values.every((value: Record<string, unknown>) => !String(value.content).startsWith('{'))).toBe(true);
  });

  test('reads thread detail from dedicated records and applies schema defaults', async () => {
    const database = { query: async (query: string) => query.includes('DOCUMENT(@@collection') ? cursor(arango({ ...thread, isFavorite: undefined, inboxCategory: undefined })) : cursor(undefined, [arango({ ...message, unread: undefined, inboxCategory: undefined, attachmentAvailability: undefined })]) };
    const detail = await createEmailRepository(database as never).thread(scopeKey, thread.key);
    expect(detail.thread).toMatchObject({ isFavorite: false, inboxCategory: 'Important' });
    expect(detail.messages[0]).toMatchObject({ unread: false, inboxCategory: 'Important', attachmentAvailability: 'none' });
  });

  test('scopes semantic search facets in the dedicated query', async () => {
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return cursor(undefined, [{ thread: arango(thread), score: 0.8 }]); } };
    const result = await createEmailRepository(database as never).searchThreads(scopeKey, accountKey, embedding, ' Roadmap ', 0.55, 10, { readState: 'unread', facets: ['favorite', 'important', 'favorite'], createdFrom: at, createdTo: at });
    expect(call?.bindVars).toMatchObject({ scopeKey, connectorKey: accountKey, query: 'roadmap', readState: 'unread', facets: ['favorite', 'important'], createdFrom: at, createdTo: at });
    expect(call?.query).toContain('FOR message IN emailMessages');
    expect(call?.query).toContain('DOCUMENT(emailThreads, message.threadKey)');
    expect(call!.query.indexOf('thread.createdAt >= @createdFrom')).toBeLessThan(call!.query.indexOf('COSINE_SIMILARITY'));
    expect(call!.query.indexOf('thread.createdAt <= @createdTo')).toBeLessThan(call!.query.indexOf('LIMIT @limit'));
    expect(result).toMatchObject([{ thread: { key: thread.key }, score: 0.8 }]);
  });

  test('filters overview threads inclusively before pagination and binds cursors to the date range', async () => {
    const before = { ...thread, key: newId(), providerThreadId: 'before', createdAt: '2026-08-24T23:59:59.999Z', lastMessageAt: '2026-08-28T00:00:00.000Z' };
    const upper = { ...thread, key: newId(), providerThreadId: 'upper', createdAt: '2026-08-26T00:00:00.000Z', lastMessageAt: '2026-08-26T00:00:00.000Z' };
    const lower = { ...thread, key: newId(), providerThreadId: 'lower', createdAt: '2026-08-25T00:00:00.000Z', lastMessageAt: '2026-08-27T00:00:00.000Z' };
    const database = { query: async (_query: string, bindVars: Record<string, unknown>) => cursor(undefined, bindVars['@collection'] === 'emailThreads' ? [before, upper, lower].map(arango) : []) };
    const repository = createEmailRepository(database as never);
    const first = await repository.overview(scopeKey, accountKey, { filter: 'all', createdFrom: lower.createdAt, createdTo: upper.createdAt, limit: 1 });
    expect(first.threads.map(({ key }) => key)).toEqual([lower.key]);
    expect(first.counts.all).toBe(2);
    expect(first.nextCursor).not.toBeNull();
    await expect(repository.overview(scopeKey, accountKey, { filter: 'all', createdFrom: lower.createdAt, createdTo: at, limit: 1, cursor: first.nextCursor! })).rejects.toThrow('another connector, scope, or query');
  });

  test('ranks all active connector drafts before applying the result limit', async () => {
    const queryEmbedding = [1, ...Array(EMBEDDING_DIMENSIONS - 1).fill(0)];
    const old = '2026-08-24T12:00:00.000Z';
    const drafts = [
      { key: newId(), scopeKey, accountKey, variant: 'new' as const, to: ['person@example.com'], subject: 'Other', generatedContent: 'Unrelated', status: 'generated' as const, embedding: [0, 1, ...Array(EMBEDDING_DIMENSIONS - 2).fill(0)], createdAt: at, updatedAt: at },
      { key: newId(), scopeKey, accountKey, variant: 'new' as const, to: ['person@example.com'], subject: 'Roadmap', generatedContent: 'Review it', status: 'generated' as const, embedding: queryEmbedding, createdAt: old, updatedAt: old },
    ];
    const database = { query: async (_query: string, bindVars: Record<string, unknown>) => cursor(undefined, bindVars['@collection'] === 'emailDrafts' ? drafts.map(arango) : []) };
    const result = await createEmailRepository(database as never).searchDrafts(scopeKey, accountKey, queryEmbedding, 'roadmap', -1, 1, { createdFrom: old, createdTo: old });
    expect(result).toEqual([{ draft: expect.objectContaining({ key: drafts[1]!.key }), score: 1 }]);
  });

  test('lists every eligible overview draft through an exact-count paginated query', async () => {
    const reply = { key: newId(), scopeKey, variant: 'reply' as const, replyMode: 'reply' as const, creationSource: 'subscription' as const, threadKey: thread.key, messageKey: message.key, to: ['sender@example.com'], cc: [], generatedContent: 'Reply', status: 'generated' as const, embedding, createdAt: at, updatedAt: at };
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return cursor({ drafts: [arango(reply)], total: 73 }); } };
    const result = await createEmailRepository(database as never).listDraftPage(scopeKey, accountKey, { createdFrom: at, createdTo: at, offset: 50, limit: 25 });
    expect(result).toEqual({ drafts: [expect.objectContaining({ key: reply.key })], total: 73 });
    expect(call?.bindVars).toMatchObject({ scopeKey, connectorKey: accountKey, createdFrom: at, createdTo: at, offset: 50, limit: 25 });
    expect(call?.query).toContain('draft.variant == "reply" && draft.creationSource == "subscription"');
    expect(call!.query.indexOf('draft.createdAt >= @createdFrom')).toBeLessThan(call!.query.indexOf('SORT draft.updatedAt'));
    expect(call!.query.indexOf('draft.createdAt <= @createdTo')).toBeLessThan(call!.query.indexOf('SLICE(eligible'));
    expect(call?.query).toContain('total: LENGTH(eligible)');
  });

  test('filters tone creation dates before semantic ranking and limit', async () => {
    let call: { query: string; bindVars: Record<string, unknown> } | undefined;
    const database = { query: async (query: string, bindVars: Record<string, unknown>) => { call = { query, bindVars }; return cursor(undefined, []); } };
    await createEmailRepository(database as never).searchTones(scopeKey, embedding, 'calm', 0.55, 10, { createdFrom: at, createdTo: at });
    expect(call?.bindVars).toMatchObject({ createdFrom: at, createdTo: at });
    expect(call!.query.indexOf('tone.createdAt >= @createdFrom')).toBeLessThan(call!.query.indexOf('COSINE_SIMILARITY'));
    expect(call!.query.indexOf('tone.createdAt <= @createdTo')).toBeLessThan(call!.query.indexOf('LIMIT @limit'));
  });

  test('deletes generated summaries only after queuing their audio storage', async () => {
    const calls: string[] = [];
    const database = { query: async (query: string) => {
      calls.push(query);
      if (query.includes('DOCUMENT(@@collection')) return cursor(arango(message));
      return cursor({ deletedKeys: ['summary-key'], storageKeys: ['summary.mp3'] });
    } };
    await expect(createEmailRepository(database as never).deleteMessageSummaries(scopeKey, message.key, ['summary-key'])).resolves.toEqual({ messageKey: message.key, deletedKeys: ['summary-key'], storageKeys: ['summary.mp3'] });
    const deletion = calls[1]!;
    expect(deletion).toContain('IN storageDeletionJobs');
    expect(deletion.indexOf('IN storageDeletionJobs')).toBeLessThan(deletion.indexOf('REMOVE audio IN documentSummaryAudio'));
  });

  test('hard-deletes mutable drafts and user-created tones without touching exports', async () => {
    const calls: string[] = [];
    const database = { query: async (query: string) => { calls.push(query); return cursor('deleted-key'); } };
    const repository = createEmailRepository(database as never);
    expect(await repository.deleteDraft(scopeKey, newId())).toEqual({ deletedKey: 'deleted-key', storageKeys: [] });
    expect(await repository.deleteTone(scopeKey, newId())).toEqual({ deletedKey: 'deleted-key', storageKeys: [] });
    expect(calls[0]).toContain('REMOVE draft IN emailDrafts');
    expect(calls[1]).toContain('REMOVE tone IN emailTones');
    expect(calls.join('\n')).not.toContain('documents');
    expect(calls.join('\n')).not.toContain('images');
  });
});
