import { describe, expect, test } from 'bun:test';
import { migrateUserInbox, userInboxMigration } from './0009-user-inbox';

describe('user inbox migration', () => {
  test('additively creates inbox collections and drops the retired vote collection', async () => {
    const created: string[] = [], dropped: string[] = [], queries: string[] = [], indexes: unknown[] = [];
    const database = {
      collection(name: string) {
        return {
          exists: async () => name === 'ticketVotes',
          create: async () => { created.push(name); },
          drop: async () => { dropped.push(name); },
          ensureIndex: async (index: unknown) => { indexes.push(index); },
        };
      },
      async query(query: string) { queries.push(query); return { all: async () => [] }; },
    };
    await migrateUserInbox(database as never);
    expect(userInboxMigration.id).toBe('0009-user-inbox');
    expect(created).toEqual(['userInboxThreads', 'userInboxMessages']);
    expect(dropped).toEqual(['ticketVotes']);
    expect(indexes).toContainEqual({ type: 'persistent', fields: ['threadKey', 'userKey', 'idempotencyKey'], unique: true, sparse: true });
    expect(queries.some((query) => query.includes('appNotificationRecipients'))).toBe(true);
  });
});
