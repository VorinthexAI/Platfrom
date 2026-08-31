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
    const stored = await createEmailRepository(database as never).syncThread({
      thread: { ...thread, key: undefined, createdAt: undefined, updatedAt: undefined } as never,
      messages: [{ ...message, key: undefined, threadKey: undefined, createdAt: undefined, updatedAt: undefined } as never],
    });
    expect(stored.key).toBe(thread.key);
    expect(calls.some(({ query }) => query.includes('IN emailThreads'))).toBe(true);
    expect(calls.some(({ query }) => query.includes('IN emailMessages'))).toBe(true);
    const archive = calls.find(({ query }) => query.includes('IN documents'));
    expect(archive?.query).toContain('UPDATE {}');
    expect(archive?.bindVars.values).toHaveLength(2);
    expect(archive?.bindVars.values.every((value: Record<string, unknown>) => value.mutationPolicy === 'user')).toBe(true);
    expect(archive?.bindVars.values.every((value: Record<string, unknown>) => value._key !== thread.key && value._key !== message.key)).toBe(true);
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
    const result = await createEmailRepository(database as never).searchThreads(scopeKey, accountKey, embedding, ' Roadmap ', 0.55, 10, { readState: 'unread', facets: ['favorite', 'important', 'favorite'] });
    expect(call?.bindVars).toMatchObject({ scopeKey, connectorKey: accountKey, query: 'roadmap', readState: 'unread', facets: ['favorite', 'important'] });
    expect(call?.query).toContain('FOR message IN emailMessages');
    expect(call?.query).toContain('DOCUMENT(emailThreads, message.threadKey)');
    expect(result).toMatchObject([{ thread: { key: thread.key }, score: 0.8 }]);
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
