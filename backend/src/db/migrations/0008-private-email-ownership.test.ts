import { describe, expect, test } from 'bun:test';
import { migratePrivateEmailOwnership } from './0008-private-email-ownership';

describe('private email ownership migration', () => {
  test('resolves billing owners first, falls back to membership users, and revokes unresolved data', async () => {
    const queries: string[] = [];
    const indexes: Array<{ collection: string; fields: string[]; unique?: boolean }> = [];
    const collections = new Set(['teamConnectors', 'emailInboxes', 'emailThreads']);
    const database = {
      collection(name: string) {
        return {
          exists: async () => collections.has(name),
          create: async () => { collections.add(name); },
          ensureIndex: async (index: { fields: string[]; unique?: boolean }) => { indexes.push({ collection: name, ...index }); },
        };
      },
      query: async (query: string) => { queries.push(query); return { next: async () => undefined }; },
    };

    await migratePrivateEmailOwnership(database as never);

    expect(collections.has('userConnectors')).toBe(true);
    expect(queries[0]).toContain('connector.billingUserKey != null ? connector.billingUserKey');
    expect(queries[0]).toContain('creator.userId');
    expect(queries[0]).toContain('status: "revoked"');
    expect(queries.slice(1).every((query) => query.includes('privateVisibility: "revoked"'))).toBe(true);
    expect(indexes).toContainEqual(expect.objectContaining({ collection: 'userConnectors', fields: ['userKey', 'provider', 'providerAccountId'], unique: true }));
  });
});
