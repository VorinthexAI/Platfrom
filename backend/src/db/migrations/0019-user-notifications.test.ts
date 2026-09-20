import { describe, expect, test } from 'bun:test';
import { migrateUserNotifications, userNotificationsMigration } from './0019-user-notifications';

describe('user notifications migration', () => {
  test('creates the per-user notification collection and backfills inbox notification threads', async () => {
    const created: string[] = [];
    const indexes: unknown[] = [];
    const queries: string[] = [];
    await migrateUserNotifications({
      collection: (name: string) => ({
        exists: async () => false,
        create: async () => { created.push(name); },
        ensureIndex: async (index: unknown) => { indexes.push(index); },
      }),
      query: async (query: string) => { queries.push(query); },
    } as never);
    expect(userNotificationsMigration.id).toBe('0019-user-notifications');
    expect(created).toEqual(['userNotifications']);
    expect(indexes).toContainEqual({ type: 'persistent', fields: ['sourceKey', 'userKey'], unique: true, sparse: true });
    expect(queries[0]).toContain('FOR thread IN userInboxThreads');
    expect(queries[0]).toContain('INSERT');
    expect(queries[0]).toContain('INTO userNotifications');
    expect(queries[0]).toContain('LEFT(thread.subject, 200)');
  });
});
