import { describe, expect, test } from 'bun:test';
import { ensureOrganizationConnectorsCollection } from './indexes';

describe('organization connector indexes', () => {
  test('replaces single-provider scope uniqueness with provider-account uniqueness', async () => {
    const dropped: string[] = [];
    const ensured: unknown[] = [];
    const operations: string[] = [];
    const collection = {
      exists: async () => true,
      indexes: async () => [
        { id: 'legacy', fields: ['organizationKey', 'scopeKey', 'provider'], unique: true },
        { id: 'read', fields: ['scopeKey', 'provider', 'status'] },
      ],
      dropIndex: async (id: string) => { operations.push(`drop:${id}`); dropped.push(id); },
      ensureIndex: async (index: unknown) => { operations.push('ensure'); ensured.push(index); },
    };
    await ensureOrganizationConnectorsCollection({ collection: () => collection, query: async () => ({ next: async () => 0 }) } as never);
    expect(dropped).toEqual(['legacy']);
    expect(ensured[0]).toEqual({ type: 'persistent', fields: ['organizationKey', 'scopeKey', 'provider', 'providerAccountId'], unique: true });
    expect(operations.slice(0, 2)).toEqual(['ensure', 'drop:legacy']);
  });

  test('refuses to create the unique index over duplicate account bindings', async () => {
    let ensured = false;
    const collection = { exists: async () => true, indexes: async () => [], ensureIndex: async () => { ensured = true; } };
    await expect(ensureOrganizationConnectorsCollection({ collection: () => collection, query: async () => ({ next: async () => 1 }) } as never)).rejects.toThrow('duplicate provider-account bindings');
    expect(ensured).toBe(false);
  });
});
