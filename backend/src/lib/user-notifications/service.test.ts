import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import type { ToolContext } from '@/lib/ai/tools/tool-context';
import { createUserNotificationService, UserNotificationAccessError, UserNotificationNotFoundError } from './service';

const teamKey = newId(), scopeKey = newId(), userKey = newId();
const context = { teamKey, runtimeScopeKey: scopeKey, principal: { kind: 'member', user: { key: userKey }, userTeam: { key: newId(), teamKey, userId: userKey, status: 'active' } } } as unknown as ToolContext;

describe('user notification service', () => {
  test('lists and marks read through the authenticated member', async () => {
    const key = newId();
    const item = { key, title: 'Ready', message: 'Body', isRead: false, createdAt: '2026-09-03T10:00:00.000Z' };
    const repository = {
      list: async () => ({ items: [item], nextCursor: null }),
      markRead: async () => ({ ...item, isRead: true }),
      get: async () => ({ key, userKey, teamKey, scopeKey, title: 'Ready', message: 'Body', readAt: null, embedding: [], createdAt: item.createdAt }),
      search: async () => [],
    } as never;
    const service = createUserNotificationService({ repository, now: () => '2026-09-03T11:00:00.000Z' });
    await expect(service.list({ readState: 'unread' }, context)).resolves.toEqual({ items: [item], nextCursor: null });
    await expect(service.markRead({ notificationKey: key, read: true }, context)).resolves.toMatchObject({ key, isRead: true });
  });

  test('rejects forged principals and missing rows', async () => {
    const service = createUserNotificationService({ repository: { markRead: async () => null } as never });
    await expect(service.list({ readState: 'unread' }, { ...context, principal: { kind: 'system' } })).rejects.toBeInstanceOf(UserNotificationAccessError);
    await expect(service.markRead({ notificationKey: newId(), read: true }, context)).rejects.toBeInstanceOf(UserNotificationNotFoundError);
  });
});
