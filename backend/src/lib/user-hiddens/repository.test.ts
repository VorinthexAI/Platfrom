import { describe, expect, test } from 'bun:test';
import { newId } from '@/lib/ids';
import { createUserHiddenRepository } from './repository';

describe('user hidden repository', () => {
  test('lists only rows accessible through the active matching organization membership', async () => {
    const actor = { userKey: newId(), organizationKey: newId(), membershipKey: newId() };
    const accessible = { key: newId(), userKey: actor.userKey, source: 'image' as const, sourceKey: newId(), createdAt: '2026-08-18T12:00:00.000Z' };
    let call: { query: string; bindVars?: Record<string, unknown> } | undefined;
    const database = { async query(query: string, bindVars?: Record<string, unknown>) { call = { query, bindVars }; return { async all() { return [{ ...accessible, _key: accessible.key }]; } }; } };
    await expect(createUserHiddenRepository(database).list(actor)).resolves.toEqual([accessible]);
    expect(call?.bindVars).toEqual(actor);
    expect(call?.query).toContain('membership.userId == @userKey && membership.organizationId == @organizationKey && membership.status == "active"');
    expect(call?.query).toContain('scope.organizationKey == @organizationKey && scope.deletedAt == null');
    expect(call?.query).toContain('target.deletedAt == null && (!HAS(target, "_internalDeletion") || target._internalDeletion == null)');
    expect(call?.query).toContain('hidden.source == "collection" ? (privileged || collectionAccess)');
    expect(call?.query).toContain('hidden.source == "image" ? (privileged || imageAccess)');
    expect(call?.query).toContain('member.memberKey == @membershipKey');
  });

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

  test('uses the same organization, membership, scope, deletion, and media access filters for list and canAccess', async () => {
    const queries: string[] = [];
    const database = { async query(query: string) { queries.push(query); return { async all() { return []; } }; } };
    const repository = createUserHiddenRepository(database);
    const actor = { userKey: newId(), organizationKey: newId(), membershipKey: newId() };
    await repository.list(actor);
    await repository.canAccess(actor, 'image', newId());
    for (const fragment of ['membership.userId == @userKey', 'membership.organizationId == @organizationKey', 'membership.status == "active"', 'scope.organizationKey == @organizationKey', 'target.deletedAt == null', 'scope.deletedAt == null', 'collectionAccess', 'imageAccess']) {
      expect(queries[0]).toContain(fragment);
      expect(queries[1]).toContain(fragment);
    }
  });
});
