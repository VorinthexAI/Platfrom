import { describe, expect, test } from 'bun:test';
import { EMBEDDING_DIMENSIONS } from '@/lib/embedding-constants';
import { MAIL_DEV_SEED_EMAIL, mailDevFixtures } from './dev-fixtures';
import { mailDevFixtureKey } from './dev-seed';

const scopeKey = 'cmrnlzf640001qc7kazsr96k5';
const accountKeys = ['studio', 'personal', 'community'].map((slug) => mailDevFixtureKey('test-account', scopeKey, slug));

describe('mail development fixture manifest', () => {
  test('is fixed to the exact approved account with broad inbox and message coverage', () => {
    const fixtures = mailDevFixtures(scopeKey, accountKeys);
    expect(MAIL_DEV_SEED_EMAIL).toBe('oscar.burman005@gmail.com');
    expect(fixtures.accounts).toHaveLength(3);
    expect(fixtures.threads).toHaveLength(27);
    expect(fixtures.threads.reduce((count, thread) => count + thread.messages.length, 0)).toBeGreaterThanOrEqual(40);
    expect(new Set(fixtures.threads.map(({ thread }) => thread.category))).toEqual(new Set(['primary', 'updates', 'promotions', 'social', 'forums', 'other']));
    expect(fixtures.threads.some(({ thread }) => thread.labels.includes('SPAM'))).toBe(true);
    expect(fixtures.threads.some(({ thread }) => thread.labels.includes('TRASH'))).toBe(true);
    expect(fixtures.threads.some(({ thread }) => thread.isFavorite)).toBe(true);
    expect(fixtures.threads.some(({ messages }) => messages.some(({ cc }) => (cc?.length ?? 0) > 1))).toBe(true);
    expect(fixtures.threads.every(({ messages }) => messages.some(({ direction }) => direction === 'inbound') && messages.some(({ direction }) => direction === 'outbound'))).toBe(true);
  });

  test('keeps labels and UI state internally consistent and useful in every inbox', () => {
    const fixtures = mailDevFixtures(scopeKey, accountKeys);
    for (const account of fixtures.accounts) {
      const threads = fixtures.threads.filter(({ thread }) => thread.accountKey === account.accountKey).map(({ thread }) => thread);
      expect(threads.some((thread) => thread.unread && thread.inboxCategory === 'Urgent')).toBe(true);
      expect(threads.some((thread) => thread.unread && thread.inboxCategory === 'Important')).toBe(true);
      expect(threads.some((thread) => !thread.unread && thread.inboxCategory === 'Urgent')).toBe(true);
      expect(threads.some((thread) => !thread.unread && thread.inboxCategory === 'Important')).toBe(true);
      expect(threads.some((thread) => thread.inboxCategory === 'Filtered')).toBe(true);
      expect(threads.some((thread) => thread.isFavorite)).toBe(true);
    }
    for (const { thread, messages } of fixtures.threads) {
      expect(thread.labels.includes('UNREAD')).toBe(thread.unread);
      expect(thread.labels.includes('STARRED')).toBe(thread.starred);
      expect(thread.labels.includes('TRASH') && thread.labels.includes('SPAM')).toBe(false);
      expect(messages[0]!.labels.includes('UNREAD')).toBe(messages[0]!.unread);
    }
  });

  test('has deterministic nonzero embeddings, drafts, tones, and reply context', () => {
    const first = mailDevFixtures(scopeKey, accountKeys);
    const second = mailDevFixtures(scopeKey, accountKeys);
    expect(second).toEqual(first);
    expect(first.threads.every(({ thread }) => thread.embedding.length === EMBEDDING_DIMENSIONS && thread.embedding.some((value) => value !== 0))).toBe(true);
    expect(first.tones.map(({ name }) => name)).toEqual(['Casual', 'Formal', 'Direct']);
    expect(first.replyContext.length).toBeGreaterThanOrEqual(3);
    expect(first.drafts.some((draft) => draft.status === 'generated')).toBe(true);
    expect(first.drafts.some((draft) => draft.status === 'edited')).toBe(true);
    expect(first.drafts.some((draft) => draft.variant === 'reply' && draft.replyMode === 'reply_all')).toBe(true);
  });
});
