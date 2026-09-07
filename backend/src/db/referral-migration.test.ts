import { describe, expect, test } from 'bun:test';
import { collections, migrateReferralCodes } from './arango-migrate';

describe('referral migration', () => {
  test('declares private referral collections and durable uniqueness', async () => {
    expect(collections.find(({ name }) => name === 'referralCodes')).toEqual({ name: 'referralCodes', skipEmbedding: true, indexes: [{ fields: ['code'], unique: true }, { fields: ['ownerUserKey', 'programVersion'], unique: true }] });
    expect(collections.find(({ name }) => name === 'referralAttributions')?.indexes).toEqual(expect.arrayContaining([
      { fields: ['referredUserKey', 'programVersion'], unique: true },
      { fields: ['referrerUserKey', 'programVersion', 'createdAt'] },
    ]));
    expect(collections.find(({ name }) => name === 'referralRewards')?.indexes).toEqual(expect.arrayContaining([
      { fields: ['attributionKey', 'milestone', 'programVersion'], unique: true },
      { fields: ['sparkTransactionKey'], unique: true, sparse: true },
      { fields: ['qualifyingPaymentKey'], unique: true, sparse: true },
    ]));
    const registry = await Bun.file(new URL('../lib/db/registry.ts', import.meta.url)).text();
    for (const name of ['referralCodes:', 'referralAttributions:', 'referralRewards:']) expect(registry).not.toContain(name);
  });

  test('declares checkout handoffs as a private indexed collection', async () => {
    expect(collections.find(({ name }) => name === 'checkoutHandoffs')).toEqual({ name: 'checkoutHandoffs', skipEmbedding: true, indexes: [{ fields: ['tokenHash'], unique: true }, { fields: ['issuanceKey'], unique: true }, { fields: ['expiresAt'] }, { fields: ['userKey', 'createdAt'] }, { fields: ['claimLeaseExpiresAt'], sparse: true }] });
    const registry = await Bun.file(new URL('../lib/db/registry.ts', import.meta.url)).text();
    expect(registry).not.toContain('checkoutHandoffs:');
  });

  test('randomly replaces legacy codes in place, inserts missing users, retries collisions, and is idempotent', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const createdAt = '2026-09-05T10:00:00.000Z';
    const codes = [
      { key: 'valid-key', ownerUserKey: 'user-1', code: 'ABCDEF012345' },
      { key: 'legacy-key', ownerUserKey: 'user-2', code: 'A'.repeat(32) },
    ];
    const users = ['user-1', 'user-2', 'user-3'];
    const database = { query: async (query: string, bindVars: Record<string, unknown> = {}) => {
      calls.push({ query, bindVars });
      if (query.startsWith('FOR code IN referralCodes RETURN')) return { all: async () => codes.map(({ key, code }) => ({ key, code })) };
      if (query.startsWith('UPDATE @key')) { const row = codes.find(({ key }) => key === bindVars.key)!; row.code = String(bindVars.code); return { all: async () => [] }; }
      if (query.startsWith('FOR user IN users FILTER')) return { all: async () => users.filter((userKey) => !codes.some((code) => code.ownerUserKey === userKey)).map((userKey) => ({ userKey })) };
      if (query.startsWith('INSERT')) { codes.push({ key: String(bindVars.key), ownerUserKey: String(bindVars.userKey), code: String(bindVars.code) }); return { all: async () => [] }; }
      throw new Error(`Unexpected query: ${query}`);
    } };
    const generated = ['ABCDEF012345', 'BBBBBB012345', 'CCCCCC012345'];
    await migrateReferralCodes(database as never, createdAt, () => generated.shift()!, () => 'new-code-key');
    const writesAfterFirstRun = calls.filter(({ query }) => query.startsWith('UPDATE') || query.startsWith('INSERT')).length;
    await migrateReferralCodes(database as never, createdAt, () => { throw new Error('rerun must not generate'); }, () => 'unused');
    expect(codes).toEqual([
      { key: 'valid-key', ownerUserKey: 'user-1', code: 'ABCDEF012345' },
      { key: 'legacy-key', ownerUserKey: 'user-2', code: 'BBBBBB012345' },
      { key: 'new-code-key', ownerUserKey: 'user-3', code: 'CCCCCC012345' },
    ]);
    expect(calls.filter(({ query }) => query.startsWith('UPDATE') || query.startsWith('INSERT'))).toHaveLength(writesAfterFirstRun);
    expect(calls.some(({ query, bindVars }) => query.startsWith('UPDATE @key') && bindVars?.key === 'legacy-key')).toBe(true);
  });
});
