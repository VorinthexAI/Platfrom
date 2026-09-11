import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createUserInboxService, UserInboxAccessError, UserInboxIdempotencyError, UserInboxNotFoundError } from './service';

const userKey = newId(), teamKey = newId(), scopeKey = newId(), threadKey = newId();
const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId(), userId: userKey, teamKey, status: 'active' } } } as unknown as ToolContext;

describe('user inbox service', () => {
  test('injects user ownership for list, read, mark-read, and follow-up', async () => {
    const calls: unknown[][] = [];
    const repository = {
      list: async (...args: unknown[]) => { calls.push(['list', ...args]); return { items: [], unreadCount: 0, nextCursor: null }; },
      read: async (...args: unknown[]) => { calls.push(['read', ...args]); return { state: 'ok', value: { thread: {}, messages: [] } }; },
      markRead: async (...args: unknown[]) => { calls.push(['mark', ...args]); return { state: 'ok', value: {} }; },
      send: async (...args: unknown[]) => { calls.push(['send', ...args]); return { state: 'ok', value: args[1] }; },
    } as any;
    const service = createUserInboxService({ repository, id: () => newId(), now: () => '2026-09-09T10:00:00.000Z' });
    await service.list({ mailbox: 'sent', limit: 10 }, context);
    await service.read({ threadKey }, context);
    await service.markRead({ threadKey }, context);
    await service.send({ threadKey, message: 'Any update?' }, context);
    expect(calls[0]).toEqual(['list', userKey, { mailbox: 'sent', limit: 10 }]);
    expect(calls[1]).toEqual(['read', userKey, threadKey]);
    expect(calls[2]).toEqual(['mark', userKey, threadKey, '2026-09-09T10:00:00.000Z']);
    expect(calls[3]?.[2]).toMatchObject({ threadKey, userKey, sender: 'user', body: 'Any update?' });
  });

  test('rejects forged fields, system principals, and foreign threads', async () => {
    const service = createUserInboxService({ repository: { read: async () => ({ state: 'not_found' }) } as any });
    expect(() => service.list({ userKey }, context)).toThrow('Unrecognized key');
    await expect(service.read({ threadKey }, { ...context, principal: { kind: 'system' } })).rejects.toBeInstanceOf(UserInboxAccessError);
    await expect(service.read({ threadKey }, context)).rejects.toBeInstanceOf(UserInboxNotFoundError);
  });

  test('enqueues an idempotent trusted staff reply', async () => {
    const notificationKey = newId(), messageKey = newId(), enqueued: string[] = [];
    const message = { key: messageKey, threadKey, teamKey, scopeKey, userKey, sender: 'staff' as const, senderUserKey: newId(), body: 'We are looking into it.', createdAt: '2026-09-09T10:00:00.000Z' };
    const repository = { staffReply: async (...args: unknown[]) => ({ state: 'ok', value: { message, notificationKey, deliveries: 1, args } }) } as any;
    const result = await createUserInboxService({ repository, enqueue: async (key) => { enqueued.push(key); } }).staffReply({ threadKey, message: 'We are looking into it.' }, newId(), 'reply-1');
    expect(result).toEqual(message);
    expect(enqueued).toEqual([notificationKey]);
    await expect(createUserInboxService({ repository: { staffReply: async () => ({ state: 'conflict' }) } as any }).staffReply({ threadKey, message: 'Different' }, newId(), 'reply-1')).rejects.toBeInstanceOf(UserInboxIdempotencyError);
  });
});
