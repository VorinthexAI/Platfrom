import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createUserHiddenRepository } from './repository';

describe('user hidden repository', () => {
  test('uses one user-scoped upsert identity and exact user-scoped reveal', async () => {
    const calls: Array<{ query: string; bindVars?: Record<string, unknown> }> = [];
    const record = { key: newId(), userKey: newId(), source: 'document' as const, sourceKey: newId(), createdAt: '2026-08-18T12:00:00.000Z' };
    const database = { async query(query: string, bindVars?: Record<string, unknown>) { calls.push({ query, bindVars }); return { async all() { return query.includes('RETURN NEW') ? [{ ...record, _key: record.key }] : []; } }; } };
    const repository = createUserHiddenRepository(database);
    await repository.hide(record);
    await repository.reveal(record.userKey, record.source, record.sourceKey);
    expect(calls[0]?.query).toContain('UPSERT { userKey: @userKey, source: @source, sourceKey: @sourceKey }');
    expect(calls[1]?.query).toContain('hidden.userKey == @userKey && hidden.source == @source && hidden.sourceKey == @sourceKey');
  });

  test('accepts shared Gallery content through existing member read access instead of ownership', async () => {
    let query = '';
    const database = { async query(value: string) { query = value; return { async all() { return [true]; } }; } };
    const repository = createUserHiddenRepository(database);
    await expect(repository.canAccess({ userKey: newId(), organizationKey: newId(), membershipKey: newId() }, 'collection', newId())).resolves.toBe(true);
    expect(query).toContain('member.memberKey == @membershipKey');
    expect(query).not.toContain('member.role == "owner"');
  });
});
