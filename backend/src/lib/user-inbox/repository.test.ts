import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createUserInboxRepository } from './repository';

describe('user inbox repository', () => {
  test('lists Inbox and Sent using only the authenticated owner and stable cursor', async () => {
    let query = '', vars: Record<string, unknown> = {};
    const repository = createUserInboxRepository({ query: async (text, bind) => { query = text; vars = bind ?? {}; return { next: async () => ({ cursorValid: true, unreadCount: 2, items: [] }) }; } });
    await expect(repository.list(newId(), { mailbox: 'sent', limit: 20 })).resolves.toEqual({ items: [], unreadCount: 2, nextCursor: null });
    expect(query).toContain('message.sender == "user"');
    expect(query).toContain('thread.userKey == @userKey');
    expect(vars).toMatchObject({ mailbox: 'sent', pageSize: 21 });
  });

  test('staff reply atomically inserts the message, unread state, and linked push delivery', async () => {
    let declaration: unknown, query = '';
    const repository = createUserInboxRepository({ query: async () => { throw new Error('outside transaction'); } }, async (collections, operation) => {
      declaration = collections;
      return operation({ query: async (text) => { query = text; return { next: async () => undefined }; } });
    });
    await expect(repository.staffReply(newId(), newId(), newId(), 'Reply', 'request-1', '2026-09-09T10:00:00.000Z')).resolves.toEqual({ state: 'not_found' });
    expect(declaration).toMatchObject({ write: ['userInboxThreads', 'userInboxMessages', 'appNotifications', 'appNotificationRecipients', 'pushDeliveries'] });
    expect(query).toContain('signalThreadKey: thread._key');
    expect(query).toContain('signalMessageKey: @messageKey');
    expect(query).toContain('readAt: null');
  });
});
